import {PGlite} from '@electric-sql/pglite'
import {randomUUID,randomBytes} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {createServer} from 'node:http'
import {afterEach,expect,test} from 'vitest'
import {createAuthHandler} from '../api/auth'
import {createAuthStore} from '../server/authStore'
import {hashPassword} from '../server/passwords'
import {hash} from '../server/syncStore'
import type {Transaction} from '../server/pushStore'
import {authRequest,passwordMinimum,type AuthSession} from '../src/features/auth/protocol'

const origin='https://password-test.example'
// Synthetic passwords of exact lengths; never real credentials.
const ofLength=(n:number)=>randomBytes(n).toString('base64url').slice(0,n)
const cleanup:(()=>Promise<void>)[]=[]
afterEach(async()=>{while(cleanup.length)await cleanup.pop()!()})

async function start(){
 const pg=new PGlite()
 for(const f of ['server/sync-schema.sql','server/sync-runtime.sql','server/auth-schema.sql']) await pg.exec(await readFile(f,'utf8'))
 const transaction:Transaction=work=>pg.transaction(async sql=>{
  await sql.exec('SET LOCAL ROLE livestock_sync_runtime')
  return work({query:(text,args)=>sql.query(text,args)})
 })
 const handler=createAuthHandler(createAuthStore(transaction),origin)
 const server=createServer((req,res)=>{void handler(req,res)})
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
 const addr=server.address()
 if(!addr||typeof addr==='string')throw Error()
 cleanup.push(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await pg.close()})
 const farm=randomUUID(),identity=randomUUID()
 await pg.query('INSERT INTO livestock_sync.farms(id,name) VALUES($1,$2)',[farm,'Synthetic Password Test'])
 await pg.query('INSERT INTO livestock_sync.identities(id) VALUES($1)',[identity])
 await pg.query('INSERT INTO livestock_sync.farm_members(farm_id,identity_id) VALUES($1,$2)',[farm,identity])
 const post=async(body:object,cookie?:string)=>{
  const r=await fetch('http://127.0.0.1:'+addr.port,{method:'POST',body:JSON.stringify(body),
   headers:{origin,'content-type':'application/json',...(cookie?{cookie:'__Host-livestock-sync='+cookie}:{})}})
  const setCookie=r.headers.get('set-cookie')
  return {status:r.status,value:await r.json() as AuthSession&{error?:string},
   cookie:setCookie?.split(';')[0].split('=')[1],httpOnly:/HttpOnly/i.test(setCookie??'')}
 }
 const login=(username:string,password:string)=>post({action:'login',username,password,remember:false,label:'Test'})
 return {pg,farm,identity,post,login}
}

test('the minimum is 8 for new Admin and Vet passwords, and login applies no minimum',()=>{
 expect(passwordMinimum).toBe(8)
 const code=randomBytes(32).toString('base64url')
 const setup=(password:string)=>authRequest.safeParse({action:'setup',username:'adi',password,code,remember:true,label:'Phone'}).success
 const vet=(password:string)=>authRequest.safeParse({action:'vet',username:'vet',password,currentPassword:'x'}).success
 for(const check of [setup,vet]){
  expect(check(ofLength(7))).toBe(false)
  expect(check(ofLength(8))).toBe(true)
  expect(check(ofLength(12))).toBe(true)
  expect(check(ofLength(128))).toBe(true)
  expect(check(ofLength(129))).toBe(false)
 }
 for(const n of [1,7,12]) expect(authRequest.safeParse({action:'login',username:'adi',password:ofLength(n),remember:false,label:'Phone'}).success).toBe(true)
})

test('initial Admin setup over HTTP rejects 7 characters and accepts 8',async()=>{
 const {pg,farm,identity,post}=await start()
 const code=randomBytes(32).toString('base64url')
 await pg.query("INSERT INTO livestock_sync.owner_setup(digest,farm_id,identity_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[hash(code),farm,identity])
 const setup=(password:string)=>post({action:'setup',username:'adi',password,code,remember:true,label:'Phone'})
 expect((await setup(ofLength(7))).status).toBe(400)
 expect((await pg.query('SELECT 1 FROM livestock_sync.accounts')).rows).toHaveLength(0)
 const ok=await setup(ofLength(8))
 expect(ok.status).toBe(200)
 expect(ok.value.role).toBe('ADMIN')
 expect(ok.httpOnly).toBe(true)
 const stored=(await pg.query<{password_hash:string}>('SELECT password_hash FROM livestock_sync.accounts')).rows[0].password_hash
 expect(stored).toMatch(/^scrypt-131072-8-1\$/)
},60000)

test('existing accounts still sign in; Vet passwords follow the new minimum; roles stay isolated',async()=>{
 const {pg,farm,identity,post,login}=await start()
 // An account created before this change, with a 16-character password.
 const adminPassword=ofLength(16)
 const legacyHash=await hashPassword(adminPassword)
 await pg.query("INSERT INTO livestock_sync.accounts(id,farm_id,identity_id,username,role,password_hash) VALUES($1,$2,$3,'adi','ADMIN',$4)",[randomUUID(),farm,identity,legacyHash])
 const admin=await login('adi',adminPassword)
 expect(admin.status).toBe(200)
 expect(admin.value.role).toBe('ADMIN')
 expect(admin.httpOnly).toBe(true)
 // Signing in does not rewrite the stored password.
 expect((await pg.query<{password_hash:string}>("SELECT password_hash FROM livestock_sync.accounts WHERE username='adi'")).rows[0].password_hash).toBe(legacyHash)

 const setVet=(password:string,cookie=admin.cookie)=>post({action:'vet',username:'vet',password,currentPassword:adminPassword},cookie)
 expect((await setVet(ofLength(7))).status).toBe(400)
 const vet12=ofLength(12)
 expect((await setVet(vet12)).status).toBe(200)
 const vet=await login('vet',vet12)
 expect(vet.status).toBe(200)
 expect(vet.value.role).toBe('VETERINARIAN')

 // Changing the Vet password to 8 characters works and replaces the old one.
 const vet8=ofLength(8)
 expect((await setVet(vet8)).status).toBe(200)
 expect((await login('vet',vet8)).status).toBe(200)
 expect((await login('vet',vet12)).status).toBe(401)

 // Isolation: a Vet session cannot manage accounts; passwords do not cross accounts.
 expect((await setVet(ofLength(8),vet.cookie)).status).toBe(401) // the password change revoked this Vet session
 const vetNow=await login('vet',vet8)
 expect((await setVet(ofLength(8),vetNow.cookie)).status).toBe(403)
 expect((await login('adi',vet8)).status).toBe(401)
 expect((await login('vet',adminPassword)).status).toBe(401)
 expect((await post({action:'setup',username:'vet',password:ofLength(8),code:randomBytes(32).toString('base64url'),remember:false,label:'X'})).status).toBe(400)
 expect((await pg.query("SELECT role FROM livestock_sync.accounts ORDER BY username")).rows).toEqual([{role:'ADMIN'},{role:'VETERINARIAN'}])
},60000)
