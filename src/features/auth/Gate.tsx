import {lazy,Suspense,useEffect,useState} from 'react'
import {authSession,type AuthSession} from './protocol'
import {setAccess} from './access'
const App=lazy(()=>import('../../app/App').then(m=>({default:m.App})))
const cacheKey='livestock-auth-profile'
type Profile={session:AuthSession;database:string}
const sq={
 title:'Hyr në LivestockOS',username:'Emri i përdoruesit',password:'Fjalëkalimi',remember:'Mbaje mend këtë pajisje',
 login:'Hyr',setup:'Konfiguro pronarin',code:'Kodi privat i konfigurimit',label:'Emri i pajisjes',
 error:'Hyrja dështoi. Kontrollo të dhënat ose prit para se të provosh përsëri.',
 logout:'Dil',vet:'Llogaria e veterinerit',current:'Fjalëkalimi yt aktual',save:'Ruaj llogarinë e veterinerit',
 done:'Llogaria u ruajt.',claim:'Konfirmoj lidhjen e të dhënave lokale ekzistuese me këtë llogari Admin.',
 readOnly:'VETERINARIAN — vetëm lexim',local:'Përdor të dhënat lokale ekzistuese',minimum:'Të paktën 12 karaktere.',
}
const en:typeof sq={
 title:'Sign in to LivestockOS',username:'Username',password:'Password',remember:'Remember this device',
 login:'Sign in',setup:'Set up owner',code:'Private setup code',label:'Device name',
 error:'Sign-in failed. Check the details or wait before trying again.',
 logout:'Sign out',vet:'Veterinarian account',current:'Your current password',save:'Save veterinarian account',
 done:'Account saved.',claim:'I confirm linking existing local records to this Admin account.',
 readOnly:'VETERINARIAN — read only',local:'Use existing local records',minimum:'At least 12 characters.',
}
async function call(input:object) {
 const res=await fetch('/api/auth',{method:'POST',credentials:'same-origin',cache:'no-store',
  headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(30000)})
 if(!res.ok)throw Object.assign(Error('Authentication failed'),{status:res.status})
 return res.json()
}
function stored():Profile|undefined {
 try{
  const raw=localStorage.getItem(cacheKey)
  if(!raw)return
  const profile=JSON.parse(raw)
  const session=authSession.parse(profile.session)
  if(Date.parse(session.expiresAt)<=Date.now()||typeof profile.database!=='string')return
  const expected='livestockos-account-'+session.accountId
  if(profile.database!==expected && !(profile.database==='livestockos'&&session.role==='ADMIN'))return
  return {session,database:profile.database}
 }catch{return}
}

