import {lazy,Suspense,useEffect,useState} from 'react'
import {authSession,passwordMinimum,type AuthSession} from './protocol'
import {setAccess} from './access'
import {AccountContext,type AccountControls} from './account'
const App=lazy(()=>import('../../app/App').then(m=>({default:m.App})))
const cacheKey='livestock-auth-profile'
type Profile={session:AuthSession;database:string}
const sq={
 title:'Hyr në LivestockOS',username:'Emri i përdoruesit',password:'Fjalëkalimi',remember:'Mbaje mend këtë pajisje',
 login:'Hyr',setup:'Konfiguro pronarin',code:'Kodi privat i konfigurimit',label:'Emri i pajisjes',
 error:'Hyrja dështoi. Kontrollo të dhënat ose prit para se të provosh përsëri.',
 logout:'Dil',vet:'Llogaria e veterinerit',current:'Fjalëkalimi yt aktual',save:'Ruaj llogarinë e veterinerit',
 done:'Llogaria u ruajt.',claim:'Konfirmoj lidhjen e të dhënave lokale ekzistuese me këtë llogari Admin.',
 readOnly:'Vetëm lexim',local:'Përdor të dhënat lokale ekzistuese',minimum:`Të paktën ${passwordMinimum} karaktere.`,close:'Mbyll',
 vetHelp:'Veterineri sheh të dhënat e fermës, por nuk mund t\'i ndryshojë. Konfirmo me fjalëkalimin tënd.',
}
const en:typeof sq={
 title:'Sign in to LivestockOS',username:'Username',password:'Password',remember:'Remember this device',
 login:'Sign in',setup:'Set up owner',code:'Private setup code',label:'Device name',
 error:'Sign-in failed. Check the details or wait before trying again.',
 logout:'Sign out',vet:'Veterinarian account',current:'Your current password',save:'Save veterinarian account',
 done:'Account saved.',claim:'I confirm linking existing local records to this Admin account.',
 readOnly:'Read only',local:'Use existing local records',minimum:`At least ${passwordMinimum} characters.`,close:'Close',
 vetHelp:'The veterinarian can view farm records but cannot change them. Confirm with your own password.',
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

function PasswordField({label,name,minimum,autoComplete,language}:{label:string;name:string;minimum?:number;autoComplete:string;language:'sq'|'en'}){
 const [visible,setVisible]=useState(false)
 const show=language==='sq'?'Shfaq':'Show',hide=language==='sq'?'Fshih':'Hide'
 return <label>{label}<span className="password-control block">
  <input aria-label={label} name={name} type={visible?'text':'password'} required minLength={minimum} maxLength={128} autoComplete={autoComplete}/>
  <button type="button" className="password-toggle" aria-pressed={visible} aria-label={(visible?hide:show)+' '+label.toLowerCase()} onClick={()=>setVisible(!visible)}>{visible?hide:show}</button>
 </span></label>
}

export default function Gate(){
 const [profile,setProfile]=useState<Profile>()
 const [ready,setReady]=useState(false)
 const [language,setLanguage]=useState<'sq'|'en'>('sq')
 const [setup,setSetup]=useState(false)
 const [setupAvailable,setSetupAvailable]=useState(false)
 const [error,setError]=useState(false)
 const [busy,setBusy]=useState(false)
 const [adopt,setAdopt]=useState(false)
 const [pending,setPending]=useState<AuthSession>()
 const [accountForm,setAccountForm]=useState(false)
 const [saved,setSaved]=useState(false)
 const [errorStatus,setErrorStatus]=useState<number>()
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
  localStorage.setItem('livestock-cache-'+session.accountId,database)
  localStorage.setItem(cacheKey,JSON.stringify(value))
  setProfile(value)
  location.reload()
 }
 useEffect(()=>{
  let alive=true
  const old=stored()
  async function initialize(){
   setAccess()
   if(navigator.onLine){
    try{const status=await call({action:'status'});if(alive)setSetupAvailable(status.setupAvailable===true)}catch{ /* Setup stays hidden when unavailable. */ }
   }
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
      else {
       const binding=localStorage.getItem('livestock-legacy-owner')
       const database=session.role==='ADMIN'&&binding===session.accountId?'livestockos':'livestockos-account-'+session.accountId
       setAccess(session,database)
       setProfile({session,database})
       localStorage.setItem(cacheKey,JSON.stringify({session,database}))
      }
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

 async function continueSession(session:AuthSession){
  const prior=stored()
  const known=localStorage.getItem('livestock-cache-'+session.accountId)
  if(known==='livestockos-account-'+session.accountId || known==='livestockos' && session.role==='ADMIN')return accept(session,known)
  const binding=localStorage.getItem('livestock-legacy-owner')
  if(prior?.session.accountId===session.accountId)return accept(session,prior.database)
  if(session.role==='ADMIN'&&binding===session.accountId)return accept(session,'livestockos')
  if(session.role==='ADMIN'&&!binding){
   setAccess(session,'livestockos')
   const {LivestockDatabase}=await import('../../db/database')
   const legacy=new LivestockDatabase('livestockos')
   try {
    const count=await legacy.animals.count()
    if(count){setPending(session);return}
   }finally{legacy.close()}
  }
  return accept(session,'livestockos-account-'+session.accountId)
 }

 async function submit(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();setBusy(true);setError(false)
  const form=event.currentTarget
  const data=new FormData(form)
  try{
   if(localStorage.getItem('livestock-auth-signed-out')) await call({action:'logout'})
   const value=authSession.parse(await call({
    action:setup?'setup':'login',username:data.get('username'),password:data.get('password'),
    remember:data.get('remember')==='on',label:navigator.userAgent.includes('iPhone')?'iPhone':navigator.userAgent.includes('Android')?'Android':'Computer',
    ...(setup?{code:data.get('code')}:{}),
   }))
   form.reset()
   await continueSession(value)
  }catch(error){setError(true);setErrorStatus((error as {status?:number}).status)}finally{setBusy(false)}
 }
 if(!ready)return <div className="min-h-screen flex items-center justify-center" role="status">LivestockOS…</div>
 if(!profile)return <div className="auth-page">
  <aside className="auth-aside">
   <a className="brand" href="/"><img src="/icon-192.png" width="40" height="40" alt=""/><span>Livestock<span className="brand-light">OS</span></span></a>
   <div className="auth-message"><h2>{language==='sq'?'Ferma jote, në duar të sigurta.':'Your farm, in good hands.'}</h2>
    <p>{language==='sq'?'Kafshët, kujdesi dhe punët e ditës. Të gjitha në një vend.':'Your animals, their care, and the work ahead. Together in one place.'}</p></div>
   <small>{language==='sq'?'Pranë fermës, edhe pa internet.':'By your side, even offline.'}</small>
  </aside>
  <main className="auth-main">
   <select className="auth-language" aria-label="Language" value={language} onChange={e=>setLanguage(e.target.value as 'sq'|'en')}><option value="sq">Shqip</option><option value="en">English</option></select>
   <div className="auth-form">
    <h1>{setup?(language==='sq'?'Mirë se erdhe, adi':'Welcome, adi'):t.title}</h1>
    <p>{setup?(language==='sq'?'Zgjidh një fjalëkalim të fortë për llogarinë tënde.':'Choose a strong password for your account.'):(language==='sq'?'Hyr për të parë fermën tënde.':'Sign in to your farm.')}</p>
    {error&&<p role="alert" className="registry-error">{errorStatus===429?(language==='sq'?'Shumë përpjekje. Prit 15 minuta dhe provo përsëri.':'Too many attempts. Wait 15 minutes and try again.'):errorStatus===401?(language==='sq'?'Emri ose fjalëkalimi nuk përputhet. Provo përsëri.':'The username or password does not match. Please try again.'):t.error}</p>}
    {pending?<div>
     <p>{language==='sq'?'U gjetën të dhëna të ruajtura në këtë pajisje.':'Existing records were found on this device.'}</p>
     {pending.role==='ADMIN'&&!localStorage.getItem('livestock-legacy-owner')&&<label className="block my-4"><input type="checkbox" checked={adopt} onChange={e=>setAdopt(e.target.checked)}/>{t.claim}</label>}
     <button className="registry-action" disabled={busy} onClick={async()=>{
      setBusy(true);setError(false)
      try{await accept(pending,pending.role==='ADMIN'&&adopt?'livestockos':'livestockos-account-'+pending.accountId)}
      catch{setError(true);setAccess()}finally{setBusy(false)}
     }}>{language==='sq'?'Vazhdo':'Continue'}</button>
    </div>:<form onSubmit={submit}>
     <label>{t.username}<input name="username" required autoComplete="username" autoCapitalize="none" spellCheck={false} pattern="adi|vet" defaultValue={setup?'adi':undefined} readOnly={setup}/></label>
     <PasswordField label={t.password} name="password" minimum={setup?passwordMinimum:1} autoComplete={setup?'new-password':'current-password'} language={language}/>
     {setup&&<><p className="text-sm">{t.minimum}</p><label>{language==='sq'?'Kodi privat për hapjen e llogarisë':'Private account setup code'}<input name="code" type="password" required autoComplete="off"/></label></>}
     <label className="auth-remember"><input type="checkbox" name="remember"/>{t.remember}</label>
     <button className="registry-action" disabled={busy}>{setup?(language==='sq'?'Krijo llogarinë adi':'Create adi account'):t.login}</button>
    </form>}
    {!pending&&(setupAvailable||setup)&&<button className="text-button" type="button" disabled={busy} onClick={()=>{setSetup(!setup);setError(false)}}>{setup?(language==='sq'?'Kthehu te hyrja':'Back to sign in'):(language==='sq'?'Përdorimi i parë? Hap llogarinë adi':'First visit? Set up adi')}</button>}
   </div>
  </main>
 </div>
 const account:AccountControls={
  username:profile.session.username,role:profile.session.role,language,busy,
  setLanguage:async value=>{
   setLanguage(value)
   const {repositories}=await import('../../db/repositories')
   await repositories.settings.save({key:'language',value,updatedAt:new Date().toISOString()})
  },
  logout:async()=>{
   setBusy(true)
   try{
    if(navigator.onLine)await call({action:'logout'})
    localStorage.setItem('livestock-auth-signed-out','1')
    localStorage.removeItem(cacheKey);setAccess();setProfile(undefined);location.reload()
   }catch{setError(true)}finally{setBusy(false)}
  },
  openVet:()=>{setSaved(false);setAccountForm(true)},
 }
 return <AccountContext.Provider value={account}>
  {error&&<p role="alert" className="account-error">{t.error}</p>}
  {accountForm&&profile.session.role==='ADMIN'&&<div className="sheet-layer">
   <div className="sheet-backdrop" onClick={()=>setAccountForm(false)}/>
   <form aria-label={t.vet} role="dialog" aria-modal="true" className="panel account-panel" onKeyDown={e=>{if(e.key==='Escape')setAccountForm(false)}} onSubmit={async e=>{
   e.preventDefault();const form=e.currentTarget,data=new FormData(form);setBusy(true);setError(false);setSaved(false)
   try{await call({action:'vet',username:data.get('username'),password:data.get('password'),currentPassword:data.get('currentPassword')});form.reset();setSaved(true)}catch{setError(true)}finally{setBusy(false)}
  }}>
   <div className="sheet-heading"><h2>{t.vet}</h2><button type="button" className="icon-button" onClick={()=>setAccountForm(false)}>{t.close}</button></div>
   <p className="text-sm">{t.vetHelp}</p>
   <label>{t.username}<input name="username" required value="vet" readOnly autoComplete="off"/></label>
   <label>{t.password}<input name="password" type="password" minLength={passwordMinimum} maxLength={128} required autoComplete="new-password"/></label>
   <p>{t.minimum}</p>
   <label>{t.current}<input name="currentPassword" type="password" required autoComplete="current-password"/></label>
   <button disabled={busy}>{t.save}</button>{saved&&<p role="status">{t.done}</p>}
  </form></div>}
  <Suspense fallback={<p role="status">…</p>}><App/></Suspense>
 </AccountContext.Provider>
}
