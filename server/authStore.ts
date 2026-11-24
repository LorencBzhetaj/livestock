import { randomUUID } from 'node:crypto'
import type { Transaction, Sql } from './pushStore.js'
import { hash, token } from './syncStore.js'
import { checkPassword, hashPassword } from './passwords.js'
import type { z } from 'zod'
import { authSession, type authRequest } from '../src/features/auth/protocol.js'
type Account = { id:string; farm_id:string; identity_id:string; username:string; role:'ADMIN'|'VETERINARIAN'; password_hash:string; enabled:boolean }
export const authCookie = '__Host-livestock-sync'
export function readCookie(header?:string) {
 return header?.split(';').map(s=>s.trim()).find(s=>s.startsWith(authCookie+'='))?.slice(authCookie.length+1)
}
export const cookie = (secret:string,remember:boolean) => authCookie+'='+secret+
 '; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age='+(secret ? remember ? 2592000 : 43200 : 0)

async function session(sql:Sql,secret:string) {
 const row=(await sql.query(`SELECT d.id AS "deviceId",d.farm_id AS "farmId",d.identity_id AS "identityId",f.name,
 a.id AS "accountId",a.username,a.role,d.expires_at AS "expiresAt"
 FROM livestock_sync.devices d JOIN livestock_sync.accounts a ON a.id=d.account_id AND a.farm_id=d.farm_id
 AND a.identity_id=d.identity_id JOIN livestock_sync.farms f ON f.id=d.farm_id
 JOIN livestock_sync.farm_members m ON m.farm_id=d.farm_id AND m.identity_id=d.identity_id
 WHERE d.token_digest=$1 AND d.revoked_at IS NULL AND d.expires_at>now() AND a.enabled`,[hash(secret)])).rows[0]
 return row ? authSession.parse({...row,expiresAt:new Date(row.expiresAt as string).toISOString()}) : undefined
}
export function createAuthStore(transaction:Transaction) {
 async function limit(scope:string,max:number) {
  return transaction(async sql=>{
   const bucket=Math.floor(Date.now()/900000)
   const result=await sql.query(`INSERT INTO livestock_sync.login_limits(scope,attempts,blocked_until)
    VALUES ($1,1,now()+interval '15 minutes') ON CONFLICT(scope) DO UPDATE
    SET attempts=CASE WHEN login_limits.blocked_until<=now() THEN 1 ELSE login_limits.attempts+1 END,
    blocked_until=CASE WHEN login_limits.blocked_until<=now() THEN now()+interval '15 minutes' ELSE login_limits.blocked_until END
    WHERE login_limits.blocked_until<=now() OR login_limits.attempts<$2 RETURNING attempts`,[scope+':'+bucket,max])
   await sql.query("DELETE FROM livestock_sync.login_limits WHERE blocked_until<now()-interval '1 day'")
   return result.rows.length>0
  })
 }
 return {
  session:(secret:string)=>transaction(sql=>session(sql,secret)),
  async execute(input:z.infer<typeof authRequest>,secret:string|undefined,ip:string) {
   if(input.action==='status'){
    const result=await transaction(sql=>sql.query<{available:boolean}>(`SELECT EXISTS(
     SELECT 1 FROM livestock_sync.owner_setup s WHERE s.used_at IS NULL AND s.expires_at>now()
     AND NOT EXISTS(SELECT 1 FROM livestock_sync.accounts a WHERE a.farm_id=s.farm_id AND a.role='ADMIN')
    ) AS available`))
    return {status:200,value:{setupAvailable:result.rows[0].available}}
   }
   if(input.action==='session') {
    const value=secret && await transaction(sql=>session(sql,secret))
    return value ? {status:200,value} : {status:401,value:{error:'authorization'}}
   }
   if(input.action==='logout') {
    if(secret) await transaction(sql=>sql.query('UPDATE livestock_sync.devices SET revoked_at=now() WHERE token_digest=$1',[hash(secret)]))
    return {status:200,value:{loggedOut:true},cookie:cookie('',false)}
   }
   // scrypt keeps each guess expensive. Wide global and per-name ceilings stop one client from locking out the owner.
   if(!await limit('global',300) || !await limit('ip:'+hash(ip),20)) return {status:429,value:{error:'limited'}}
   if(input.action==='setup' && input.username!=='adi') return {status:400,value:{error:'username'}}
   if(input.action==='vet') {
    const actor=secret && await transaction(sql=>session(sql,secret))
    if(!actor) return {status:401,value:{error:'authorization'}}
    if(actor.role!=='ADMIN') return {status:403,value:{error:'forbidden'}}
    if(input.username!=='vet') return {status:400,value:{error:'username'}}
    if(!await limit('reauth:'+actor.accountId,5)) return {status:429,value:{error:'limited'}}
    const own=(await transaction(sql=>sql.query<Account>('SELECT * FROM livestock_sync.accounts WHERE id=$1',[actor.accountId]))).rows[0]
    if(!own || !await checkPassword(input.currentPassword,own.password_hash)) return {status:401,value:{error:'authorization'}}
    const passwordHash=await hashPassword(input.password)
    return transaction(async sql=>{
     await sql.query('SELECT id FROM livestock_sync.farms WHERE id=$1 FOR UPDATE',[actor.farmId])
     if(!secret || !await session(sql,secret)) return {status:401,value:{error:'authorization'}}
     const prior=(await sql.query<Account>("SELECT * FROM livestock_sync.accounts WHERE farm_id=$1 AND role='VETERINARIAN'",[actor.farmId])).rows[0]
     if(prior) {
      if(prior.username!==input.username) return {status:409,value:{error:'username'}}
      await sql.query('UPDATE livestock_sync.accounts SET password_hash=$2,enabled=true WHERE id=$1',[prior.id,passwordHash])
      await sql.query('UPDATE livestock_sync.devices SET revoked_at=now() WHERE account_id=$1',[prior.id])
     } else {
      const identity=randomUUID()
      await sql.query('INSERT INTO livestock_sync.identities(id) VALUES($1)',[identity])
      await sql.query('INSERT INTO livestock_sync.farm_members(farm_id,identity_id) VALUES($1,$2)',[actor.farmId,identity])
      await sql.query("INSERT INTO livestock_sync.accounts(id,farm_id,identity_id,username,role,password_hash) VALUES($1,$2,$3,$4,'VETERINARIAN',$5)",
       [randomUUID(),actor.farmId,identity,input.username,passwordHash])
     }
     return {status:200,value:{saved:true}}
    })
   }
   if(!await limit('name-ip:'+hash(input.username+'\n'+ip),5) || !await limit('name:'+hash(input.username),50)) return {status:429,value:{error:'limited'}}
   let account:Account|undefined
   if(input.action==='login') {
    account=(await transaction(sql=>sql.query<Account>('SELECT * FROM livestock_sync.accounts WHERE username=$1',[input.username]))).rows[0]
    const valid=await checkPassword(input.password,account?.password_hash)
    if(!valid||!account?.enabled) return {status:401,value:{error:'authorization'}}
   }
   const passwordHash=input.action==='setup' ? await hashPassword(input.password) : undefined
   return transaction(async sql=>{
    if(input.action==='setup') {
     const grant=(await sql.query<{farm_id:string;identity_id:string}>(
      "SELECT farm_id,identity_id FROM livestock_sync.owner_setup WHERE digest=$1 AND used_at IS NULL AND expires_at>now() FOR UPDATE",[hash(input.code)])).rows[0]
     if(!grant) return {status:401,value:{error:'authorization'}}
     await sql.query('SELECT id FROM livestock_sync.farms WHERE id=$1 FOR UPDATE',[grant.farm_id])
     const taken=await sql.query("SELECT 1 FROM livestock_sync.accounts WHERE farm_id=$1 AND role='ADMIN'",[grant.farm_id])
     if(taken.rows.length) return {status:409,value:{error:'claimed'}}
     account={id:randomUUID(),...grant,username:input.username,role:'ADMIN',password_hash:passwordHash!,enabled:true}
     await sql.query("INSERT INTO livestock_sync.accounts(id,farm_id,identity_id,username,role,password_hash) VALUES($1,$2,$3,$4,'ADMIN',$5)",
      [account.id,grant.farm_id,grant.identity_id,account.username,account.password_hash])
     await sql.query('UPDATE livestock_sync.owner_setup SET used_at=now() WHERE digest=$1',[hash(input.code)])
    } else {
     const verifiedHash = account!.password_hash
     account=(await sql.query<Account>('SELECT * FROM livestock_sync.accounts WHERE id=$1 AND enabled FOR UPDATE',[account!.id])).rows[0]
     if(!account || account.password_hash !== verifiedHash) return {status:401,value:{error:'authorization'}}
    }
    const value=token(),deviceId=randomUUID()
    await sql.query(`INSERT INTO livestock_sync.devices(id,farm_id,identity_id,label,token_digest,account_id,expires_at)
     VALUES($1,$2,$3,$4,$5,$6,now()+$7::interval)`,
     [deviceId,account.farm_id,account.identity_id,input.label,hash(value),account.id,input.remember?'30 days':'12 hours'])
    const active=await session(sql,value)
    if(!active) throw Error('Session verification failed')
    return {status:200,value:active,cookie:cookie(value,input.remember)}
   })
  },
 }
}
