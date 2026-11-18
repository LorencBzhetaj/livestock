import 'fake-indexeddb/auto'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { LivestockDatabase } from '../src/db/database'
import { createRepositories } from '../src/db/repositories'
import { acknowledge, applyPage, connectLocal, farmWrite, journal, previewLocal, resolve } from '../src/features/sync/local'
import { operationSchema, type Change, type Mutation, type Session } from '../src/features/sync/protocol'
import { createSyncStore, hash, token } from '../server/syncStore'
import type { Transaction } from '../server/pushStore'

const date = '2026-11-18T09:00:00.000Z'
const id = () => randomUUID()
const species = { id: id(), code: 'goat', active: true, displayNameSq: 'Dhi', displayNameEn: 'Goat' } as const
const animal = (tag: string, animalId = id()) => ({
  id: animalId, earTag: tag, speciesId: species.id, sex: 'female', status: 'active', createdAt: date, updatedAt: date,
} as const)
const create = (entity: Mutation['entity'], record: { id: string } & Record<string, unknown>): Mutation => ({
  entity, recordId: record.id, type: 'create', base: 0, payload: record as Mutation['payload'],
})
let pg: PGlite
let store: ReturnType<typeof createSyncStore>
beforeAll(async () => {
  pg = new PGlite()
  await pg.exec(await readFile('server/sync-schema.sql','utf8'))
  await pg.exec(await readFile('server/sync-runtime.sql','utf8'))
  const transaction: Transaction = (work) => pg.transaction(async (database) => {
    await database.exec('SET LOCAL ROLE livestock_sync_runtime')
    return await work({ query: (sql, args) => database.query(sql, args) })
  })
  store = createSyncStore(transaction)
}, 30_000)
afterAll(async () => { await pg?.close() })

async function farm() {
  const farm = id()
  const owner = id()
  await pg.query('INSERT INTO livestock_sync.farms (id,name) VALUES ($1,$2)', [farm, 'Test farm'])
  await pg.query('INSERT INTO livestock_sync.identities (id) VALUES ($1)', [owner])
  await pg.query('INSERT INTO livestock_sync.farm_members (farm_id,identity_id) VALUES ($1,$2)', [farm, owner])
  return async () => {
    const code = token()
    await pg.query("INSERT INTO livestock_sync.enrollment (code_digest,farm_id,identity_id,expires_at) VALUES ($1,$2,$3,now()+interval '15 minutes')", [hash(code), farm, owner])
    const enrolled = await store.enroll(code, 'Test device')
    if (!enrolled?.secret || !enrolled.session) throw new Error('Enrollment failed')
    expect(await store.enroll(code, 'Replay')).toBeUndefined()
    return { secret: enrolled.secret, session: enrolled.session }
  }
}

