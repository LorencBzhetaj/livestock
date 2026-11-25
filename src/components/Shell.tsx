import {getAccess} from '../features/auth/access'
import {useAccount,type AccountControls} from '../features/auth/account'
import {useEffect,useRef,useState,type ReactNode} from 'react'
import {Link,useLocation} from 'react-router-dom'
import {strings} from '../i18n/strings'
import type {Language} from '../db/models'
import {Icon,type IconName} from './Icon'

function AccountActions({account,en}:{account:AccountControls;en:boolean}){
 return <div className="account-actions">
  <label><span>{en?'Language':'Gjuha'}</span>
   <select aria-label="Account language" value={account.language} onChange={e=>account.setLanguage(e.target.value as 'sq'|'en')}>
    <option value="sq">Shqip</option><option value="en">English</option>
   </select>
  </label>
  <button type="button" className="account-logout" disabled={account.busy} onClick={account.logout}>{en?'Sign out':'Dil'}</button>
 </div>
}

export function Shell({language,online,children}:{language:Language;online:boolean;children:ReactNode}){
 const t=strings[language],en=language==='en',readOnly=getAccess()?.role==='VETERINARIAN'
 const account=useAccount()
 const location=useLocation()
 const [menu,setMenu]=useState(false)
 const menuButton=useRef<HTMLButtonElement>(null)
 const items:{to:string;name:string;icon:IconName;mobile?:boolean}[]=[
  {to:'/',name:en?'Overview':'Kreu',icon:'home',mobile:true},
  {to:'/animals',name:en?'Animals':'Kafshët',icon:'animals',mobile:true},
  {to:'/vaccinations',name:en?'Vaccinations':'Vaksinimet',icon:'vaccine'},
  {to:'/veterinary',name:en?'Veterinary':'Veterinaria',icon:'health',mobile:true},
  {to:'/tasks?view=list',name:en?'Tasks':'Detyrat',icon:'tasks'},
  {to:'/tasks',name:en?'Calendar':'Kalendari',icon:'calendar',mobile:true},
  {to:'/reports',name:en?'Reports':'Raporte',icon:'reports'},
  ...(!readOnly?[{to:'/backup',name:'Backup',icon:'backup' as const},{to:'/settings',name:t.settings,icon:'settings' as const,mobile:true}]:[]),
 ]
 const active=(to:string)=>to==='/tasks?view=list'?location.pathname.startsWith('/tasks')&&location.search.includes('view=list'):to==='/tasks'?location.pathname.startsWith('/tasks')&&!location.search.includes('view=list'):to==='/'?location.pathname==='/':location.pathname.startsWith(to)
 const page=items.find(i=>active(i.to))??items[0]
 const username=account?.username??getAccess()?.username
 const role=readOnly?(en?'Read only':'Vetëm lexim'):'Admin'
 const closeMenu=()=>{setMenu(false);menuButton.current?.focus()}
 useEffect(()=>{
  if(!menu)return
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){setMenu(false);menuButton.current?.focus()}}
  const overflow=document.body.style.overflow
  document.body.style.overflow='hidden'
  window.addEventListener('keydown',key)
  return()=>{document.body.style.overflow=overflow;window.removeEventListener('keydown',key)}
 },[menu])
 return <div className={'app-layout'+(location.pathname==='/'?' dashboard-page':'')} data-readonly={readOnly||undefined}>
  <a href="#main" className="skip-link">{t.skip}</a>
  <aside className="app-sidebar">
   <Link to="/" className="brand" aria-label="LivestockOS"><span className="brand-mark"><Icon name="animals"/></span><span>Livestock<span className="brand-light">OS</span></span></Link>
   <nav aria-label={t.navigation} className="primary-nav">
    {items.map(item=><Link key={item.to} to={item.to} aria-current={active(item.to)?'page':undefined} className={!item.mobile?'desktop-nav-item':''}><Icon name={item.icon}/><span>{item.name}</span></Link>)}
   </nav>
   {account&&<div className="sidebar-account"><AccountActions account={account} en={en}/></div>}
  </aside>
  <div className="app-workspace">
   <header className="workspace-header">
    <button ref={menuButton} type="button" className="menu-button" aria-expanded={menu} aria-controls="app-menu" onClick={()=>setMenu(true)}>
     <Icon name="menu"/><span>{en?'Menu':'Menyja'}</span>
    </button>
    <span className="workspace-title">{location.pathname==='/'?'LivestockOS':page.name}</span>
    <Link to="/" className="header-brand" aria-label="LivestockOS"><span className="brand-mark"><Icon name="animals"/></span><span>Livestock<span className="brand-light">OS</span></span></Link>
    {readOnly&&<span className="read-only-badge">{role}</span>}
    <div className="workspace-tools">
     <Link to="/tasks?status=pending" className="notification-bell" aria-label={en?'Reminders':'Kujtesat'}><Icon name="bell"/></Link>
     <span className="workspace-account"><Icon name="user"/><span><strong>{username??'LivestockOS'}</strong><small>{role}</small></span></span>
    </div>
   </header>
   <main id="main" tabIndex={-1} className="app-main">{children}</main>
  </div>
  {menu&&<div className="menu-layer">
   <div className="menu-backdrop" onClick={closeMenu}/>
   <div id="app-menu" className="menu-drawer" role="dialog" aria-modal="true" aria-label={en?'Menu':'Menyja'}>
    <div className="menu-head">
     <span className="menu-user"><Icon name="user"/><span><strong>{username??'LivestockOS'}</strong><small>{role}</small></span></span>
     <button type="button" className="icon-button" autoFocus aria-label={en?'Close menu':'Mbyll menynë'} onClick={closeMenu}><Icon name="close"/></button>
    </div>
    <nav aria-label={en?'All pages':'Të gjitha faqet'} className="menu-nav">
     {items.map(item=><Link key={item.to} to={item.to} aria-current={active(item.to)?'page':undefined} onClick={()=>setMenu(false)}><Icon name={item.icon}/><span>{item.name}</span></Link>)}
    </nav>
    {account&&<section className="menu-account" aria-label={en?'Account':'Llogaria'}><AccountActions account={account} en={en}/></section>}
    <p className="menu-status"><span className={'connection-dot '+(!online?'is-offline':'')}/>{online?t.online:t.offline}</p>
   </div>
  </div>}
 </div>
}
