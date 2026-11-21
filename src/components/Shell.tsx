import {getAccess} from '../features/auth/access'
import type {ReactNode} from 'react'
import {Link,useLocation} from 'react-router-dom'
import {strings} from '../i18n/strings'
import type {Language} from '../db/models'
import {Icon,type IconName} from './Icon'

export function Shell({language,online,children}:{language:Language;online:boolean;children:ReactNode}){
 const t=strings[language],en=language==='en',readOnly=getAccess()?.role==='VETERINARIAN'
 const location=useLocation()
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
 return <div className={'app-layout'+(location.pathname==='/'?' dashboard-page':'')} data-readonly={readOnly||undefined}>
  <a href="#main" className="skip-link">{t.skip}</a>
  <aside className="app-sidebar">
   <Link to="/" className="brand" aria-label="LivestockOS"><span className="brand-mark"><Icon name="animals"/></span><span>Livestock<span className="brand-light">OS</span></span></Link>
   <nav aria-label={t.navigation} className="primary-nav">
    {items.map(item=><Link key={item.to} to={item.to} aria-current={active(item.to)?'page':undefined} className={!item.mobile?'desktop-nav-item':''}><Icon name={item.icon}/><span>{item.name}</span></Link>)}
   </nav>
   <div className="sidebar-foot"><span className={'connection-dot '+(!online?'is-offline':'')}/>{online?t.online:t.offline}</div>
  </aside>
  <div className="app-workspace">
   <header className="workspace-header"><span>{location.pathname==='/'?'LivestockOS':page.name}</span><div className="workspace-tools">
    <Link to="/tasks?status=pending" className="notification-bell" aria-label={en?'Reminders':'Kujtesat'}><Icon name="bell"/></Link>
    <span className="workspace-account"><Icon name="user"/><span><strong>{getAccess()?.username??'LivestockOS'}</strong><small>{readOnly?(en?'Read only':'Vetëm lexim'):'Admin'}</small></span></span>
   </div></header>
   <main id="main" tabIndex={-1} className="app-main">{children}</main>
  </div>
 </div>
}
