import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { changeSchema, entities, entitySchemas, payloadFor, type Entity, type Operation, type Result } from '../src/features/sync/protocol.js'
import type { Sql, Transaction } from './pushStore.js'
import { validateReceiptFingerprints } from '../src/features/backup/receipts.js'
import { BackupError } from '../src/features/backup/format.js'

const tables: Record<Entity, string> = {
  species: 'species', groups: 'animal_groups', animals: 'animals', healthEvents: 'health_events',
  vaccinations: 'vaccinations', treatments: 'treatments', veterinaryOperations: 'veterinary_operations', tasks: 'tasks',
}
export const token = () => randomBytes(32).toString('base64url')
export const hash = (value: string) => createHash('sha256').update(value).digest('hex')
type Device = { id: string; farm_id: string; identity_id: string; name: string }
type RecordState = { version: string | number; payload: unknown }

async function allowed(sql: Sql, scope: string, maximum: number) {
  const bucket = (await sql.query<{ bucket: string }>("SELECT floor(extract(epoch FROM now())/60)::bigint AS bucket")).rows[0].bucket
  await sql.query('DELETE FROM quota WHERE bucket < $1::bigint - 120', [bucket])
  const result = await sql.query(
    `INSERT INTO quota (bucket,scope,attempts) VALUES ($1,$2,1)
     ON CONFLICT (bucket,scope) DO UPDATE SET attempts=quota.attempts+1
     WHERE quota.attempts < $3 RETURNING attempts`, [bucket, scope, maximum],
  )
  return result.rows.length > 0
}

async function dependencies(sql: Sql, farm: string, operation: Operation) {
  // The foreign keys handle direct links. These checks enforce the invariants that span rows.
  const ids = (entity: Entity) => operation.mutations.filter((m) => m.entity === entity).map((m) => m.recordId)
  const animals = ids('animals')
  if (animals.length) {
    const cycle = await sql.query(
      `WITH RECURSIVE lineage(id,parents,path,cycle) AS (
         SELECT id,ARRAY[dam_id,sire_id],ARRAY[id],false FROM animals WHERE farm_id=$1 AND id=ANY($2::uuid[])
         UNION ALL
         SELECT a.id,ARRAY[a.dam_id,a.sire_id],l.path||a.id,a.id=ANY(l.path)
         FROM lineage l JOIN animals a ON a.farm_id=$1 AND a.id=ANY(l.parents) WHERE NOT l.cycle
       ) SELECT 1 FROM lineage WHERE cycle LIMIT 1`, [farm, animals],
    )
    if (cycle.rows.length) return false
  }
  const events = ids('healthEvents')
  if (events.length) {
    const invalid = await sql.query(
      `SELECT 1 FROM health_events h WHERE h.farm_id=$1 AND h.id=ANY($2::uuid[]) AND (
         ((h.amends_id IS NULL) <> (h.payload->>'amendmentReason' IS NULL))
         OR (h.payload ? 'batchId' AND (h.kind <> 'vaccination' OR h.amends_id IS NOT NULL OR NOT EXISTS (
           SELECT 1 FROM veterinary_operations o CROSS JOIN LATERAL jsonb_array_elements(o.payload->'results') item
           WHERE o.farm_id=h.farm_id AND o.id=(h.payload->>'batchId')::uuid AND item->>'eventId'=h.id::text
         )))
         OR (h.kind='vaccination' AND NOT EXISTS (SELECT 1 FROM vaccinations v WHERE v.farm_id=h.farm_id AND v.event_id=h.id))
         OR (h.kind='treatment' AND NOT EXISTS (SELECT 1 FROM treatments t WHERE t.farm_id=h.farm_id AND t.event_id=h.id))
       ) LIMIT 1`, [farm, events],
    )
    if (invalid.rows.length) return false
  }
  const receipts = ids('veterinaryOperations')
  if (receipts.length) {
    const invalid = await sql.query(
      `SELECT 1 FROM veterinary_operations v CROSS JOIN LATERAL jsonb_array_elements(v.payload->'results') r
       WHERE v.farm_id=$1 AND v.id=ANY($2::uuid[]) AND NOT EXISTS (
         SELECT 1 FROM health_events h WHERE h.farm_id=v.farm_id AND h.id=(r->>'eventId')::uuid
           AND h.animal_id=(r->>'animalId')::uuid AND (h.payload->>'batchId' IS NULL OR h.payload->>'batchId'=v.id::text)
       ) LIMIT 1`, [farm, receipts],
    )
    if (invalid.rows.length) return false
    const scoped = await sql.query<{ receipt: unknown; event: unknown; vaccine: unknown; treatment: unknown }>(
      `SELECT o.payload AS receipt,h.payload AS event,v.payload AS vaccine,t.payload AS treatment
       FROM veterinary_operations o CROSS JOIN LATERAL jsonb_array_elements(o.payload->'results') item
       JOIN health_events h ON h.farm_id=o.farm_id AND h.id=(item->>'eventId')::uuid
       LEFT JOIN vaccinations v ON v.farm_id=h.farm_id AND v.event_id=h.id
       LEFT JOIN treatments t ON t.farm_id=h.farm_id AND t.event_id=h.id
       WHERE o.farm_id=$1 AND o.id=ANY($2::uuid[])`, [farm, receipts],
    )
    const operations = new Map(scoped.rows.map(({ receipt }) => {
      const row = entitySchemas.veterinaryOperations.parse(receipt)
      return [row.id, row]
    }))
    const eventIds = scoped.rows.map(({ event }) => entitySchemas.healthEvents.parse(event))
    if (new Set(eventIds.map(({ id }) => id)).size !== eventIds.length) return false
    try {
      await validateReceiptFingerprints({
        veterinaryOperations: [...operations.values()], healthEvents: eventIds,
        vaccinations: scoped.rows.flatMap(({ vaccine }) => vaccine ? [entitySchemas.vaccinations.parse(vaccine)] : []),
        treatments: scoped.rows.flatMap(({ treatment }) => treatment ? [entitySchemas.treatments.parse(treatment)] : []),
      })
    } catch (error) {
      if (error instanceof BackupError) return false
      throw error
    }
  }
  const tasks = ids('tasks')
  if (!tasks.length) return true
  const invalid = await sql.query(
    `SELECT 1 FROM tasks t JOIN health_events h ON h.farm_id=t.farm_id AND h.id=t.event_id
     WHERE t.farm_id=$1 AND t.id=ANY($2::uuid[]) AND (t.animal_id IS DISTINCT FROM h.animal_id OR h.amends_id IS NOT NULL
       OR NOT ((t.kind='vaccination' AND h.kind='vaccination') OR (t.kind='treatmentFollowUp' AND h.kind='treatment')
       OR (t.kind='checkup' AND h.kind IN ('checkup','followUp')))) LIMIT 1`, [farm, tasks],
  )
  return !invalid.rows.length
}

