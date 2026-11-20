import Dexie from 'dexie'
import type { AuthSession } from './protocol'

let current:AuthSession|undefined
let guarded=false
let databaseName='livestockos'
const remoteTransactions=new WeakSet<object>()
export const authRequired=()=>import.meta.env.VITE_AUTH_REQUIRED==='1'
export function setAccess(session?:AuthSession,name='livestockos') {
 guarded=true
 current=session
 databaseName=name
}
export const getAccess=()=>current
export const localDatabaseName=()=>databaseName
export function assertAdmin() {
 if(guarded && (!current||current.role!=='ADMIN'||Date.parse(current.expiresAt)<=Date.now()))throw Error('Read-only or locked account')
}
export function permitRemoteTransaction() {
 const t=Dexie.currentTransaction
 if(t)remoteTransactions.add(t.idbtrans)
}
export function assertRead(name?:string) {
 if(guarded && name && name!==databaseName)throw Error('Account cache mismatch')
 if(guarded && (!current||Date.parse(current.expiresAt)<=Date.now()))throw Error('Account locked')
}
export function assertLocalMutation(transaction:object,store:string,values?:readonly unknown[],name?:string) {
 assertRead(name)
 if(!guarded||current?.role==='ADMIN')return
 if(remoteTransactions.has(transaction))return
 // Per-device language is allowed without changing farm data.
 if(store==='settings' && values?.length && values.every((value) =>
   value && typeof value === 'object' && 'key' in value && value.key === 'language'))return
 throw Error('Veterinarian access is read-only')
}
