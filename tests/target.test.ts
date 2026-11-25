import {expect,test} from 'vitest'
import {allowedOrigin,runtimeDatabase} from '../server/target'

const url=(database:string,user='livestock_sync_runtime',ssl='verify-full')=>`postgresql://${user}:synthetic@db.example.test/${database}?sslmode=${ssl}`

test('Preview may only use the isolated M8 database',()=>{
 expect(runtimeDatabase({VERCEL_ENV:'preview',SYNC_DATABASE_URL:url('livestock_m8_preview')})?.database).toBe('livestock_m8_preview')
 expect(runtimeDatabase({VERCEL_ENV:'preview',SYNC_DATABASE_URL:url('farm_production')})).toBeUndefined()
})

test('Production stays disabled until it is explicitly enabled with its own database',()=>{
 const base={VERCEL_ENV:'production',SYNC_DATABASE_URL:url('farm_production'),SYNC_DATABASE_NAME:'farm_production'}
 expect(runtimeDatabase(base)).toBeUndefined()
 expect(runtimeDatabase({...base,LIVESTOCK_PRODUCTION:'1'})).toMatchObject({database:'farm_production',stage:'production'})
 expect(runtimeDatabase({...base,LIVESTOCK_PRODUCTION:'1',SYNC_DATABASE_NAME:'other'})).toBeUndefined()
 expect(runtimeDatabase({...base,LIVESTOCK_PRODUCTION:'1',SYNC_DATABASE_NAME:'livestock_m8_preview',SYNC_DATABASE_URL:url('livestock_m8_preview')})).toBeUndefined()
 expect(runtimeDatabase({...base,LIVESTOCK_PRODUCTION:'1',SYNC_DATABASE_URL:url('farm_production','neondb_owner')})).toBeUndefined()
 expect(runtimeDatabase({...base,LIVESTOCK_PRODUCTION:'1',SYNC_DATABASE_URL:url('farm_production','livestock_sync_runtime','require')})).toBeUndefined()
 expect(runtimeDatabase({...base,LIVESTOCK_PRODUCTION:'1',SYNC_DATABASE_NAME:'Bad-Name'})).toBeUndefined()
 expect(runtimeDatabase({VERCEL_ENV:'development',SYNC_DATABASE_URL:url('livestock_m8_preview')})).toBeUndefined()
})

test('only an exact HTTPS origin is accepted',()=>{
 expect(allowedOrigin({SYNC_ALLOWED_ORIGIN:'https://farm.example.test'})).toBe('https://farm.example.test')
 expect(allowedOrigin({SYNC_ALLOWED_ORIGIN:'https://farm.example.test/'})).toBeUndefined()
 expect(allowedOrigin({SYNC_ALLOWED_ORIGIN:'http://farm.example.test'})).toBeUndefined()
 expect(allowedOrigin({})).toBeUndefined()
})
