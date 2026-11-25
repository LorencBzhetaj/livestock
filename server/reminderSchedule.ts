import {createHash} from 'node:crypto'
import {z} from 'zod'
import {taskSchema} from '../src/db/taskModels.js'
import {healthEventSchema,vaccinationSchema} from '../src/db/models.js'

export const reminderPreferences=z.strictObject({
 enabled:z.boolean(),language:z.enum(['sq','en']),reminderTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
 leadDays:z.number().int().min(0).max(30),
 timeZone:z.string().max(80).refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true}catch{return false}}),
})
export type ReminderPreferences=z.infer<typeof reminderPreferences>
export function localClock(now:Date,timeZone:string){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now)
 const p=(type:string)=>parts.find(part=>part.type===type)!.value
 return {date:p('year')+'-'+p('month')+'-'+p('day'),time:p('hour')+':'+p('minute')}
}
export function summaryId(deviceId:string,date:string){
 const hex=createHash('sha256').update('livestock-reminders-v1:'+deviceId+':'+date).digest('hex')
 return hex.slice(0,8)+'-'+hex.slice(8,12)+'-4'+hex.slice(13,16)+'-a'+hex.slice(17,20)+'-'+hex.slice(20,32)
}
// Reminder days before a date: the chosen lead, then 7, 3 and 1 day before, and the day itself.
// With the default lead of 7 a vaccination is announced 7, 3 and 1 day ahead and on the day,
// instead of every day of that week.
export function reminderDays(leadDays:number){return [...new Set([leadDays,7,3,1,0])].filter(day=>day<=leadDays).sort((a,b)=>b-a)}
const daysUntil=(from:string,to:string)=>Math.round((Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000)
// One private daily digest covers all eligible tasks and recorded clinical dates.
export function dueSummary(input:{tasks:unknown[];events:unknown[];vaccinations:unknown[];archived:Set<string>},preferences:ReminderPreferences,now:Date){
 if(!preferences.enabled)return false
 const local=localClock(now,preferences.timeZone)
 if(local.time<preferences.reminderTime)return false
 const days=new Set(reminderDays(preferences.leadDays))
 const remind=(day:string)=>days.has(daysUntil(local.date,day))
 const events=input.events.flatMap(raw=>{const e=healthEventSchema.safeParse(raw);return e.success?[e.data]:[]})
 const byId=new Map(events.map(e=>[e.id,e])),superseded=new Set(events.flatMap(e=>e.amendsId?[e.amendsId]:[]))
 const root=(id:string)=>{const visited=new Set<string>();let e=byId.get(id);while(e?.amendsId&&!visited.has(e.id)){visited.add(e.id);e=byId.get(e.amendsId)}return e?.id??id}
 const tasks=input.tasks.flatMap(raw=>{const t=taskSchema.safeParse(raw);return t.success?[t.data]:[]})
 const linked=new Set(tasks.flatMap(t=>t.healthEventId?[root(t.healthEventId)+':'+t.type]:[]))
 // Pending tasks past their date stay in the digest every day until they are done or cancelled.
 if(tasks.some(t=>t.status==='pending'&&(t.dueDate.slice(0,10)<local.date||remind(t.dueDate.slice(0,10)))))return true
 const vaccines=new Map(input.vaccinations.flatMap(raw=>{const v=vaccinationSchema.safeParse(raw);return v.success?[[v.data.healthEventId,v.data] as const]:[]}))
 return events.some(e=>{
  if(superseded.has(e.id)||input.archived.has(e.animalId))return false
  const type=e.kind==='vaccination'?'vaccination':e.kind==='treatment'?'treatmentFollowUp':e.kind==='checkup'||e.kind==='followUp'?'checkup':undefined
  if(!type||linked.has(root(e.id)+':'+type))return false
  const date=e.kind==='vaccination'?vaccines.get(e.id)?.nextDueAt:e.followUpAt
  if(!date)return false
  const day=e.dateOnly?date.slice(0,10):localClock(new Date(date),preferences.timeZone).date
  return remind(day)
 })
}
