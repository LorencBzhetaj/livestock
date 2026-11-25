import type {IncomingMessage,ServerResponse} from 'node:http'
import {authRequest} from '../src/features/auth/protocol.js'
import {createAuthStore,readCookie} from '../server/authStore.js'
import {postgresTransactions} from '../server/pushDatabase.js'
import {reply} from '../server/push.js'
import {allowedOrigin,runtimeDatabase} from '../server/target.js'

export function createAuthHandler(store:ReturnType<typeof createAuthStore>,origin:string) {
 return async(req:IncomingMessage,res:ServerResponse)=>{
  if(req.method!=='POST') return reply(res,405,{error:'method'})
  if(req.headers.origin!==origin || req.headers['sec-fetch-site'] && req.headers['sec-fetch-site']!=='same-origin')
   return reply(res,403,{error:'origin'})
  try{
   if(req.headers['content-type']?.split(';')[0]!=='application/json'||Number(req.headers['content-length'])>4096)return reply(res,400,{error:'invalid'})
   const chunks:Buffer[]=[];let size=0
   for await(const part of req.iterator({destroyOnReturn:false})){
    const bytes=Buffer.from(part);size+=bytes.length
    if(size>4096)return reply(res,413,{error:'size'})
    chunks.push(bytes)
   }
   const input=authRequest.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
   if(!input.success)return reply(res,400,{error:'invalid'})
   const ip=process.env.VERCEL ? String(req.headers['x-vercel-forwarded-for']??'unknown') : req.socket.remoteAddress??'unknown'
   const result=await store.execute(input.data,readCookie(req.headers.cookie),ip)
   if('cookie' in result && result.cookie)res.setHeader('Set-Cookie',result.cookie)
   return reply(res,result.status,result.value)
  }catch{return reply(res,503,{error:'unavailable'})}
 }
}
function configure(){
 const e=process.env,target=runtimeDatabase(e),origin=allowedOrigin(e)
 if(e.AUTH_ENABLED!=='1'||!target||!origin)return
 return createAuthHandler(createAuthStore(postgresTransactions(target.url.href)),origin)
}
const handler=configure()
export default function auth(req:IncomingMessage,res:ServerResponse){return handler?handler(req,res):reply(res,503,{error:'unavailable'})}
