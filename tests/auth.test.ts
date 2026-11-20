import 'fake-indexeddb/auto'
import {PGlite} from '@electric-sql/pglite'
import {randomUUID,randomBytes} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {createServer} from 'node:http'
import {afterAll,beforeAll,expect,test} from 'vitest'
import {createAuthStore} from '../server/authStore'
import {createAuthHandler} from '../api/auth'
import {createSyncHandler} from '../api/sync'
import {createSyncStore,hash} from '../server/syncStore'
import {LivestockDatabase} from '../src/db/database'
import {createRepositories} from '../src/db/repositories'
import {setAccess} from '../src/features/auth/access'
import {createBackup} from '../src/features/backup/backup'
import type {Transaction} from '../server/pushStore'
import type {AuthSession} from '../src/features/auth/protocol'

let pg:PGlite
let auth:ReturnType<typeof createAuthStore>
let sync:ReturnType<typeof createSyncStore>
const origin='https://auth-test.example'
const password='Synthetic password '+randomBytes(18).toString('base64url')
const vetPassword='Synthetic vet '+randomBytes(18).toString('base64url')
let issued:{secret:string; session:AuthSession}
let farm:string
const id=()=>randomUUID()
beforeAll(async()=>{
 pg=new PGlite()
 for(const f of ['server/sync-schema.sql','server/sync-runtime.sql','server/auth-schema.sql']) await pg.exec(await readFile(f,'utf8'))
 const transaction:Transaction=work=>pg.transaction(async sql=>{
  await sql.exec('SET LOCAL ROLE livestock_sync_runtime')
  return work({query:(text,args)=>sql.query(text,args)})
 })
 auth=createAuthStore(transaction)
 sync=createSyncStore(transaction,true)
},30000)
afterAll(async()=>{await pg?.close()})
function resultCookie(result:Awaited<ReturnType<typeof auth.execute>>){
 if(!('cookie'in result)||!result.cookie)throw Error('Missing cookie')
 return result.cookie.split(';')[0].split('=')[1]
}
test('private owner setup, username password login, separate Vet, session revocation and brute force throttling',async()=>{
 farm=id();const identity=id(),code=randomBytes(32).toString('base64url')
 await pg.query('INSERT INTO livestock_sync.farms(id,name) VALUES($1,$2)',[farm,'Synthetic Auth Test'])
 await pg.query('INSERT INTO livestock_sync.identities(id) VALUES($1)',[identity])
 await pg.query('INSERT INTO livestock_sync.farm_members(farm_id,identity_id) VALUES($1,$2)',[farm,identity])
 await pg.query("INSERT INTO livestock_sync.owner_setup(digest,farm_id,identity_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[hash(code),farm,identity])
 const setup=await auth.execute({action:'setup',username:'adi',password,code,remember:true,label:'Desktop'},undefined,'test')
 expect(setup.status).toBe(200)
 issued={secret:resultCookie(setup),session:setup.value as AuthSession}
 expect(issued.session.role).toBe('ADMIN')
 expect('password_hash'in issued.session).toBe(false)
 expect('cookie'in setup&&setup.cookie).toContain('HttpOnly')
 expect((await auth.execute({action:'setup',username:'adi',password,code,remember:true,label:'Other'},undefined,'test')).status).toBe(401)
 const denied=await auth.execute({action:'login',username:'adi',password:'incorrect',remember:false,label:'Other'},undefined,'test')
 expect(denied.status).toBe(401)
 const vet=await auth.execute({action:'vet',username:'vet',password:vetPassword,currentPassword:password},issued.secret,'test')
 expect(vet.status).toBe(200)
 const login=await auth.execute({action:'login',username:'vet',password:vetPassword,remember:false,label:'Phone'},undefined,'test')
 expect(login.status).toBe(200)
 const vetSecret=resultCookie(login)
 expect((login.value as AuthSession).role).toBe('VETERINARIAN')
 const deniedAdmin=await auth.execute({action:'vet',username:'other_vet',password,currentPassword:vetPassword},vetSecret,'test')
 expect(deniedAdmin.status).toBe(403)
 await auth.execute({action:'logout'},vetSecret,'test')
 expect(await auth.session(vetSecret)).toBeUndefined()
 const expiring=await auth.execute({action:'login',username:'vet',password:vetPassword,remember:true,label:'Expired'},undefined,'test')
 await pg.query("UPDATE livestock_sync.devices SET expires_at=now()-interval '1 second' WHERE token_digest=$1",[hash(resultCookie(expiring))])
 expect(await auth.session(resultCookie(expiring))).toBeUndefined()
 for(let i=0;i<5;i++) expect((await auth.execute({action:'login',username:'unknown_user',password:'wrong',remember:false,label:'Other'},undefined,'test')).status).toBe(401)
 expect((await auth.execute({action:'login',username:'unknown_user',password:'wrong',remember:false,label:'Other'},undefined,'test')).status).toBe(429)
},30000)

test('server rejects Vet mutations with HTTP 403 while pull remains authorized',async()=>{
 const login=await auth.execute({action:'login',username:'vet',password:vetPassword,remember:false,label:'Tablet'},undefined,'test')
 const secret=resultCookie(login)
 const authHandler=createAuthHandler(auth,origin),syncHandler=createSyncHandler(sync,origin)
 const server=createServer((req,res)=>{void(req.url==='/auth'?authHandler:syncHandler)(req,res)})
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
 const addr=server.address()
 if(!addr||typeof addr==='string')throw Error()
 const post=async(body:unknown,path='/sync',credential=secret)=>fetch('http://127.0.0.1:'+addr.port+path,{
  method:'POST',headers:{origin,'content-type':'application/json',cookie:'__Host-livestock-sync='+credential},body:JSON.stringify(body)})
 try{
  const session=login.value as AuthSession
  const operation={id:id(),farmId:farm,deviceId:session.deviceId,createdAt:new Date().toISOString(),initial:false,
   mutations:[{entity:'species',recordId:id(),type:'create',base:0,payload:{id:id(),code:'goat',active:true,displayNameSq:'Dhi',displayNameEn:'Goat'}}]}
  operation.mutations[0].payload.id=operation.mutations[0].recordId
  expect((await post({action:'push',operation})).status).toBe(403)
  expect((await post({action:'invite'})).status).toBe(403)
  expect((await post({action:'devices'})).status).toBe(403)
  expect((await post({action:'revoke',deviceId:issued.session.deviceId})).status).toBe(403)
  const read=await post({action:'pull',cursor:'0',limit:100})
  expect(read.status).toBe(200)
  expect(await read.json()).toEqual({changes:[],cursor:'0',more:false})
  expect((await post({action:'pull',cursor:'0',limit:5},'/sync','bad')).status).toBe(401)
  const wrongFarm={...operation,farmId:id()}
  expect((await post({action:'push',operation:wrongFarm},'/sync',issued.secret)).status).toBe(409)
  expect((await post({action:'enroll',code:randomBytes(32).toString('base64url'),label:'Legacy'})).status).toBe(401)
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
},30000)

test('offline Vet denies repository and direct table writes, export, and reads after local lock',async()=>{
 const db=new LivestockDatabase('auth-local-'+id())
 const account={...issued.session,role:'ADMIN'} as AuthSession
 const repo=createRepositories(db)
 setAccess(account,db.name)
 try{
  const species={id:id(),code:'goat' as const,active:true,displayNameSq:'Dhi',displayNameEn:'Goat'}
  await repo.species.save(species)
  const animal={id:id(),speciesId:species.id,earTag:'AUTH-01',sex:'female' as const,status:'active' as const,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}
  await repo.animals.save(animal)
  setAccess({...account,role:'VETERINARIAN'},db.name)
  expect(await repo.animals.list()).toHaveLength(1)
  await expect(repo.animals.archive(animal.id)).rejects.toThrow()
  await expect(db.animals.delete(animal.id)).rejects.toThrow()
  await expect(repo.tasks.create({title:'Bad',type:'general',dueDate:'2026-12-01'})).rejects.toThrow()
  await expect(createBackup(db)).rejects.toThrow()
  setAccess()
  await expect(repo.animals.list()).rejects.toThrow()
  setAccess(account,db.name)
  expect(await repo.animals.list()).toHaveLength(1)
 }finally{setAccess(account,db.name);await db.delete()}
})
