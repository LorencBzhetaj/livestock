// @vitest-environment jsdom
import {expect,test,vi} from 'vitest'
import type {LivestockDatabase} from '../src/db/database'
import {watchSync} from '../src/features/sync/coordinator'

const mocks=vi.hoisted(()=>({
 changed:()=>{},unsubscribe:vi.fn(),
 session:{farmId:'farm',deviceId:'desktop',identityId:'owner',role:'ADMIN'},
 getSession:vi.fn(),pull:vi.fn(),applyPage:vi.fn(),nextEntry:vi.fn(),
}))
vi.mock('dexie',()=>({liveQuery:()=>({subscribe:(observer:{next:()=>void})=>{
 mocks.changed=observer.next
 return {unsubscribe:mocks.unsubscribe}
}})}))
vi.mock('../src/features/sync/client',()=>({getSession:mocks.getSession,pull:mocks.pull,push:vi.fn(),SyncHttpError:class extends Error{}}))
vi.mock('../src/features/sync/local',()=>({applyPage:mocks.applyPage,nextEntry:mocks.nextEntry,acknowledge:vi.fn(),retry:vi.fn()}))

test('automatic synchronization wakes on open, committed changes, reconnect, focus and visible resume',async()=>{
 vi.useFakeTimers()
 vi.spyOn(navigator,'onLine','get').mockReturnValue(true)
 const visibility=vi.spyOn(document,'visibilityState','get').mockReturnValue('visible')
 mocks.getSession.mockResolvedValue(mocks.session)
 mocks.nextEntry.mockResolvedValue(undefined)
 mocks.pull.mockResolvedValue({changes:[],cursor:'0',more:false})
 mocks.applyPage.mockResolvedValue(undefined)
 const db={name:'synthetic',syncState:{get:async()=>({...mocks.session,cursor:'0'})}} as unknown as LivestockDatabase
 const status=vi.fn()
 const stop=watchSync(db,status)
 try{
  await vi.advanceTimersByTimeAsync(500)
  expect(mocks.pull).toHaveBeenCalledTimes(1)
  expect(status).toHaveBeenLastCalledWith('synced')
  for(const wake of [()=>mocks.changed(),()=>window.dispatchEvent(new Event('focus'))]){
   const before=mocks.pull.mock.calls.length
   wake();await vi.advanceTimersByTimeAsync(500)
   expect(mocks.pull).toHaveBeenCalledTimes(before+1)
  }
  vi.spyOn(navigator,'onLine','get').mockReturnValue(false)
  window.dispatchEvent(new Event('offline'));await vi.advanceTimersByTimeAsync(500)
  expect(status).toHaveBeenLastCalledWith('offline')
  vi.spyOn(navigator,'onLine','get').mockReturnValue(true)
  const before=mocks.pull.mock.calls.length
  window.dispatchEvent(new Event('online'));await vi.advanceTimersByTimeAsync(500)
  expect(mocks.pull).toHaveBeenCalledTimes(before+1)
  visibility.mockReturnValue('hidden')
  document.dispatchEvent(new Event('visibilitychange'));await vi.advanceTimersByTimeAsync(500)
  expect(mocks.pull).toHaveBeenCalledTimes(before+1)
  visibility.mockReturnValue('visible')
  document.dispatchEvent(new Event('visibilitychange'));await vi.advanceTimersByTimeAsync(500)
  expect(mocks.pull).toHaveBeenCalledTimes(before+2)
  stop()
  window.dispatchEvent(new Event('focus'));mocks.changed();await vi.advanceTimersByTimeAsync(500)
  expect(mocks.pull).toHaveBeenCalledTimes(before+2)
  expect(mocks.unsubscribe).toHaveBeenCalledOnce()
 }finally{stop();vi.restoreAllMocks();vi.useRealTimers()}
})