async function push(sql: Sql, device: Device, operation: Operation) {
  if (operation.farmId !== device.farm_id || operation.deviceId !== device.id) return undefined
  const farm = device.farm_id
  const fingerprint = hash(JSON.stringify({ ...operation, deviceId: null }))
  const previous = (await sql.query<{ identity_id: string; fingerprint: string; result: Result }>(
    'SELECT d.identity_id,r.fingerprint,r.result FROM receipts r JOIN devices d ON d.id=r.device_id WHERE r.farm_id=$1 AND r.id=$2',
    [farm, operation.id],
  )).rows[0]
  if (previous) return previous.identity_id === device.identity_id && previous.fingerprint === fingerprint ? previous.result : undefined
  const records = new Map<string, RecordState>()
  for (const entity of entities) {
    const ids = operation.mutations.filter((m) => m.entity === entity).map((m) => m.recordId)
    if (!ids.length) continue
    const found = await sql.query<RecordState & { id: string }>(
      'SELECT id,version,payload FROM ' + tables[entity] + ' WHERE farm_id=$1 AND id=ANY($2::uuid[])', [farm, ids],
    )
    for (const row of found.rows) records.set(entity + ':' + row.id, row)
  }
  const existing = operation.mutations.map((m) => records.get(m.entity + ':' + m.recordId))
  const current = existing.flatMap((record, index) => record ? [changeSchema.parse({
    entity: operation.mutations[index].entity, recordId: operation.mutations[index].recordId,
    cursor: '0', version: Number(record.version), payload: record.payload,
  })] : [])
  const save = async (result: Result) => {
    await sql.query('INSERT INTO receipts (farm_id,device_id,id,fingerprint,result) VALUES ($1,$2,$3,$4,$5)',
      [farm, device.id, operation.id, fingerprint, JSON.stringify(result)])
    return result
  }
  const oldCursor = (await sql.query<{ cursor: string }>('SELECT cursor FROM farms WHERE id=$1', [farm])).rows[0].cursor
  if (operation.initial && Number(oldCursor) !== 0) return await save({ status: 'conflict', reason: 'initial', current })
  if (operation.mutations.some((m, i) => m.base !== Number(existing[i]?.version ?? 0)
    || existing[i]?.payload === null)) {
    return await save({ status: 'conflict', reason: 'stale', current })
  }
  const forbidden = operation.mutations.some((m, i) => {
    if (!existing[i] || m.type === 'create') return false
    if (m.entity === 'animals') {
      const prior = entitySchemas.animals.parse(existing[i].payload)
      return entitySchemas.animals.parse(m.payload).createdAt !== prior.createdAt
    }
    if (m.entity !== 'tasks') return false
    const prior = entitySchemas.tasks.parse(existing[i].payload)
    if (m.type === 'delete') return Boolean(prior.healthEventId)
    const next = entitySchemas.tasks.parse(m.payload)
    return prior.status !== 'pending' || prior.createdAt !== next.createdAt || prior.healthEventId !== next.healthEventId ||
      Boolean(prior.healthEventId && (prior.animalId !== next.animalId || prior.type !== next.type))
  })
  if (forbidden) return await save({ status: 'conflict', reason: 'constraint', current })
  await sql.query('SAVEPOINT sync_records')
  try {
    const start = BigInt(oldCursor)
    const rows = operation.mutations.map((m, i) => ({
      entity: m.entity, record_id: m.recordId, type: m.type, version: m.base + 1,
      cursor: String(start + BigInt(i + 1)), payload: m.payload === null ? null : payloadFor(m.entity, m.payload),
    }))
    for (const entity of entities) {
      const inserts = rows.filter((r) => r.entity === entity && r.type === 'create')
      const edits = rows.filter((r) => r.entity === entity && r.type !== 'create')
      const columns = 'jsonb_to_recordset($2::jsonb) AS r(record_id uuid,version bigint,payload jsonb)'
      if (inserts.length) await sql.query('INSERT INTO ' + tables[entity]
        + ' (farm_id,id,version,payload) SELECT $1,r.record_id,r.version,r.payload FROM ' + columns, [farm, JSON.stringify(inserts)])
      if (edits.length) await sql.query('UPDATE ' + tables[entity]
        + ' t SET version=r.version,payload=r.payload FROM ' + columns + ' WHERE t.farm_id=$1 AND t.id=r.record_id', [farm, JSON.stringify(edits)])
    }
    await sql.query(`INSERT INTO changes(farm_id,cursor,entity,record_id,version,payload)
      SELECT $1,r.cursor,r.entity,r.record_id,r.version,r.payload FROM jsonb_to_recordset($2::jsonb)
      AS r(cursor bigint,entity text,record_id uuid,version bigint,payload jsonb)`, [farm, JSON.stringify(rows)])
    const cursor = rows.at(-1)!.cursor
    const versions = rows.map((r) => ({ entity: r.entity, recordId: r.record_id, version: r.version }))
    await sql.query('SET CONSTRAINTS ALL IMMEDIATE')
    if (!await dependencies(sql, farm, operation)) {
      await sql.query('ROLLBACK TO SAVEPOINT sync_records')
      return await save({ status: 'conflict', reason: 'constraint', current })
    }
    await sql.query('UPDATE farms SET cursor=$2 WHERE id=$1', [farm, String(cursor)])
    return await save({ status: 'applied', versions })
  } catch (error) {
    if (!['23505', '23503', '23514'].includes((error as { code?: string }).code ?? '')) throw error
    await sql.query('ROLLBACK TO SAVEPOINT sync_records')
    return await save({ status: 'conflict', reason: 'constraint', current })
  }
}

