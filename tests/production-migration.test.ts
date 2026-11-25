import {PGlite} from '@electric-sql/pglite'
import {createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {expect,test} from 'vitest'

// psql meta-commands are stripped; the psql variable becomes a literal, as psql would substitute it.
async function production(database:string){
 const text=await readFile('server/production-m8.sql','utf8')
 return text.split(/\r?\n/).filter(line=>!line.trimStart().startsWith('\\')).join('\n').replace(":'expected_database'","'"+database+"'")
}
async function preview(){
 const pg=new PGlite()
 for(const f of ['push-schema','sync-schema','sync-runtime','auth-schema','account-usernames','reminder-schema'])await pg.exec(await readFile('server/'+f+'.sql','utf8'))
 return pg
}
async function shape(pg:PGlite){
 const q=async(text:string)=>(await pg.query(text)).rows
 return {
  columns:await q(`SELECT table_name,column_name,ordinal_position,data_type,is_nullable,column_default,generation_expression FROM information_schema.columns
   WHERE table_schema='livestock_sync' AND table_name<>'migrations' ORDER BY 1,3`),
  constraints:await q(`SELECT c.conrelid::regclass::text AS rel,c.conname,pg_get_constraintdef(c.oid) AS def,c.condeferrable,c.condeferred FROM pg_constraint c
   JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='livestock_sync' AND c.conrelid::regclass::text NOT LIKE '%migrations' ORDER BY 1,2`),
  indexes:await q(`SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='livestock_sync' AND tablename<>'migrations' ORDER BY 1,2`),
  tables:await q(`SELECT table_schema,table_name,privilege_type FROM information_schema.role_table_grants WHERE grantee='livestock_sync_runtime' ORDER BY 1,2,3`),
  columnsGranted:await q(`SELECT table_name,column_name,privilege_type FROM information_schema.column_privileges WHERE grantee='livestock_sync_runtime' ORDER BY 1,2,3`),
  role:await q(`SELECT rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit FROM pg_roles WHERE rolname='livestock_sync_runtime'`),
 }
}
const expectedDatabase=async(pg:PGlite)=>(await pg.query<{d:string}>('SELECT current_database() AS d')).rows[0].d

test('the Production migration matches the reviewed Preview schema and grants exactly',async()=>{
 const reference=await preview(),target=new PGlite()
 try{
  await target.exec(await readFile('server/push-schema.sql','utf8'))
  await target.query("INSERT INTO public.livestock_push_devices VALUES (gen_random_uuid(),gen_random_uuid(),'existing','sealed',now()+interval '1 day')")
  await target.exec(await production(await expectedDatabase(target)))
  const actual=await shape(target)
  expect(actual).toEqual(await shape(reference))
  expect([actual.columns.length>90,actual.constraints.length>40,actual.tables.length>30,actual.columnsGranted.length>5,actual.role.length===1]).toEqual([true,true,true,true,true])
  expect(actual.role[0]).toMatchObject({rolcanlogin:false,rolsuper:false,rolbypassrls:false,rolinherit:false})
  expect((await target.query('SELECT version FROM livestock_sync.migrations')).rows).toEqual([{version:'2026-11-25-m8-production'}])
  // Existing M7B data is untouched.
  expect((await target.query<{n:number}>('SELECT count(*)::int AS n FROM public.livestock_push_devices')).rows[0].n).toBe(1)
 }finally{await reference.close();await target.close()}
},60000)

test('the Production migration stops without changes when re-run, on the wrong database or without M7B',async()=>{
 const pg=new PGlite()
 try{
  const name=await expectedDatabase(pg)
  // Missing M7B tables.
  await expect(pg.exec(await production(name))).rejects.toThrow(/M7B tables are missing/)
  await pg.exec('ROLLBACK')
  expect((await pg.query("SELECT 1 FROM pg_namespace WHERE nspname='livestock_sync'")).rows).toHaveLength(0)
  await pg.exec(await readFile('server/push-schema.sql','utf8'))
  // Wrong target database.
  await expect(pg.exec(await production('some_other_database'))).rejects.toThrow(/expected some_other_database/)
  await pg.exec('ROLLBACK')
  expect((await pg.query("SELECT 1 FROM pg_roles WHERE rolname='livestock_sync_runtime'")).rows).toHaveLength(0)
  // Applies once, then refuses a second run.
  await pg.exec(await production(name))
  await expect(pg.exec(await production(name))).rejects.toThrow(/already exists/)
  await pg.exec('ROLLBACK')
  expect((await pg.query<{n:number}>('SELECT count(*)::int AS n FROM livestock_sync.migrations')).rows[0].n).toBe(1)
 }finally{await pg.close()}
},60000)

test('the migration contains no destructive statements',async()=>{
 const text=await readFile('server/production-m8.sql','utf8')
 const code=text.split(/\r?\n/).filter(line=>!line.trimStart().startsWith('--')).join('\n')
 expect(code).not.toMatch(/\b(DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+\w+\s+SET|ALTER\s+ROLE|REVOKE)\b/i)
 expect(createHash('sha256').update(text).digest('hex')).toMatch(/^[a-f0-9]{64}$/)
})
