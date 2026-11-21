import type {IncomingMessage,ServerResponse} from 'node:http'
import {timingSafeEqual} from 'node:crypto'
import {z} from 'zod'
import {createAuthStore,readCookie} from '../server/authStore.js'
import {postgresTransactions} from '../server/pushDatabase.js'
import {publicPushKey,reply} from '../server/push.js'
import {pushSecrets,tokenSchema,enrolledSubscription} from '../server/pushSecurity.js'
import {createReminderStore} from '../server/reminderStore.js'
import {reminderPreferences} from '../server/reminderSchedule.js'
import {deliverPush} from '../server/deliverPush.js'

export const reminderRequest=z.discriminatedUnion('action',[
 z.strictObject({action:z.literal('enroll'),subscription:enrolledSubscription,preferences:reminderPreferences}),
 z.strictObject({action:z.literal('preferences'),preferences:reminderPreferences}),
 z.strictObject({action:z.literal('revoke')}),
 z.strictObject({action:z.literal('test'),requestId:z.uuid()}),
])
export function createReminderHandler(options:{
 origin:string;publicKey:string;cronKey:string;backgroundReady?:boolean;auth:ReturnType<typeof createAuthStore>;store:ReturnType<typeof createReminderStore>
}){
 return async(req:IncomingMessage,res:ServerResponse)=>{
  try{
   const bearer=req.headers.authorization?.slice(7)
   if(req.method==='POST'&&req.headers.authorization?.startsWith('Bearer ')&&tokenSchema.safeParse(bearer).success&&bearer&&bearer.length===options.cronKey.length&&timingSafeEqual(Buffer.from(bearer),Buffer.from(options.cronKey))){
    const mode=req.headers['x-livestock-dry-run']
    if(mode!==undefined&&mode!=='0'&&mode!=='1')return reply(res,400,{error:'invalid'})
    return reply(res,200,await options.store.run(new Date(),{dryRun:mode==='1'}))
   }
   const secret=readCookie(req.headers.cookie),actor=secret&&await options.auth.session(secret)
   if(!actor)return reply(res,401,{error:'authorization'})
   if(actor.role!=='ADMIN')return reply(res,403,{error:'forbidden'})
   if(req.method==='GET')return reply(res,200,{publicKey:options.publicKey,backgroundReady:options.backgroundReady===true,...await options.store.status(actor)})
   if(req.method!=='POST')return reply(res,405,{error:'method'})
   if(req.headers.origin!==options.origin||(req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin'))return reply(res,403,{error:'origin'})
   if(req.headers['content-type']?.split(';')[0]!=='application/json'||Number(req.headers['content-length'])>4096)return reply(res,400,{error:'invalid'})
   const chunks:Buffer[]=[];let size=0
   for await(const chunk of req){const bytes=Buffer.from(chunk);size+=bytes.length;if(size>4096)return reply(res,413,{error:'size'});chunks.push(bytes)}
   const input=reminderRequest.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
   if(input.action==='enroll')await options.store.enroll(actor,input.subscription,input.preferences)
   else if(input.action==='preferences')await options.store.preferences(actor,input.preferences)
   else if(input.action==='revoke')await options.store.revoke(actor)
   else return reply(res,200,{status:await options.store.test(actor,input.requestId)})
   return reply(res,200,{status:'saved'})
  }catch(error){return reply(res,error instanceof z.ZodError||error instanceof SyntaxError?400:503,{error:'unavailable'})}
 }
}
function configure(env:NodeJS.ProcessEnv){
 if(env.VERCEL_ENV!=='preview'||env.REMINDERS_ENABLED!=='1'||env.AUTH_ENABLED!=='1'||!env.SYNC_DATABASE_URL)return
 try{
  const url=new URL(env.SYNC_DATABASE_URL),origin=env.SYNC_ALLOWED_ORIGIN
  const publicKey=publicPushKey(env),privateKey=tokenSchema.parse(env.PUSH_VAPID_PRIVATE_KEY),serverKey=tokenSchema.parse(env.PUSH_SERVER_KEY),cronKey=tokenSchema.parse(env.REMINDERS_CRON_KEY),subject=env.PUSH_VAPID_SUBJECT
  const validContact=subject&&(subject.startsWith('mailto:')?z.email().safeParse(subject.slice(7)).success:subject.startsWith('https://')&&URL.canParse(subject))
  if(url.pathname!=='/livestock_m8_preview'||url.username!=='livestock_sync_runtime'||url.searchParams.get('sslmode')!=='verify-full'||!origin?.startsWith('https://')||new URL(origin).origin!==origin||!publicKey||!validContact||!subject)return
  const transaction=postgresTransactions(url.href)
  return createReminderHandler({origin,publicKey,cronKey,backgroundReady:env.REMINDERS_SCHEDULER_READY==='1',auth:createAuthStore(transaction),store:createReminderStore(transaction,pushSecrets(Buffer.from(serverKey,'base64url')),(subscription,message)=>deliverPush(subscription,message,{subject,publicKey,privateKey}))})
 }catch{return}
}
const handler=configure(process.env)
export default function reminders(req:IncomingMessage,res:ServerResponse){return handler?handler(req,res):reply(res,503,{error:'unavailable'})}
