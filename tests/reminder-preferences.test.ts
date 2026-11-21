// @vitest-environment jsdom
import {expect,test,vi} from 'vitest'
import type {LivestockDatabase} from '../src/db/database'
import {watchReminderPreferences} from '../src/features/notifications/preferences'
const event=vi.hoisted(()=>({changed:()=>{},unsubscribe:vi.fn()}))
vi.mock('dexie',()=>({liveQuery:()=>({subscribe:(observer:{next:()=>void})=>{event.changed=observer.next;return{unsubscribe:event.unsubscribe}}})}))
test('offline saved preferences reconcile after reconnect and stop when the account closes',async()=>{
 vi.useFakeTimers()
 const online=vi.spyOn(navigator,'onLine','get').mockReturnValue(false)
 const draft={language:'sq',reminderTime:'09:30',leadDays:3}
 const fetcher=vi.fn(async(_url:unknown,init?:RequestInit)=>init?.method==='POST'?new Response('{}',{status:200}):new Response(JSON.stringify({publicKey:'B'+'A'.repeat(86),enrolled:true,preferences:{enabled:true,timeZone:'Europe/Tirane',language:'en',reminderTime:'08:00',leadDays:0},devices:[]})))
 vi.stubGlobal('fetch',fetcher)
 const db={settings:{get:async()=>({value:draft})}} as unknown as LivestockDatabase
 const stop=watchReminderPreferences(db)
 try{
  await vi.advanceTimersByTimeAsync(500);expect(fetcher).not.toHaveBeenCalled()
  online.mockReturnValue(true);window.dispatchEvent(new Event('online'));await vi.advanceTimersByTimeAsync(500)
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string)).toMatchObject({action:'preferences',preferences:{...draft,enabled:true}})
  stop();window.dispatchEvent(new Event('focus'));event.changed();await vi.advanceTimersByTimeAsync(500)
  expect(fetcher).toHaveBeenCalledTimes(2)
 }finally{stop();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers()}
})
