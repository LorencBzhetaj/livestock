import type { Table } from 'dexie'
import type { LivestockDatabase } from '../../db/database'
import { dataSchema } from '../backup/format'
import { validateRelationships } from '../backup/relationships'
import { entities, entitySchemas, keyOf, operationSchema, payloadFor, type Change, type Entity, type Mutation, type Operation, type Page, type Result, type Session } from './protocol'

export type SyncState = Session & { id: 'farm'; cursor: string }
export type Revision = { id: string; version: number }
export type Journal = { sequence?: number; operation: Operation; entities: string[]; attempts: number; retryAt: number; status: 'queued' | 'conflict' | 'resolved'; conflict?: Extract<Result, { status: 'conflict' }> }
type RecordInput = { entity: Entity; records: { id: string }[] }
const table = (db: LivestockDatabase, entity: Entity) => db.table<{ id: string }, string>(entity)
const sharedTables = (db: LivestockDatabase) => entities.map((entity) => table(db, entity))
const syncTables = (db: LivestockDatabase) => [db.syncState, db.syncJournal, db.syncRevisions]

export function farmWrite<T>(db: LivestockDatabase, tables: Table[], work: () => Promise<T>) {
  return db.transaction('rw', [...tables, ...syncTables(db)], work)
}

async function enqueue(db: LivestockDatabase, state: SyncState, mutations: Mutation[], initial = false) {
  if (!mutations.length) return
  const operation = operationSchema.parse({
    id: crypto.randomUUID(), farmId: state.farmId, deviceId: state.deviceId, initial,
    createdAt: new Date().toISOString(), mutations,
  })
  await db.syncJournal.add({ operation, entities: mutations.map(keyOf), attempts: 0, retryAt: 0, status: 'queued' })
}

export async function journal(db: LivestockDatabase, input: RecordInput[]) {
  const state = await db.syncState.get('farm')
  if (!state) return
  const mutations: Mutation[] = []
  for (const { entity, records } of input) {
    for (const record of records) {
      const baseKey = keyOf({ entity, recordId: record.id })
      const revision = (await db.syncRevisions.get(baseKey))?.version ?? 0
      const queued = await db.syncJournal.where('entities').equals(baseKey)
        .filter((item) => item.status !== 'resolved').count()
      const base = revision + queued
      const payload = payloadFor(entity, record)
      const archive = entity === 'animals' && typeof payload === 'object' && 'status' in payload && payload.status === 'archived'
      mutations.push({ entity, recordId: record.id, base, payload, type: base === 0 ? 'create' : archive ? 'archive' : 'update' })
    }
  }
  await enqueue(db, state, mutations)
}

function orderAmendments(records: { id: string; amendsId?: string }[]) {
  const byId = new Map(records.map((record) => [record.id, record]))
  const visiting = new Set<string>()
  const ordered = new Map<string, { id: string; amendsId?: string }>()
  function visit(record: { id: string; amendsId?: string }) {
    if (ordered.has(record.id)) return
    if (visiting.has(record.id)) throw new Error('Amendment cycle')
    visiting.add(record.id)
    const parent = record.amendsId && byId.get(record.amendsId)
    if (parent) visit(parent)
    visiting.delete(record.id)
    ordered.set(record.id, record)
  }
  records.forEach(visit)
  return [...ordered.values()]
}

export function checkInitial(local: Mutation[], remote: Change[]) {
  const remoteSpecies = new Map(remote.filter((row) => row.entity === 'species').map((row) => {
    const species = entitySchemas.species.parse(row.payload)
    return [species.code, species] as const
  }))
  const remapped = new Map<string, string>()
  for (const item of local.filter((row) => row.entity === 'species')) {
    const species = entitySchemas.species.parse(item.payload)
    const known = remoteSpecies.get(species.code)
    if (known && known.id !== species.id && canonical({ ...species, id: known.id }) === canonical(known)) {
      remapped.set(species.id, known.id)
    }
  }
  const normalized = local.flatMap((row): Mutation[] => {
    if (row.entity === 'species' && remapped.has(row.recordId)) return []
    if (row.entity !== 'animals') return [row]
    const animal = entitySchemas.animals.parse(row.payload)
    const remoteId = remapped.get(animal.speciesId)
    return remoteId ? [{ ...row, payload: payloadFor('animals', { ...animal, speciesId: remoteId }) }] : [row]
  })
  const merged = new Map(remote.map((row) => [keyOf(row), row]))
  for (const row of normalized) merged.set(keyOf(row), { ...row, cursor: '0', version: 1 })
  const rows = [...merged.values()]
  const grouped = Object.fromEntries(entities.map((entity) =>
    [entity, rows.filter((row) => row.entity === entity && row.payload !== null).map((row) => row.payload)]))
  const data = dataSchema.parse({ ...grouped, animalPhotos: [], settings: [], auditEvents: [] })
  if (new Set(data.species.map((row) => row.code)).size !== data.species.length) throw new Error('Duplicate species code')
  validateRelationships(data)
  return { normalized, remapped }
}