export default function Gate(){
 const [profile,setProfile]=useState<Profile>()
 const [ready,setReady]=useState(false)
 const [language,setLanguage]=useState<'sq'|'en'>('sq')
 const [setup,setSetup]=useState(false)
 const [error,setError]=useState(false)
 const [busy,setBusy]=useState(false)
 const [adopt,setAdopt]=useState(false)
 const [pending,setPending]=useState<AuthSession>()
 const [accountForm,setAccountForm]=useState(false)
 const [saved,setSaved]=useState(false)
 const t=language==='sq'?sq:en
 async function accept(session:AuthSession,database:string) {
  setAccess(session,database)
  if(database==='livestockos'){
   const {LivestockDatabase}=await import('../../db/database')
   const previous=new LivestockDatabase(database)
   try{
    const bound=await previous.syncState.get('farm')
    if(bound && (bound.farmId!==session.farmId || bound.identityId!==session.identityId)) {
     setAccess()
     throw Error('Existing cache belongs to another farm')
    }
   }finally{previous.close()}
  }
  const value={session,database}
  if(database==='livestockos')localStorage.setItem('livestock-legacy-owner',session.accountId)
  localStorage.removeItem('livestock-auth-signed-out')
  localStorage.setItem(cacheKey,JSON.stringify(value))
  setProfile(value)
  location.reload()
 }
 useEffect(()=>{
  let alive=true
  const old=stored()
  async function initialize(){
   setAccess()
   if(localStorage.getItem('livestock-auth-signed-out')) {
    if(alive)setReady(true)
    return
   }
   if(!navigator.onLine){
    if(old&&alive){setAccess(old.session,old.database);setProfile(old)}
   }else{
    try{
     const session=authSession.parse(await call({action:'session'}))
     if(alive){
      if(old&&old.session.accountId===session.accountId){setAccess(session,old.database);setProfile({session,database:old.database});localStorage.setItem(cacheKey,JSON.stringify({session,database:old.database}))}
      else setPending(session)
     }
    }catch{ /* Require login after server-side revocation or expiration. */ }
   }
   if(alive)setReady(true)
  }
  void initialize()
  const lock=()=>{setAccess();setProfile(undefined);setPending(undefined);setReady(true)}
  const change=(event:StorageEvent)=>{if(event.key===cacheKey)lock()}
  window.addEventListener('storage',change)
  return ()=>{alive=false;window.removeEventListener('storage',change)}
 },[])
 useEffect(()=>{
  if(!profile)return
  const validate=async()=>{
   if(!navigator.onLine)return
   try {
    const actual=authSession.parse(await call({action:'session'}))
    if(actual.accountId!==profile.session.accountId || actual.role!==profile.session.role) {
     localStorage.removeItem(cacheKey);setAccess();setProfile(undefined)
    }
   }catch(error){
    if((error as {status?:number}).status===401){
     localStorage.removeItem(cacheKey);setAccess();setProfile(undefined)
    }
   }
  }
  window.addEventListener('online',validate)
  window.addEventListener('focus',validate)
  const remaining=Date.parse(profile.session.expiresAt)-Date.now()
  const timer=setTimeout(()=>{setAccess();setProfile(undefined);localStorage.removeItem(cacheKey)},Math.max(0,Math.min(remaining,2147483647)))
  return ()=>{
   clearTimeout(timer)
   window.removeEventListener('online',validate)
   window.removeEventListener('focus',validate)
  }
 },[profile])

 async function submit(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();setBusy(true);setError(false)
  const form=event.currentTarget
  const data=new FormData(form)
  try{
   if(localStorage.getItem('livestock-auth-signed-out')) await call({action:'logout'})
   const value=authSession.parse(await call({
    action:setup?'setup':'login',username:data.get('username'),password:data.get('password'),
    remember:data.get('remember')==='on',label:data.get('label'),
    ...(setup?{code:data.get('code')}:{}),
   }))
   form.reset()
   const prior=stored()
   const binding=localStorage.getItem('livestock-legacy-owner')
   if(prior?.session.accountId===value.accountId)await accept(value,prior.database)
   else if(value.role==='ADMIN' && binding===value.accountId)await accept(value,'livestockos')
   else setPending(value)
  }catch{setError(true)}finally{setBusy(false)}
 }
 if(!ready)return <p role="status">…</p>
 if(!profile)return <main className="mx-auto max-w-lg p-6">
  <select aria-label="Language" value={language} onChange={e=>setLanguage(e.target.value as 'sq'|'en')}><option value="sq">Shqip</option><option value="en">English</option></select>
  <h1>{t.title}</h1>
  {error&&<p role="alert">{t.error}</p>}
  {pending?<div>
   <p>{pending.username} · {pending.role}</p>
   {pending.role==='ADMIN'&&!localStorage.getItem('livestock-legacy-owner')&&<label><input type="checkbox" checked={adopt} onChange={e=>setAdopt(e.target.checked)}/>{t.claim}</label>}
   <button disabled={busy} onClick={async()=>{
    setBusy(true);setError(false)
    const name=pending.role==='ADMIN'&&adopt?'livestockos':'livestockos-account-'+pending.accountId
    try {
     await accept(pending,name)
     if(name==='livestockos')localStorage.setItem('livestock-legacy-owner',pending.accountId)
     setPending(undefined)
    } catch {setError(true);setAccess()}
    finally {setBusy(false)}
   }}>{t.login}</button>
  </div>:<form onSubmit={submit} className="grid gap-3">
   <label>{t.username}<input name="username" required pattern="[A-Za-z0-9_]{3,40}" autoComplete="username"/></label>
   <label>{t.password}<input name="password" type="password" required maxLength={128} minLength={setup?12:1} autoComplete={setup?'new-password':'current-password'}/></label>
   {setup&&<><p>{t.minimum}</p><label>{t.code}<input name="code" type="password" required autoComplete="off"/></label></>}
   <label>{t.label}<input name="label" required maxLength={80}/></label>
   <label><input type="checkbox" name="remember"/>{t.remember}</label>
   <button disabled={busy}>{setup?t.setup:t.login}</button>
   <button type="button" disabled={busy} onClick={()=>setSetup(!setup)}>{setup?t.login:t.setup}</button>
  </form>}
 </main>
 return <>
  <div className="mx-auto flex max-w-5xl flex-wrap gap-3 px-5 pt-3">
   <select aria-label="Account language" value={language} onChange={async e=>{
    const value=e.target.value as 'sq'|'en';setLanguage(value)
    const {repositories}=await import('../../db/repositories')
    await repositories.settings.save({key:'language',value,updatedAt:new Date().toISOString()})
   }}><option value="sq">Shqip</option><option value="en">English</option></select>
   <span>{profile.session.username} · {profile.session.role==='VETERINARIAN'?t.readOnly:'ADMIN'}</span>
   <button disabled={busy} onClick={async()=>{
    setBusy(true)
    try{
     if(navigator.onLine)await call({action:'logout'})
     localStorage.setItem('livestock-auth-signed-out','1')
     localStorage.removeItem(cacheKey);setAccess();setProfile(undefined);location.reload()
    }catch{setError(true)}finally{setBusy(false)}
   }}>{t.logout}</button>
   {profile.session.role==='ADMIN'&&<button onClick={()=>setAccountForm(!accountForm)}>{t.vet}</button>}
  </div>
  {error&&<p role="alert">{t.error}</p>}
  {accountForm&&<form className="panel mx-auto max-w-lg" onSubmit={async e=>{
   e.preventDefault();const form=e.currentTarget,data=new FormData(form);setBusy(true);setError(false);setSaved(false)
   try{await call({action:'vet',username:data.get('username'),password:data.get('password'),currentPassword:data.get('currentPassword')});form.reset();setSaved(true)}catch{setError(true)}finally{setBusy(false)}
  }}>
   <h2>{t.vet}</h2>
   <label>{t.username}<input name="username" required pattern="[A-Za-z0-9_]{3,40}" autoComplete="off"/></label>
   <label>{t.password}<input name="password" type="password" minLength={12} maxLength={128} required autoComplete="new-password"/></label>
   <p>{t.minimum}</p>
   <label>{t.current}<input name="currentPassword" type="password" required autoComplete="current-password"/></label>
   <button disabled={busy}>{t.save}</button>{saved&&<p role="status">{t.done}</p>}
  </form>}
  <Suspense fallback={<p role="status">…</p>}><App/></Suspense>
 </>
}
