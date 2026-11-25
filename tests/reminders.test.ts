import {randomUUID,randomBytes,createECDH} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {createServer} from 'node:http'
import {PGlite} from '@electric-sql/pglite'
import {expect,test,vi} from 'vitest'
import {dueSummary,localClock,reminderPreferences,summaryId} from '../server/reminderSchedule'
import {createReminderStore} from '../server/reminderStore'
import {createReminderHandler} from '../api/reminders'
import {createAuthStore} from '../server/authStore'
import {pushSecrets} from '../server/pushSecurity'
import {showTestPush,openNotification} from '../src/features/notifications/worker'
import type {Transaction} from '../server/pushStore'
import type {AuthSession} from '../src/features/auth/protocol'

const id=()=>randomUUID(),time='2026-11-21T00:00:00.000Z'
const prefs=reminderPreferences.parse({enabled:true,language:'sq',reminderTime:'08:00',leadDays:2,timeZone:'Europe/Tirane'})
const task={id:id(),title:'Synthetic check',type:'general',status:'pending',dueDate:'2026-11-23',createdAt:time,updatedAt:time}
const empty={tasks:[],events:[],vaccinations:[],archived:new Set<string>()}

test('daily local reminder windows handle DST, timezone boundaries, disabled and overdue work',()=>{
 expect(localClock(new Date('2026-03-29T01:00:00Z'),'Europe/Tirane')).toEqual({date:'2026-03-29',time:'03:00'})
 expect(localClock(new Date('2026-10-25T00:30:00Z'),'Europe/Tirane')).toEqual({date:'2026-10-25',time:'02:30'})
 expect(localClock(new Date('2026-10-25T01:30:00Z'),'Europe/Tirane')).toEqual({date:'2026-10-25',time:'02:30'})
 expect(localClock(new Date('2026-11-21T00:30:00Z'),'America/New_York').date).toBe('2026-11-20')
 expect(dueSummary({...empty,tasks:[task]},prefs,new Date('2026-11-21T07:00:00Z'))).toBe(true)
 expect(dueSummary({...empty,tasks:[task]},prefs,new Date('2026-11-21T06:59:00Z'))).toBe(false)
 expect(dueSummary({...empty,tasks:[task]},{...prefs,enabled:false},new Date('2026-11-21T09:00:00Z'))).toBe(false)
 expect(dueSummary({...empty,tasks:[{...task,dueDate:'2026-11-01'}]},prefs,new Date('2026-11-21T09:00:00Z'))).toBe(true)
 expect(dueSummary({...empty,tasks:[{...task,status:'cancelled'}]},prefs,new Date('2026-11-21T09:00:00Z'))).toBe(false)
 expect(summaryId(task.id,'2026-10-25')).toBe(summaryId(task.id,'2026-10-25'))
 expect(summaryId(task.id,'2026-10-26')).not.toBe(summaryId(task.id,'2026-10-25'))
})
test('clinical reminders use explicit dates and latest amendments, avoiding tasks and archived animals',()=>{
 const animalId=id(),first={id:id(),animalId,kind:'vaccination',dateOnly:true,occurredAt:time,createdAt:time,updatedAt:time}
 const amendment={...first,id:id(),amendsId:first.id,amendmentReason:'Later date'}
 const v={id:id(),healthEventId:first.id,animalId,productName:'Synthetic',administeredAt:time,nextDueAt:'2026-11-22T00:00:00.000Z'}
 const next={...v,id:id(),healthEventId:amendment.id,nextDueAt:'2027-01-01T00:00:00.000Z'}
 const now=new Date('2026-11-21T09:00:00Z')
 expect(dueSummary({...empty,events:[first],vaccinations:[v]},prefs,now)).toBe(true)
 expect(dueSummary({...empty,events:[first,amendment],vaccinations:[v,next]},prefs,now)).toBe(false)
 expect(dueSummary({...empty,events:[first],vaccinations:[{...v,nextDueAt:undefined}]},prefs,now)).toBe(false)
 expect(dueSummary({...empty,events:[first],vaccinations:[v],archived:new Set([animalId])},prefs,now)).toBe(false)
 expect(dueSummary({...empty,events:[first],vaccinations:[v],tasks:[{...task,type:'vaccination',animalId,healthEventId:first.id,status:'cancelled'}]},prefs,now)).toBe(false)
})
test('authenticated enrollment, stable dispatch receipts, expired subscriptions and revoked device denial',async()=>{
 const pg=new PGlite()
 try{
  for(const file of ['server/push-schema.sql','server/sync-schema.sql','server/sync-runtime.sql','server/auth-schema.sql','server/reminder-schema.sql'])await pg.exec(await readFile(file,'utf8'))
  const transaction:Transaction=work=>pg.transaction(async sql=>{await sql.exec('SET LOCAL ROLE livestock_sync_runtime');return work({query:(text,args)=>sql.query(text,args)})})
  const farm=id(),identity=id(),account=id(),device=id()
  await pg.query('INSERT INTO livestock_sync.farms(id,name) VALUES($1,$2)',[farm,'Synthetic'])
  await pg.query('INSERT INTO livestock_sync.identities(id) VALUES($1)',[identity])
  await pg.query('INSERT INTO livestock_sync.farm_members(farm_id,identity_id) VALUES($1,$2)',[farm,identity])
  await pg.query("INSERT INTO livestock_sync.accounts(id,farm_id,identity_id,username,role,password_hash) VALUES($1,$2,$3,'adi','ADMIN','synthetic unused')",[account,farm,identity])
  await pg.query("INSERT INTO livestock_sync.devices(id,farm_id,identity_id,label,token_digest,account_id,expires_at) VALUES($1,$2,$3,'Synthetic','unused',$4,now()+interval '30 days')",[device,farm,identity,account])
  const actor:AuthSession={accountId:account,farmId:farm,identityId:identity,deviceId:device,username:'adi',role:'ADMIN',name:'Synthetic',expiresAt:new Date(Date.now()+86400000).toISOString()}
  const key=createECDH('prime256v1');key.generateKeys()
  const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/synthetic',keys:{p256dh:key.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}}
  const deliver=vi.fn(async()=>201),secrets=pushSecrets(randomBytes(32)),store=createReminderStore(transaction,secrets,deliver)
  await store.enroll(actor,subscription,prefs)
  expect(await store.status(actor)).toMatchObject({enrolled:true,preferences:prefs})
  await pg.query('INSERT INTO livestock_sync.tasks(farm_id,id,version,payload) VALUES($1,$2,1,$3)',[farm,task.id,task])
  const dry=await store.run(new Date('2026-11-21T09:00:00Z'),{dryRun:true})
  expect(dry).toMatchObject({checked:1,eligible:1,accepted:0,dryRun:true,databaseRole:'livestock_sync_runtime'})
  expect(deliver).not.toHaveBeenCalled()
  expect((await pg.query<{n:number}>('SELECT count(*)::int AS n FROM public.livestock_push_receipts')).rows[0].n).toBe(0)
  expect((await pg.query<{n:number}>('SELECT count(*)::int AS n FROM public.livestock_push_quota')).rows[0].n).toBe(0)
  await Promise.all([store.run(new Date('2026-11-21T09:00:00Z')),store.run(new Date('2026-11-21T09:00:00Z'))])
  await store.run(new Date('2026-11-21T09:01:00Z'))
  expect(deliver).toHaveBeenCalledTimes(1)
  expect(deliver.mock.calls[0]).toBeDefined()
  const nextDevice=id()
  await pg.query("INSERT INTO livestock_sync.devices(id,farm_id,identity_id,label,token_digest,account_id,expires_at) VALUES($1,$2,$3,'Re-login','second-unused',$4,now()+interval '30 days')",[nextDevice,farm,identity,account])
  actor.deviceId=nextDevice
  await store.enroll(actor,subscription,prefs)
  await store.run(new Date('2026-11-21T09:02:00Z'))
  expect(deliver).toHaveBeenCalledTimes(1)
  await pg.query('UPDATE livestock_sync.devices SET revoked_at=now() WHERE id=$1',[actor.deviceId])
  await store.run(new Date('2026-11-22T09:00:00Z'))
  expect(deliver).toHaveBeenCalledTimes(1)
  await expect(store.enroll(actor,subscription,prefs)).rejects.toThrow()
  expect((await store.status(actor)).enrolled).toBe(false)
  await pg.query('UPDATE livestock_sync.devices SET revoked_at=NULL WHERE id=$1',[actor.deviceId])
  // Provider expiry removes the encrypted endpoint and its account binding.
  deliver.mockResolvedValue(410)
  await pg.query('DELETE FROM public.livestock_push_quota')
  expect(await store.test(actor,id())).toBe('expired')
  expect((await store.status(actor)).enrolled).toBe(false)
 }finally{await pg.close()}
},30000)
test('Vet and anonymous requests cannot administer reminders or invoke the scheduler',async()=>{
 const auth={session:async()=>({role:'VETERINARIAN'})} as unknown as ReturnType<typeof createAuthStore>
 const store={run:vi.fn()} as unknown as ReturnType<typeof createReminderStore>
 const handler=createReminderHandler({origin:'https://example.test',publicKey:'B'+'A'.repeat(86),cronKey:'K'.repeat(43),auth,store})
 const server=createServer((req,res)=>{void handler(req,res)})
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
 try{
  const address=server.address();if(!address||typeof address==='string')throw Error()
  const url='http://127.0.0.1:'+address.port
  expect((await fetch(url,{headers:{cookie:'__Host-livestock-sync=synthetic'}})).status).toBe(403)
  expect((await fetch(url,{method:'POST',headers:{authorization:'Bearer invalid'}})).status).toBe(401)
  expect(store.run).not.toHaveBeenCalled()
  await fetch(url,{method:'POST',headers:{authorization:'Bearer '+'K'.repeat(43),'x-livestock-dry-run':'1'}})
  expect(store.run).toHaveBeenCalledWith(expect.any(Date),{dryRun:true})
  // Vercel Cron uses GET with the bearer key and always performs a real run.
  expect((await fetch(url,{headers:{authorization:'Bearer '+'J'.repeat(43)}})).status).toBe(401)
  expect(store.run).toHaveBeenCalledTimes(1)
  expect((await fetch(url,{headers:{authorization:'Bearer '+'K'.repeat(43)}})).status).toBe(200)
  expect(store.run).toHaveBeenLastCalledWith(expect.any(Date),{dryRun:false})
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
})
test('reminder push deduplicates and opens only the calendar in scope',async()=>{
 const show=vi.fn(async()=>{}),seen=new Set<string>(),message={kind:'reminder',id:id(),language:'sq'}
 await showTestPush(message,show,async id=>seen.has(id),async id=>{seen.add(id)})
 await showTestPush(message,show,async id=>seen.has(id),async id=>{seen.add(id)})
 expect(show).toHaveBeenCalledOnce()
 expect(show.mock.calls[0]).toBeDefined()
 const navigate=vi.fn(async()=>{}),focus=vi.fn(async()=>{}),open=vi.fn(async()=>{})
 await openNotification('https://example.test/',[{url:'https://example.test/animals',focus,navigate}],open,'tasks')
 expect(navigate).toHaveBeenCalledWith('https://example.test/tasks')
 expect(open).not.toHaveBeenCalled()
})

test('one scheduled run reaches every enrolled Admin device without waiting for the next trigger',async()=>{
 const pg=new PGlite()
 try{
  for(const file of ['server/push-schema.sql','server/sync-schema.sql','server/sync-runtime.sql','server/auth-schema.sql','server/reminder-schema.sql'])await pg.exec(await readFile(file,'utf8'))
  const transaction:Transaction=work=>pg.transaction(async sql=>{await sql.exec('SET LOCAL ROLE livestock_sync_runtime');return work({query:(text,args)=>sql.query(text,args)})})
  const farm=id(),identity=id(),account=id()
  await pg.query('INSERT INTO livestock_sync.farms(id,name) VALUES($1,$2)',[farm,'Synthetic'])
  await pg.query('INSERT INTO livestock_sync.identities(id) VALUES($1)',[identity])
  await pg.query('INSERT INTO livestock_sync.farm_members(farm_id,identity_id) VALUES($1,$2)',[farm,identity])
  await pg.query("INSERT INTO livestock_sync.accounts(id,farm_id,identity_id,username,role,password_hash) VALUES($1,$2,$3,'adi','ADMIN','synthetic unused')",[account,farm,identity])
  await pg.query('INSERT INTO livestock_sync.tasks(farm_id,id,version,payload) VALUES($1,$2,1,$3)',[farm,task.id,task])
  const deliver=vi.fn(async()=>201),store=createReminderStore(transaction,pushSecrets(randomBytes(32)),deliver)
  for(const label of ['Phone','Desktop','Tablet']){
   const device=id()
   await pg.query("INSERT INTO livestock_sync.devices(id,farm_id,identity_id,label,token_digest,account_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '30 days')",[device,farm,identity,label,'unused-'+label,account])
   const key=createECDH('prime256v1');key.generateKeys()
   await store.enroll({accountId:account,farmId:farm,identityId:identity,deviceId:device,username:'adi',role:'ADMIN',name:'Synthetic',expiresAt:new Date(Date.now()+86400000).toISOString()},
    {endpoint:'https://fcm.googleapis.com/fcm/send/synthetic-'+label,keys:{p256dh:key.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}},prefs)
  }
  expect(await store.run(new Date('2026-11-21T09:00:00Z'))).toMatchObject({checked:3,eligible:3,accepted:3})
  expect(deliver).toHaveBeenCalledTimes(3)
  // A repeated trigger on the same local day sends nothing new.
  await store.run(new Date('2026-11-21T09:15:00Z'))
  expect(deliver).toHaveBeenCalledTimes(3)
 }finally{await pg.close()}
},30000)