async function localSnapshot(db: LivestockDatabase) {
  const items: Mutation[] = []
  for (const entity of entities) {
    const rows = await table(db, entity).toArray()
    for (const record of entity === 'healthEvents' ? orderAmendments(rows) : rows) {
      items.push({ entity, recordId: record.id, base: 0, type: 'create', payload: payloadFor(entity, record) })
    }
  }
  return items
}

export function previewLocal(db: LivestockDatabase) {
  return db.transaction('r', sharedTables(db), () => localSnapshot(db))
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') {
    return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}'
  }
  return JSON.stringify(value) ?? 'null'
}

export async function connectLocal(db: LivestockDatabase, session: Session, reviewed: Mutation[], remote: Change[], cursor: string) {
  await farmWrite(db, sharedTables(db), async () => {
    if (await db.syncState.get('farm')) throw new Error('Device already linked')
    const local = await localSnapshot(db)
    if (canonical(local) !== canonical(reviewed)) throw new Error('Local records changed after review')
    const { normalized, remapped } = checkInitial(local, remote)
    const known = new Map(remote.map((item) => [keyOf(item), item]))
    const additions: Mutation[] = []
    const conflicts: { item: Mutation; other: Change }[] = []
    for (const item of normalized) {
      const other = known.get(keyOf(item))
      if (!other) additions.push(item)
      else if (canonical(item.payload) !== canonical(other.payload)) conflicts.push({ item, other })
    }
    // Each remote snapshot is merged by UUID. The local draft stays visible for mismatched UUIDs.
    const conflicted = new Set(conflicts.map(({ item }) => keyOf(item)))
    const state: SyncState = { ...session, id: 'farm', cursor }
    await db.syncState.add(state)
    for (const oldSpecies of remapped.keys()) await db.species.delete(oldSpecies)
    for (const item of normalized) {
      if (item.entity !== 'animals') continue
      const previous = await db.animals.get(item.recordId)
      if (previous && remapped.has(previous.speciesId)) await db.animals.put(entitySchemas.animals.parse(item.payload))
    }
    for (const change of known.values()) {
      if (!conflicted.has(keyOf(change))) await apply(db, change)
      await db.syncRevisions.put({ id: keyOf(change), version: change.version })
    }
    for (const { item, other } of conflicts) {
      const operation = operationSchema.parse({
        id: crypto.randomUUID(), farmId: session.farmId, deviceId: session.deviceId,
        createdAt: new Date().toISOString(), initial: false, mutations: [item],
      })
      await db.syncJournal.add({ operation, entities: [keyOf(item)], attempts: 0, retryAt: 0, status: 'conflict',
        conflict: { status: 'conflict', reason: 'stale', current: [other] } })
    }
    await enqueue(db, state, additions, cursor === '0')
  })
}

async function apply(db: LivestockDatabase, change: Change) {
  const target = table(db, change.entity)
  if (change.payload === null) await target.delete(change.recordId)
  else await target.put(change.payload as { id: string })
}

export async function applyPage(db: LivestockDatabase, session: Session, from: string, page: Page) {
  await farmWrite(db, sharedTables(db), async () => {
    const state = await db.syncState.get('farm')
    if (!state || state.farmId !== session.farmId || state.deviceId !== session.deviceId || state.cursor !== from) return
    let prior = BigInt(from)
    for (const change of page.changes) {
      if (BigInt(change.cursor) !== prior + 1n) throw new Error('Unexpected change sequence')
      prior = BigInt(change.cursor)
      const id = keyOf(change)
      const revision = (await db.syncRevisions.get(id))?.version ?? 0
      if (change.version <= revision) continue
      const pending = await db.syncJournal.where('entities').equals(id).filter((item) => item.status !== 'resolved').first()
      if (pending) throw new Error('Unresolved local change')
      await apply(db, change)
      await db.syncRevisions.put({ id, version: change.version })
    }
    if (page.cursor !== String(prior) || page.more && page.changes.length === 0) throw new Error('Invalid page cursor')
    await db.syncState.put({ ...state, cursor: page.cursor })
  })
}

export async function acknowledge(db: LivestockDatabase, entry: Journal, result: Result) {
  await db.transaction('rw', db.syncJournal, db.syncRevisions, async () => {
    const latest = await db.syncJournal.get(entry.sequence!)
    if (latest?.operation.id !== entry.operation.id || latest.status !== 'queued') return
    if (result.status === 'conflict') {
      await db.syncJournal.update(entry.sequence!, { status: 'conflict', conflict: result })
      return
    }
    const expected = new Map(entry.operation.mutations.map((item) => [keyOf(item), item.base + 1]))
    const actual = new Map(result.versions.map((item) => [keyOf(item), item.version]))
    if (actual.size !== expected.size || [...expected].some(([k, v]) => actual.get(k) !== v)) throw new Error('Invalid operation acknowledgment')
    await db.syncRevisions.bulkPut(result.versions.map((item) => ({ id: keyOf(item), version: item.version })))
    await db.syncJournal.delete(entry.sequence!)
  })
}