export function createSyncStore(transaction: Transaction) {
  function transact<T>(work: (sql: Sql) => Promise<T>) {
    return transaction(async (sql) => {
      await sql.query('SET LOCAL search_path TO livestock_sync, pg_catalog')
      return await work(sql)
    })
  }
  return {
    enroll: (code: string, label: string) => transact(async (sql) => {
      if (!await allowed(sql, 'enroll', 30)) return { limited: true as const }
      const grant = (await sql.query<{ farm_id: string; identity_id: string }>(
        'UPDATE enrollment SET used_at=now() WHERE code_digest=$1 AND used_at IS NULL AND expires_at>now() RETURNING farm_id,identity_id',
        [hash(code)],
      )).rows[0]
      if (!grant) return undefined
      const secret = token()
      const deviceId = randomUUID()
      await sql.query('INSERT INTO devices(id,farm_id,identity_id,label,token_digest) VALUES ($1,$2,$3,$4,$5)',
        [deviceId, grant.farm_id, grant.identity_id, label, hash(secret)])
      const name = (await sql.query<{ name: string }>('SELECT name FROM farms WHERE id=$1', [grant.farm_id])).rows[0].name
      return { secret, session: { farmId: grant.farm_id, identityId: grant.identity_id, deviceId, name } }
    }),
    authorized: <T>(secret: string, work: (sql: Sql, device: Device) => Promise<T>) => transact(async (sql) => {
      const digest = hash(secret)
      const device = (await sql.query<Device>(
        `SELECT d.id,d.farm_id,d.identity_id,f.name FROM devices d JOIN farms f ON f.id=d.farm_id
         JOIN farm_members m ON m.farm_id=d.farm_id AND m.identity_id=d.identity_id
         WHERE d.token_digest=$1 AND d.revoked_at IS NULL AND d.created_at>now()-interval '90 days'`, [digest],
      )).rows[0]
      if (!device) return { unauthorized: true as const }
      // Serialize version allocation and revocation for each farm, including across serverless instances.
      await sql.query('SELECT id FROM farms WHERE id=$1 FOR UPDATE', [device.farm_id])
      const active = await sql.query('SELECT 1 FROM devices d JOIN farm_members m USING (farm_id,identity_id) WHERE d.id=$1 AND revoked_at IS NULL', [device.id])
      if (!active.rows.length) return { unauthorized: true as const }
      if (!await allowed(sql, device.farm_id, 300)) return { limited: true as const }
      return { value: await work(sql, device) }
    }),
    push,
    pull: async (sql: Sql, device: Device, cursor: string, limit: number) => {
      const result = await sql.query(
        `SELECT c.entity,c.record_id AS "recordId",c.cursor::text,c.version::text,c.payload FROM changes c
         WHERE c.farm_id=$1 AND c.cursor>$2 ORDER BY c.cursor LIMIT $3`, [device.farm_id, cursor, limit + 1],
      )
      const changes = result.rows.slice(0, limit).map((r) => changeSchema.parse({ ...r, version: Number(r.version) }))
      return { changes, cursor: changes.at(-1)?.cursor ?? cursor, more: result.rows.length > limit }
    },
    devices: async (sql: Sql, device: Device) => (await sql.query<{ id: string; label: string; revoked: boolean; createdAt: Date }>(
      'SELECT id,label,revoked_at IS NOT NULL AS revoked,created_at AS "createdAt" FROM devices WHERE farm_id=$1 AND identity_id=$2 ORDER BY created_at',
      [device.farm_id, device.identity_id],
    )).rows.map((row) => ({ ...row, createdAt: new Date(row.createdAt).toISOString() })),
    invite: async (sql: Sql, device: Device) => {
      if (!await allowed(sql, 'invite:' + device.farm_id, 3)) return undefined
      const code = token()
      await sql.query("INSERT INTO enrollment (code_digest,farm_id,identity_id,expires_at) VALUES ($1,$2,$3,now()+interval '15 minutes')",
        [hash(code), device.farm_id, device.identity_id])
      return { code }
    },
    revoke: async (sql: Sql, device: Device, target: string) => {
      await sql.query('UPDATE devices SET revoked_at=now() WHERE farm_id=$1 AND identity_id=$2 AND id=$3 AND revoked_at IS NULL',
        [device.farm_id, device.identity_id, target])
      return { revoked: true }
    },
  }
}
export const syncTables = entities.map((entity) => tables[entity])