test('orders concurrent farm changes, returns idempotent receipts, pages 200 animals and enforces farm and device boundaries', async () => {
  const enroll = await farm()
  const first = await enroll()
  const second = await enroll()
  const offsite = await (await farm())()
  const herd = Array.from({length:200}, (_, i) => animal('GOAT-' + i))
  const task = { id: id(), title:'Check fencing', type:'general', status:'pending', dueDate:'2026-11-19', createdAt:date, updatedAt:date }
  const health = { id: id(), animalId: herd[0].id, kind:'checkup', occurredAt:date, createdAt:date, updatedAt:date }
  const correction = { ...health, id:id(), amendsId:health.id, amendmentReason:'Corrected note', notes:'Checked' }
  const initial = operationSchema.parse({ farmId: first.session.farmId, deviceId: first.session.deviceId, id: id(), createdAt: date, initial:true,
    mutations: [create('species',species), ...herd.map((row)=>create('animals',row)), create('healthEvents',health), create('healthEvents',correction), create('tasks',task)],
  })
  const submit = (secret: string, operation: typeof initial) => store.authorized(secret, (sql, device) => store.push(sql, device, operation))
  const [result, replay] = await Promise.all([submit(first.secret,initial),submit(first.secret,initial)])
  expect(result).toMatchObject({value:{status:'applied'}})
  expect(replay).toEqual(result)
  expect(await submit(second.secret, {...initial,deviceId:second.session.deviceId})).toEqual(result)
  expect(await submit(offsite.secret,initial)).toEqual({value:undefined})
  const change = (session: Session, name: string) => ({
    id:id(), farmId:session.farmId,deviceId:session.deviceId,createdAt:date,initial:false,
    mutations:[{...create('animals',{...herd[0],name}),type:'update' as const,base:1}],
  })
  const edits = await Promise.all([submit(first.secret,change(first.session,'First')),submit(second.secret,change(second.session,'Second'))])
  expect(edits.map(({value})=>value?.status).sort()).toEqual(['applied','conflict'])
  const deleted = await submit(second.secret,{...change(second.session,'unused'),mutations:[{entity:'tasks',recordId:task.id,type:'delete',base:1,payload:null}]})
  expect(deleted).toMatchObject({value:{status:'applied'}})
  const changes: Change[] = []
  let cursor = '0'
  for (let i=0;i<5;i++) {
    const page = (await store.authorized(second.secret, (sql, device) => store.pull(sql, device, cursor, 71))).value!
    changes.push(...page.changes)
    cursor=page.cursor
    if (!page.more) break
  }
  expect(changes.map((item)=>Number(item.cursor))).toEqual(changes.map((_,i)=>i+1))
  expect(changes.filter(({entity})=>entity==='animals')).toHaveLength(201)
  expect(changes.at(-1)).toMatchObject({recordId:task.id,payload:null})
  expect(changes.find((row)=>row.recordId===correction.id)?.payload).toMatchObject({amendsId:health.id})
  const batchDb = new LivestockDatabase('batch-' + id())
  try {
    const records = new Map(changes.map((row) => [row.entity + row.recordId, row]))
    await connectLocal(batchDb, first.session, [], [...records.values()], cursor)
    const veterinary = {
      operationId: id(), batch:true, animalIds:herd.slice(0,150).map((row)=>row.id),
      entry:{kind:'vaccination' as const,date:'2026-11-18',productName:'Synthetic',vetName:'Test'},
    }
    await createRepositories(batchDb).health.submit(veterinary)
    await createRepositories(batchDb).health.submit(veterinary)
    const queued = await batchDb.syncJournal.toArray()
    expect(queued).toHaveLength(1)
    expect(queued[0].operation.mutations).toHaveLength(301)
    const saved = await submit(first.secret,queued[0].operation)
    expect(saved).toMatchObject({value:{status:'applied'}})
    expect(await submit(first.secret,queued[0].operation)).toEqual(saved)
    expect((await pg.query('SELECT count(*)::int AS total FROM livestock_sync.vaccinations')).rows[0]).toEqual({ total:150 })
  } finally { await batchDb.delete() }
  const isolated = await store.authorized(offsite.secret,(sql,device)=>store.pull(sql,device,'0',100))
  expect(isolated).toEqual({value:{changes:[],cursor:'0',more:false}})
  await store.authorized(first.secret,(sql,device)=>store.revoke(sql,device,second.session.deviceId))
  expect(await store.authorized(second.secret,async()=>true)).toEqual({unauthorized:true})
}, 30_000)

