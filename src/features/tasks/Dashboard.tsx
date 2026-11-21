import {useCallback} from 'react'
import {Link} from 'react-router-dom'
import {getAccess} from '../auth/access'
import type {Language} from '../../db/models'
import {repositories} from '../../db/repositories'
import {taskStrings} from '../../i18n/tasks'
import {healthStrings} from '../../i18n/health'
import {strings} from '../../i18n/strings'
import {shiftDay} from '../../lib/calendar'
import {speciesName,useLocalQuery} from '../animals/shared'
import {animalLabel} from '../health/HealthTimeline'
import {displayDate,displayEventDate} from '../health/entry'
import {useToday} from './shared'
import {Icon,type IconName} from '../../components/Icon'

export default function Dashboard({language,reports=false}:{language:Language;reports?:boolean}){
 const today=useToday(),t=taskStrings[language],app=strings[language]
 const query=useCallback(()=>repositories.dashboard(today),[today])
 const result=useLocalQuery(query),data=result?.data,access=getAccess()
 const readOnly=access?.role==='VETERINARIAN',en=language==='en'
 const w=en?{greet:'Hello',intro:'Your farm at a glance',vaccines:'Vaccinations due soon',checks:'Scheduled checkups',open:'Open tasks',attention:'Needs your attention',quick:'Quick actions',add:'Add animal',vaccine:'Record vaccination',check:'Add checkup',activities:'Upcoming activities',groups:'Animals by species',calendar:'View calendar',recent:'Recent activity',none:'Nothing needs attention. Your farm is up to date.',soon:'Within 30 days',pending:'Pending',urgent:'Overdue',planned:'Scheduled',report:'Farm reports'}:
 {greet:'Përshëndetje',intro:'Përmbledhja e fermës',vaccines:'Vaksinime së shpejti',checks:'Kontrolle të planifikuara',open:'Detyra të hapura',attention:'Veprime që kërkojnë vëmendje',quick:'Veprime të shpejta',add:'Shto kafshë',vaccine:'Regjistro vaksinim',check:'Kontroll veterinar',activities:'Aktivitetet e ardhshme',groups:'Kafshët sipas llojit',calendar:'Shiko kalendarin',recent:'Aktiviteti i fundit',none:'Asgjë nuk kërkon vëmendje. Ferma është e përditësuar.',soon:'Brenda 30 ditësh',pending:'Në pritje',urgent:'Me vonesë',planned:'E planifikuar',report:'Raportet e fermës'}
 const user=access?.username??(en?'farmer':'fermer'),greeting=user.charAt(0).toUpperCase()+user.slice(1)
 const clinical=data?[
  ...data.clinicalTasks.map(row=>({id:row.id,type:row.type,date:row.dueDate,label:row.title,url:'/tasks/'+row.id,recorded:false})),
  ...data.clinicalDates.map(row=>({id:row.event.id,type:row.type,date:row.dueDate,label:t[row.type]+(data.animals.get(row.event.animalId)?' · '+animalLabel(data.animals.get(row.event.animalId)!):''),url:'/veterinary/events/'+row.event.id,recorded:true})),
 ]:[]
 const vaccines=clinical.filter(row=>row.type==='vaccination').length,checks=clinical.filter(row=>row.type==='checkup').length
 const activities=[...clinical,...(data?.upcoming??[]).filter(row=>!clinical.some(c=>c.id===row.id)).map(row=>({id:row.id,date:row.dueDate,label:row.title,url:'/tasks/'+row.id,recorded:false}))].sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id)).slice(0,5)
 const counts=data?[
  {name:app.active,count:data.active,icon:'animals' as IconName,url:'/animals?status=active'},
  {name:w.vaccines,count:vaccines,icon:'vaccine' as IconName,url:'/tasks?type=vaccination'},
  {name:w.checks,count:checks,icon:'health' as IconName,url:'/tasks?type=checkup'},
  {name:w.open,count:data.openTasks,icon:'tasks' as IconName,url:'/tasks?status=pending'},
 ]:[]
 return <div className="registry dashboard">
  <div className="dashboard-heading"><h1>{reports?w.report:w.greet+', '+greeting}</h1><p className="page-description">{w.intro}</p></div>
  {!result&&<p role="status">{app.loading}</p>}{result?.error&&<p role="alert" className="registry-error">{app.error}</p>}
  {data&&<>
   <div className="farm-metrics">{counts.map(row=><section className="farm-metric panel" key={row.name} aria-label={row.name}><Link to={row.url}><Icon name={row.icon}/><strong>{row.count}</strong><span>{row.name}</span></Link></section>)}</div>
   <div className="farm-priority-grid">
    <section className="panel attention-panel" aria-labelledby="attention-heading"><h2 id="attention-heading"><Icon name="bell"/>{w.attention}</h2>
     <ul className="attention-list">
      {([
       [data.taskCounts.overdue,w.urgent,'/tasks?status=pending&to='+shiftDay(today,-1),'tasks',w.urgent,'urgent'],
       [vaccines,w.vaccines,'/tasks?type=vaccination','vaccine',w.soon,'upcoming'],
       [checks,w.checks,'/tasks?type=checkup','health',w.planned,'planned'],
      ] as const).filter(([count])=>count>0).map(([count,label,url,icon,detail,state])=><li key={label}><Link to={url}><Icon name={icon}/><span><strong>{label}: {count}</strong><small>{detail}</small></span><span className={'attention-tag '+state}>{state==='urgent'?w.urgent:state==='planned'?w.planned:w.pending}</span></Link></li>)}
     </ul>{!data.taskCounts.overdue&&!vaccines&&!checks&&<p className="empty-care">{w.none}</p>}
     <div className="due-windows">{([[t.today,data.taskCounts.today,today,today],[t.week,data.taskCounts.week,shiftDay(today,1),shiftDay(today,7)],[t.month,data.taskCounts.month,shiftDay(today,1),shiftDay(today,30)]] as const).map(([label,count,from,to])=><Link key={label} to={'/tasks?status=pending&from='+from+'&to='+to}>{label}<strong>{count}</strong></Link>)}</div>
    </section>
    {!readOnly&&<section className="panel quick-panel"><h2><Icon name="plus"/>{w.quick}</h2><div className="quick-actions">{([
     ['/animals/new','plus',w.add],['/veterinary/new?kind=vaccination','vaccine',w.vaccine],['/veterinary/new?kind=checkup','health',w.check],
    ] as const).map(([url,icon,label])=><Link key={url} to={url}><Icon name={icon}/><span>{label}</span></Link>)}</div><Link className="subtle-link quick-task" to="/tasks/new">{t.add}<Icon name="arrow"/></Link></section>}
   </div>
   <div className="dashboard-grid">
    <section className="panel activities-panel"><h2><Icon name="calendar"/>{w.activities}</h2>{activities.length?<ul className="upcoming-activities">{activities.map(row=><li key={row.id}><Link to={row.url}><time dateTime={row.date}>{displayDate(row.date,language)}</time><span>{row.label}{row.recorded&&<small className="block text-xs text-stone-600">{t.recorded}</small>}</span></Link></li>)}</ul>:<p className="empty-care">{t.noDates}</p>}<Link className="section-footer" to="/tasks">{w.calendar}<Icon name="arrow"/></Link></section>
    <section className="panel species-panel"><h2><Icon name="layers"/>{w.groups}</h2>{data.speciesCounts.length?<ul className="species-bars">{data.speciesCounts.map(({species,count})=><li key={species.id}><span>{speciesName(species,language)}</span><strong>{count}</strong><span className="species-track"><span style={{width:(data.total?count/data.total*100:0)+'%'}}/></span></li>)}</ul>:<p className="empty-care">{app.empty}</p>}<div className="herd-totals">{([[t.total,data.total],[t.archivedAnimals,data.archived]] as const).map(([label,count])=><section aria-label={label} key={label}><span>{label}</span><strong>{count}</strong></section>)}</div></section>
   </div>
   <section className="recent-section"><div className="section-heading"><h2>{w.recent}</h2><Link className="subtle-link" to="/veterinary">{healthStrings[language].veterinary}</Link></div>{data.records.length?<ul className="activity-list">{data.records.map(event=><li key={event.id}><Link to={'/veterinary/events/'+event.id}>{healthStrings[language][event.kind]}{data.animals.get(event.animalId)?' · '+animalLabel(data.animals.get(event.animalId)!):''}</Link><time>{displayEventDate(event,language)}</time></li>)}</ul>:<p className="text-sm">{healthStrings[language].empty}</p>}</section>
  </>}
 </div>
}
