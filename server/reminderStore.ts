import {randomUUID} from 'node:crypto'
import type {Transaction,Sql} from './pushStore.js'
import {createPushStore} from './pushStore.js'
import {digest,type pushSecrets,type EnrolledSubscription} from './pushSecurity.js'
import {dueSummary,localClock,reminderPreferences,summaryId,type ReminderPreferences} from './reminderSchedule.js'
import type {AuthSession} from '../src/features/auth/protocol.js'
import type {PushMessage} from '../src/features/notifications/models.js'

type Secrets=ReturnType<typeof pushSecrets>
type Binding={sync_device_id:string;push_device_id:string;preferences:unknown;endpoint_hash:string;sealed_subscription:string}
export function createReminderStore(transaction:Transaction,secrets:Secrets,deliver:(subscription:EnrolledSubscription,message:PushMessage)=>Promise<number>){
 const push=createPushStore(transaction)
 async function requireOwner(sql:Sql,actor:AuthSession){
  await sql.query('SELECT id FROM livestock_sync.farms WHERE id=$1 FOR UPDATE',[actor.farmId])
  const result=await sql.query(`SELECT d.id FROM livestock_sync.devices d JOIN livestock_sync.accounts a ON a.id=d.account_id AND a.farm_id=d.farm_id AND a.identity_id=d.identity_id JOIN livestock_sync.farm_members m ON m.farm_id=d.farm_id AND m.identity_id=d.identity_id WHERE d.id=$1 AND d.farm_id=$2 AND d.account_id=$3 AND d.revoked_at IS NULL AND d.expires_at>now() AND a.enabled AND a.role='ADMIN'`,[actor.deviceId,actor.farmId,actor.accountId])
  if(!result.rows.length)throw Error('Account no longer authorized')
 }
 const active=`SELECT b.*,d.farm_id,p.endpoint_hash,p.sealed_subscription FROM livestock_sync.reminder_devices b
 JOIN public.livestock_push_devices p ON p.id=b.push_device_id
 JOIN livestock_sync.devices d ON d.id=b.sync_device_id
 JOIN livestock_sync.accounts a ON a.id=d.account_id AND a.farm_id=d.farm_id AND a.identity_id=d.identity_id
 JOIN livestock_sync.farm_members m ON m.farm_id=d.farm_id AND m.identity_id=d.identity_id
 WHERE d.revoked_at IS NULL AND d.expires_at>now() AND a.enabled AND a.role='ADMIN' AND p.expires_at>now()`
 async function send(binding:Binding,id:string,language:'sq'|'en',kind:'test'|'reminder'){
  const reserved=await push.operate({kind:'test',deviceId:binding.push_device_id,requestId:id,language,endpointHash:binding.endpoint_hash})
  if(reserved.kind!=='send')return reserved.kind
  // Recheck revocation after reserving and before network I/O.
  const valid=await transaction(async sql=>(await sql.query(active+' AND b.sync_device_id=$1',[binding.sync_device_id])).rows.length>0)
  if(!valid)return 'unauthorized'
  let status:number
  try{status=await deliver(secrets.open(binding.push_device_id,binding.sealed_subscription),{kind,id,language})}catch{return 'serverAccepted'}
  const outcome=status===404||status===410?'expired':status>=200&&status<300?'providerAccepted':'providerRejected'
  await push.complete(binding.push_device_id,id,outcome)
  return outcome
 }
 return {
  status:(actor:AuthSession)=>transaction(async sql=>{
   const rows=await sql.query<Binding>(active+' AND b.sync_device_id=$1',[actor.deviceId])
   const devices=await sql.query<{id:string;label:string}>(`SELECT d.id,d.label FROM livestock_sync.reminder_devices b JOIN livestock_sync.devices d ON d.id=b.sync_device_id JOIN public.livestock_push_devices p ON p.id=b.push_device_id WHERE d.farm_id=$1 AND d.revoked_at IS NULL AND d.expires_at>now() AND p.expires_at>now()`,[actor.farmId])
   return {enrolled:rows.rows.length>0,preferences:rows.rows[0]?.preferences,devices:devices.rows}
  }),
  enroll:(actor:AuthSession,subscription:EnrolledSubscription,preferences:ReminderPreferences)=>transaction(async sql=>{
   await requireOwner(sql,actor)
   const prefs=reminderPreferences.parse(preferences)
   await sql.query('SELECT pg_advisory_xact_lock(17320107)')
   const prior=(await sql.query<{push_device_id:string}>('SELECT push_device_id FROM livestock_sync.reminder_devices WHERE sync_device_id=$1',[actor.deviceId])).rows[0]
   const endpointHash=digest(subscription.endpoint)
   const existing=(await sql.query<{id:string}>('SELECT id FROM public.livestock_push_devices WHERE endpoint_hash=$1',[endpointHash])).rows[0]
   let id=prior?.push_device_id??randomUUID()
   // A subscription cannot be taken from another account or farm.
   if(existing&&existing.id!==prior?.push_device_id){
    const owner=(await sql.query<{account_id:string}>(`SELECT d.account_id FROM livestock_sync.reminder_devices b JOIN livestock_sync.devices d ON d.id=b.sync_device_id WHERE b.push_device_id=$1`,[existing.id])).rows[0]
    if(owner?.account_id!==actor.accountId)throw Error('Subscription ownership conflict')
    // A normal re-login keeps this physical endpoint's delivery receipts.
    if(prior)await sql.query('DELETE FROM public.livestock_push_devices WHERE id=$1',[prior.push_device_id])
    await sql.query('UPDATE livestock_sync.reminder_devices SET sync_device_id=$1,preferences=$2 WHERE push_device_id=$3',[actor.deviceId,prefs,existing.id])
    id=existing.id
   }
   const expires=Math.min(subscription.expirationTime??Infinity,Date.parse(actor.expiresAt))
   if(expires<=Date.now())throw Error('Expired subscription')
   await sql.query(`INSERT INTO public.livestock_push_devices(id,principal_id,endpoint_hash,sealed_subscription,expires_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET endpoint_hash=excluded.endpoint_hash,sealed_subscription=excluded.sealed_subscription,expires_at=excluded.expires_at`,[id,actor.identityId,endpointHash,secrets.seal(id,subscription),new Date(expires).toISOString()])
   await sql.query(`INSERT INTO livestock_sync.reminder_devices(sync_device_id,push_device_id,preferences) VALUES($1,$2,$3) ON CONFLICT(sync_device_id) DO UPDATE SET preferences=excluded.preferences`,[actor.deviceId,id,prefs])
  }),
  preferences:(actor:AuthSession,preferences:ReminderPreferences)=>transaction(async sql=>{await requireOwner(sql,actor);await sql.query('UPDATE livestock_sync.reminder_devices SET preferences=$2 WHERE sync_device_id=$1',[actor.deviceId,reminderPreferences.parse(preferences)])}),
  revoke:(actor:AuthSession)=>transaction(async sql=>{await requireOwner(sql,actor);await sql.query('DELETE FROM public.livestock_push_devices WHERE id IN(SELECT push_device_id FROM livestock_sync.reminder_devices WHERE sync_device_id=$1)',[actor.deviceId])}),
  test:async(actor:AuthSession,id:string)=>{
   const binding=await transaction(async sql=>(await sql.query<Binding>(active+' AND b.sync_device_id=$1',[actor.deviceId])).rows[0])
   if(!binding)return 'unauthorized'
   return send(binding,id,reminderPreferences.parse(binding.preferences).language,'test')
  },
  run:async(now=new Date(),{dryRun=false}:{dryRun?:boolean}={})=>{
   const identity=dryRun?await transaction(async sql=>(await sql.query<{database:string;databaseRole:string}>('SELECT current_database() AS database,current_user AS "databaseRole"')).rows[0]):undefined
   const bindings=await transaction(sql=>sql.query<Binding&{farm_id:string}>(active+' AND (b.preferences->>\'enabled\')::boolean ORDER BY b.sync_device_id LIMIT 100'))
   let accepted=0,eligible=0
   for(const binding of bindings.rows){
    const prefs=reminderPreferences.parse(binding.preferences)
    const input=await transaction(async sql=>{
     await sql.query('SELECT id FROM livestock_sync.farms WHERE id=$1 FOR SHARE',[binding.farm_id])
     const read=async(table:string)=>(await sql.query<{payload:unknown}>('SELECT payload FROM livestock_sync.'+table+' WHERE farm_id=$1',[binding.farm_id])).rows.map(row=>row.payload)
     const [tasks,events,vaccinations,archivedRows]=await Promise.all([read('tasks'),read('health_events'),read('vaccinations'),sql.query<{id:string}>("SELECT id FROM livestock_sync.animals WHERE farm_id=$1 AND payload->>'status'='archived'",[binding.farm_id])])
     return {tasks,events,vaccinations,archived:new Set(archivedRows.rows.map(r=>r.id))}
    })
    if(!dueSummary(input,prefs,now))continue
    eligible++
    if(dryRun)continue
    const result=await send(binding,summaryId(binding.push_device_id,localClock(now,prefs.timeZone).date),prefs.language,'reminder')
    if(result==='providerAccepted')accepted++
   }
   return {checked:bindings.rows.length,eligible,accepted,dryRun,...(identity??{})}
  },
 }
}
