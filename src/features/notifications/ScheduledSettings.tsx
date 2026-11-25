import {useEffect,useRef,useState,type FormEvent} from 'react'
import {z} from 'zod'
import type {Language} from '../../db/models'
import {repositories} from '../../db/repositories'
import {now} from '../../lib/identity'
import {notificationPreferences,preferenceKey,scheduledPushStateSchema as stateSchema} from './models'
import {requestNotificationPermission,subscribeDevice} from './client'
async function request(body?:object){
 const response=await fetch('/api/reminders',{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',
 headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)})
 if(!response.ok)throw Error('Notification service unavailable')
 return response.json()
}
export default function ScheduledSettings({language,online}:{language:Language;online:boolean}){
 const en=language==='en',initial={language,reminderTime:'08:00',leadDays:7}
 const [state,setState]=useState<z.infer<typeof stateSchema>>()
 const [draft,setDraft]=useState(initial),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[permission,setPermission]=useState(typeof Notification==='undefined'?'unavailable':Notification.permission)
 const testId=useRef<string>(undefined)
 const text=en?{title:'Notifications',intro:'One daily reminder for tasks and clinical dates you have recorded. Offline reminders remain in your calendar.',enable:'Enable on this device',disable:'Disable on this device',test:'Send test notification',save:'Save preferences',time:'Reminder time',language:'Language',lead:'Days ahead',schedule:'Sent once a day, in the morning between about 08:00 and 10:00. Choose a time up to 08:00.',leadHelp:'With 7: a reminder 7, 3 and 1 day before, and on the day. A larger number adds one reminder that many days before. Overdue tasks repeat daily until done.',devices:'Authorized devices',none:'No devices enabled.',ios:'On iPhone, install to the Home Screen and open the installed app to enable notifications.',offline:'Offline: your calendar still shows upcoming and overdue work. Reconnect to update background reminders.',unavailable:'Background notifications are unavailable in this environment. Your calendar reminders still work.',denied:'Notifications are blocked. You can enable them in browser or device settings.',saved:'Preferences saved.',accepted:'The provider accepted the notification. Check this device for delivery.',unknown:'The result is not confirmed. Retry checks the same request without sending it twice.',error:'The action did not finish. Check your connection and try again.',local:'Saved on this device. Reconnect to update background reminders.',active:'Enabled on this device',inactive:'Not enabled on this device'}:
 {title:'Njoftimet',intro:'Një kujtesë ditore për detyrat dhe datat veterinare që ke regjistruar. Kujtesat mbeten në kalendar edhe pa internet.',enable:'Aktivizo në këtë pajisje',disable:'Çaktivizo në këtë pajisje',test:'Dërgo njoftim prove',save:'Ruaj preferencat',time:'Ora e kujtesës',language:'Gjuha',lead:'Ditë përpara',schedule:'Dërgohet një herë në ditë, në mëngjes, rreth orës 08:00–10:00. Zgjidh një orë deri në 08:00.',leadHelp:'Me 7: njoftim 7, 3 dhe 1 ditë para, dhe në ditën e caktuar. Një numër më i madh shton edhe një njoftim aq ditë para. Detyrat e vonuara përsëriten çdo ditë derisa të kryhen.',devices:'Pajisjet e autorizuara',none:'Asnjë pajisje e aktivizuar.',ios:'Në iPhone, shtoje në ekranin kryesor dhe hape aplikacionin e instaluar për të aktivizuar njoftimet.',offline:'Pa internet: kalendari vazhdon të tregojë detyrat e ardhshme dhe ato me vonesë. Rilidhu për të përditësuar kujtesat në sfond.',unavailable:'Njoftimet në sfond nuk janë të disponueshme në këtë mjedis. Kujtesat në kalendar vazhdojnë të punojnë.',denied:'Njoftimet janë bllokuar. Mund t’i lejosh te cilësimet e shfletuesit ose pajisjes.',saved:'Preferencat u ruajtën.',accepted:'Ofruesi e pranoi njoftimin. Kontrollo nëse mbërriti në pajisje.',unknown:'Rezultati nuk është konfirmuar. Riprova kontrollon të njëjtën kërkesë pa e dërguar dy herë.',error:'Veprimi nuk përfundoi. Kontrollo lidhjen dhe provo përsëri.',local:'U ruajtën në këtë pajisje. Rilidhu për të përditësuar kujtesat në sfond.',active:'Aktive në këtë pajisje',inactive:'Jo aktive në këtë pajisje'}
 const timezone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone
 useEffect(()=>{
  let live=true
  void(async()=>{
   const stored=notificationPreferences.safeParse((await repositories.settings.get(preferenceKey))?.value)
   if(live&&stored.success)setDraft(stored.data)
   if(online){
    try{const current=stateSchema.parse(await request());if(!live)return;setState(current)
     if(current.enrolled&&stored.success)await request({action:'preferences',preferences:{...stored.data,enabled:current.preferences?.enabled??true,timeZone:timezone()}})
     else if(current.preferences)setDraft(notificationPreferences.parse({language:current.preferences.language,reminderTime:current.preferences.reminderTime,leadDays:current.preferences.leadDays}))
    }catch{if(live)setState(undefined)}
   }
  })().catch(()=>{if(live)setNotice(text.error)})
  return()=>{live=false}
 },[online,text.error])
 async function perform(work:()=>Promise<void>){if(busy)return;setBusy(true);setNotice('');try{await work()}catch{setNotice(text.error)}finally{setBusy(false)}}
 async function save(event:FormEvent){event.preventDefault();void perform(async()=>{
  const prefs=notificationPreferences.parse(draft)
  await repositories.settings.save({key:preferenceKey,value:prefs,updatedAt:now()})
  if(online&&state?.enrolled){await request({action:'preferences',preferences:{...prefs,enabled:true,timeZone:timezone()}});setNotice(text.saved)}else setNotice(text.local)
 })}
 const supported=typeof Notification!=='undefined'&&'serviceWorker'in navigator&&'PushManager'in window
 return <section className="panel mt-4" aria-labelledby="notification-heading">
  <h2 id="notification-heading">{text.title}</h2><p className="mt-3 text-sm">{text.intro}</p><p className="mt-2 text-sm">{text.ios}</p>
  {!online&&<p role="status" className="mt-3">{text.offline}</p>}
  {online&&(!state||!supported)&&<p className="mt-3">{text.unavailable}</p>}
  {state&&!state.backgroundReady&&<p className="mt-3" role="status">{en?'Background reminders await activation. Your calendar reminders remain available.':'Kujtesat në sfond presin aktivizimin. Kujtesat në kalendar mbeten të disponueshme.'}</p>}
  {permission==='denied'&&<p className="mt-3">{text.denied}</p>}
  <p className="mt-3 font-semibold">{state?.enrolled?text.active:text.inactive}</p>
  <div className="flex flex-wrap gap-3">
   <button disabled={busy||!online||!state||!supported||state.enrolled||permission==='denied'} onClick={()=>void perform(async()=>{
    const granted=await requestNotificationPermission(Notification);setPermission(granted);if(granted!=='granted')return
    const sw=await navigator.serviceWorker.ready
    const subscription=await sw.pushManager.getSubscription()??await subscribeDevice(sw.pushManager,state!.publicKey)
    const prefs=notificationPreferences.parse(draft)
    await request({action:'enroll',subscription:subscription.toJSON(),preferences:{...prefs,enabled:true,timeZone:timezone()}})
    await repositories.settings.save({key:preferenceKey,value:prefs,updatedAt:now()})
    setState(stateSchema.parse(await request()));setNotice(text.saved)
   })}>{text.enable}</button>
   <button className="button-secondary" disabled={busy||!online||!state?.enrolled} onClick={()=>void perform(async()=>{
    await request({action:'revoke'});setState(current=>current&&{...current,enrolled:false})
    const sw=await navigator.serviceWorker.getRegistration();await(await sw?.pushManager.getSubscription())?.unsubscribe();testId.current=undefined;setNotice(text.saved)
   })}>{text.disable}</button>
   <button className="button-secondary" disabled={busy||!online||!state?.enrolled} onClick={()=>void perform(async()=>{
    testId.current??=crypto.randomUUID()
    const result=await request({action:'test',requestId:testId.current})
    setNotice(result.status==='providerAccepted'?text.accepted:text.unknown)
    if(['providerAccepted','providerRejected','expired'].includes(result.status))testId.current=undefined
   })}>{text.test}</button>
  </div>
  <form className="mt-5 border-t border-stone-200 pt-4" onSubmit={save}><div className="grid gap-4 sm:grid-cols-3">
   <label>{text.time}<input type="time" required max="08:00" aria-describedby="reminder-schedule" value={draft.reminderTime} onChange={e=>setDraft({...draft,reminderTime:e.target.value})}/></label>
   <label>{text.language}<select value={draft.language} onChange={e=>setDraft({...draft,language:e.target.value==='sq'?'sq':'en'})}><option value="sq">Shqip</option><option value="en">English</option></select></label>
   <label>{text.lead}<input type="number" min={0} max={30} required aria-describedby="reminder-lead" value={draft.leadDays} onChange={e=>setDraft({...draft,leadDays:Number(e.target.value)})}/></label>
  </div><p id="reminder-schedule" className="mt-3 text-sm">{text.schedule}</p><p id="reminder-lead" className="mt-1 text-sm">{text.leadHelp}</p><button disabled={busy}>{text.save}</button></form>
  <h3 className="mt-5">{text.devices}</h3>{state?.devices.length?<ul className="mt-2">{state.devices.map(device=><li key={device.id}>{device.label}</li>)}</ul>:<p className="text-sm">{text.none}</p>}
  {notice&&<p className="mt-3" role="status">{notice}</p>}
 </section>
}