export async function resolve(db: LivestockDatabase, sequence: number, choice: 'server' | 'local') {
  await farmWrite(db, sharedTables(db), async () => {
    const entry = await db.syncJournal.get(sequence)
    if (entry?.status !== 'conflict' || !entry.conflict) throw new Error('Conflict missing')
    const remote = new Map(entry.conflict.current.map((item) => [keyOf(item), item]))
    const state = await db.syncState.get('farm')
    if (!state) throw new Error('Device not linked')
    const keys = entry.operation.mutations.map(keyOf)
    const later = await db.syncJournal.where('entities').anyOf(keys).distinct()
      .filter((row) => row.sequence! > sequence && row.status !== 'resolved').sortBy('sequence')
    if (later.some((row) => row.status !== 'queued' || row.attempts || row.entities.some((key) => !keys.includes(key)))) {
      throw new Error('Later dependent operations still pending')
    }
    const allDrafts = new Map([...entry.operation.mutations, ...later.flatMap((row) => row.operation.mutations)]
      .map((item) => [keyOf(item), item]))
    const changes = keys.map((key) => allDrafts.get(key)!)
    for (const row of later) await db.syncJournal.update(row.sequence!, { status: 'resolved' })
    if (choice === 'server') {
      if (!remote.size) throw new Error('No matching server records for this conflict')
      const missing = changes.filter((change) => !remote.has(keyOf(change)))
      if (missing.some((item) => item.type !== 'create')) throw new Error('Missing server record')
      for (const change of remote.values()) {
        await apply(db, change)
        await db.syncRevisions.put({ id: keyOf(change), version: change.version })
      }
      if (missing.length) {
        const operation = operationSchema.parse({ ...entry.operation, id: crypto.randomUUID(), initial: false, mutations: missing })
        await db.syncJournal.add({ ...entry, sequence: undefined, status: 'resolved' })
        await db.syncJournal.update(sequence, { operation, entities: missing.map(keyOf), status: 'queued', attempts: 0, retryAt: 0, conflict: undefined })
      } else await db.syncJournal.update(sequence, { status: 'resolved' })
      return
    }
    const mutations = changes.map((item): Mutation => {
      const record = remote.get(keyOf(item))
      return { ...item, base: record?.version ?? 0, type: record ? item.type === 'create' ? 'update' : item.type : 'create' }
    })
    const operation = operationSchema.parse({ ...entry.operation, id: crypto.randomUUID(), initial: false, mutations })
    await db.syncJournal.add({ operation: entry.operation, entities: keys, attempts: entry.attempts, retryAt: 0, status: 'resolved', conflict: entry.conflict })
    await db.syncJournal.update(sequence, { operation, status: 'queued', attempts: 0, retryAt: 0, conflict: undefined })
  })
}

export async function recoverSession(db: LivestockDatabase, session: Session) {
  await db.transaction('rw', db.syncState, db.syncJournal, async () => {
    const state = await db.syncState.get('farm')
    if (!state || state.deviceId === session.deviceId) return
    if (state.farmId !== session.farmId || state.identityId !== session.identityId) throw new Error('Mismatched owner session')
    // The server can replay a receipt for the same owner after re-enrollment.
    await db.syncJournal.filter((entry) => entry.status !== 'resolved').modify((entry) => {
      entry.operation.deviceId = session.deviceId
      entry.retryAt = 0
    })
    await db.syncState.put({ ...state, ...session })
  })
}

export async function nextEntry(db: LivestockDatabase) {
  return await db.syncJournal.filter((entry) => entry.status !== 'resolved').first()
}

export function retry(db: LivestockDatabase, entry: Journal) {
  const attempts = entry.attempts + 1
  return db.syncJournal.where(':id').equals(entry.sequence!)
    .filter((row) => row.operation.id === entry.operation.id && row.status === 'queued')
    .modify({ attempts, retryAt: Date.now() + Math.min(300_000, 1000 * 2 ** Math.min(attempts, 9)) })
}

export async function snapshotRemote(pull: (cursor: string) => Promise<Page>) {
  const snapshot = new Map<string, Change>()
  let cursor = '0'
  for (let n = 0; n < 200; n++) {
    const page = await pull(cursor)
    let seen = BigInt(cursor)
    for (const row of page.changes) {
      if (BigInt(row.cursor) !== ++seen) throw new Error('Invalid snapshot sequence')
      snapshot.set(keyOf(row), row)
    }
    if (page.cursor !== String(seen) || page.more && page.cursor === cursor) throw new Error('Invalid snapshot cursor')
    cursor = page.cursor
    if (!page.more) return { cursor, records: [...snapshot.values()] }
  }
  throw new Error('Snapshot exceeds current review limit')
}

export async function detach(db: LivestockDatabase) {
  await db.transaction('rw', [...syncTables(db)], async () => {
    if (await nextEntry(db)) throw new Error('Pending synchronization')
    await db.syncState.delete('farm')
    await db.syncRevisions.clear()
  })
}
