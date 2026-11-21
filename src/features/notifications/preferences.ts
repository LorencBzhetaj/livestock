import {liveQuery} from 'dexie'
import type {LivestockDatabase} from '../../db/database'
import {notificationPreferences,preferenceKey,scheduledPushStateSchema} from './models'

export function watchReminderPreferences(db:LivestockDatabase){
 let disposed=false,running=false,dirty=false
 let timer:ReturnType<typeof setTimeout>|undefined
 const schedule=()=>{if(disposed)return;dirty=true;clearTimeout(timer);timer=setTimeout(()=>{void run()},250)}
 async function run(){
  if(disposed||running||!navigator.onLine)return
  running=true;dirty=false
  try{
   const value=notificationPreferences.safeParse((await db.settings.get(preferenceKey))?.value)
   if(!value.success)return
   const status=await fetch('/api/reminders',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(10000)})
   if(!status.ok||disposed)return
   const parsed=scheduledPushStateSchema.safeParse(await status.json())
   if(!parsed.success||!parsed.data.enrolled)return
   const current=parsed.data
   const preferences={...value.data,enabled:current.preferences?.enabled===true,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone}
   if((['language','reminderTime','leadDays','enabled','timeZone'] as const).every(key=>current.preferences?.[key]===preferences[key]))return
   await fetch('/api/reminders',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'preferences',preferences}),signal:AbortSignal.timeout(10000)})
  }catch{/* Retain the saved preferences; reconnect, focus or the next opening retries. */}
  finally{running=false;if(dirty)schedule()}
 }
 const observer=liveQuery(()=>db.settings.get(preferenceKey)).subscribe({next:schedule,error:()=>{}})
 const visible=()=>{if(document.visibilityState==='visible')schedule()}
 window.addEventListener('online',schedule);window.addEventListener('focus',schedule);document.addEventListener('visibilitychange',visible)
 schedule()
 return()=>{disposed=true;clearTimeout(timer);observer.unsubscribe();window.removeEventListener('online',schedule);window.removeEventListener('focus',schedule);document.removeEventListener('visibilitychange',visible)}
}
