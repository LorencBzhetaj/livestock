import {getAccess} from '../features/auth/access'
import type {ReactNode} from 'react'
import {NavLink,useLocation} from 'react-router-dom'
import {animalStrings} from '../i18n/animals'
import {healthStrings} from '../i18n/health'
import {taskStrings} from '../i18n/tasks'
import {strings} from '../i18n/strings'
import type {Language} from '../db/models'
import {Icon} from './Icon'

export function Shell({language,online,children}:{language:Language;online:boolean;children:ReactNode}){
 const t=strings[language]
 const readOnly=getAccess()?.role==='VETERINARIAN'
 const location=useLocation()
 const items=[
  {to:'/',name:t.overview,icon:'home' as const},
  {to:'/animals',name:animalStrings[language].registry,icon:'animals' as const},
  {to:'/veterinary',name:healthStrings[language].veterinary,icon:'health' as const},
  {to:'/tasks',name:taskStrings[language].calendar,icon:'calendar' as const},
  ...(!readOnly?[{to:'/settings',name:t.settings,icon:'settings' as const}]:[]),
 ]
 const page=items.find(i=>i.to!=='/'&&location.pathname.startsWith(i.to))??items[0]
 return <div className="app-layout" data-readonly={readOnly||undefined}>
  <a href="#main" className="skip-link">{t.skip}</a>
  <aside className="app-sidebar">
   <NavLink to="/" className="brand" aria-label="LivestockOS">
    <img src={import.meta.env.BASE_URL+'icon-192.png'} alt="" width="38" height="38"/>
    <span>Livestock<span className="brand-light">OS</span></span>
   </NavLink>
   <nav aria-label={t.navigation} className="primary-nav">
    {items.map(item=><NavLink key={item.to} to={item.to} end={item.to==='/'}><Icon name={item.icon}/><span>{item.name}</span></NavLink>)}
   </nav>
   <div className="sidebar-foot"><span className={'connection-dot '+(!online?'is-offline':'')}/>{online?t.online:t.offline}</div>
  </aside>
  <div className="app-workspace">
   <header className="workspace-header"><span>{page.name}</span><span className="workspace-account">
    {getAccess()?.username??'LivestockOS'}{readOnly&&<span className="read-only-label">{language==='sq'?'Vetëm lexim':'Read only'}</span>}
   </span></header>
   <main id="main" tabIndex={-1} className="app-main">{children}</main>
  </div>
 </div>
}