test('journals repository writes atomically, persists pending edits on reopen, and applies each page and cursor together', async () => {
  const db = new LivestockDatabase('sync-' + id())
  try {
    const session = {farmId:id(),identityId:id(),deviceId:id(),name:'Farm'}
    const repo = createRepositories(db)
    await repo.species.save(species)
    await connectLocal(db,session,await previewLocal(db),[],'0')
    const first = (await db.syncJournal.toArray())[0]
    await acknowledge(db,first,{status:'applied',versions:[{entity:'species',recordId:species.id,version:1}]})
    const input = animal('LOCAL')
    await expect(farmWrite(db,[db.animals],async()=>{
      await db.animals.add(input)
      await journal(db,[{entity:'animals',records:[input]}])
      throw new Error('abort')
    })).rejects.toThrow('abort')
    expect(await db.animals.count()).toBe(0)
    expect(await db.syncJournal.count()).toBe(0)
    await repo.animals.save(input)
    await repo.animals.archive(input.id)
    db.close()
    await db.open()
    const queued = await db.syncJournal.toArray()
    expect(queued.map((entry)=>entry.operation.mutations[0].type)).toEqual(['create','archive'])
    expect(queued.map((entry)=>entry.operation.mutations[0].base)).toEqual([0,1])
    const remote = animal('REMOTE')
    const row = { entity:'animals',recordId:remote.id,payload:remote,cursor:'1',version:1 } as const
    await expect(applyPage(db,session,'0',{changes:[row],cursor:'2',more:false})).rejects.toThrow('cursor')
    expect(await db.animals.get(remote.id)).toBeUndefined()
    await applyPage(db,session,'0',{changes:[row],cursor:'1',more:false})
    await applyPage(db,session,'0',{changes:[row],cursor:'1',more:false})
    expect(await db.animals.count()).toBe(2)
    expect((await db.syncState.get('farm'))?.cursor).toBe('1')
  } finally { await db.delete() }
})

test('preserves rejected drafts while explicitly rebasing the latest local edit', async () => {
  const db = new LivestockDatabase('resolution-' + id())
  try {
    const session = {farmId:id(),identityId:id(),deviceId:id(),name:'Farm'}
    const repo = createRepositories(db)
    const original = animal('REVIEW')
    const baseline: Change[] = [
      { entity:'species',recordId:species.id,payload:species,cursor:'1',version:1 },
      { entity:'animals',recordId:original.id,payload:original,cursor:'2',version:1 },
    ]
    await connectLocal(db,session,[],baseline,'2')
    await repo.animals.save({...original,name:'First draft'})
    const first=(await db.syncJournal.toArray())[0]
    await acknowledge(db,first,{status:'conflict',reason:'stale',current:[
      {...baseline[1],cursor:'0',version:2,payload:{...original,name:'Server edit'}},
    ]})
    await repo.animals.save({...original,name:'Latest draft'})
    await resolve(db,first.sequence!,'local')
    const journalRows=await db.syncJournal.toArray()
    expect(journalRows.filter((row)=>row.status==='resolved')).toHaveLength(2)
    expect(journalRows.find((row)=>row.status==='queued')?.operation.mutations[0]).toMatchObject({base:2,payload:{name:'Latest draft'}})
    expect(journalRows.find((row)=>row.conflict)?.conflict?.current[0].payload).toMatchObject({name:'Server edit'})
  } finally { await db.delete() }
})

test('schema role cannot alter data outside its authorized write surface', async () => {
  await expect(pg.transaction(async(sql)=>{
    await sql.exec('SET LOCAL ROLE livestock_sync_runtime')
    await sql.exec('CREATE TABLE livestock_sync.forbidden (id int)')
  })).rejects.toMatchObject({code:'42501'})
  await expect(pg.transaction(async(sql)=>{
    await sql.exec('SET LOCAL ROLE livestock_sync_runtime')
    await sql.exec("UPDATE livestock_sync.health_events SET payload='{}' WHERE false")
  })).rejects.toMatchObject({code:'42501'})
  await expect(pg.transaction(async(sql)=>{
    await sql.exec('SET LOCAL ROLE livestock_sync_runtime')
    await sql.exec('INSERT INTO livestock_sync.identities(id) SELECT id FROM livestock_sync.identities WHERE false')
  })).rejects.toMatchObject({code:'42501'})
})
