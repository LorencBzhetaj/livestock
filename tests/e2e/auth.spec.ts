import {randomBytes,randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {createServer} from 'node:http'
import {PGlite} from '@electric-sql/pglite'
import {expect,test} from '@playwright/test'
import {createAuthHandler} from '../../api/auth'
import {createSyncHandler} from '../../api/sync'
import {createAuthStore} from '../../server/authStore'
import {createSyncStore,hash} from '../../server/syncStore'
import type {Transaction} from '../../server/pushStore'

test('password login, Vet read-only offline access, and logout preserve a separate Admin cache',async({page,context,baseURL})=>{
 test.skip(process.env.AUTH_E2E!=='1','Runs against the auth-enabled build.')
 test.setTimeout(90000)
 const pg=new PGlite()
 const password='Browser test '+randomBytes(24).toString('base64url')
 const vetPassword='Vet test '+randomBytes(24).toString('base64url')
 const code=randomBytes(32).toString('base64url')
 const farm=randomUUID(),identity=randomUUID()
 const transaction:Transaction=work=>pg.transaction(async sql=>{
  await sql.exec('SET LOCAL ROLE livestock_sync_runtime')
  return work({query:(text,args)=>sql.query(text,args)})
 })
 const auth=createAuthHandler(createAuthStore(transaction),baseURL!)
 const sync=createSyncHandler(createSyncStore(transaction,true),baseURL!)
 const server=createServer((req,res)=>{void(req.url==='/api/auth'?auth:sync)(req,res)})
 try{
  for(const file of ['server/sync-schema.sql','server/sync-runtime.sql','server/auth-schema.sql'])await pg.exec(await readFile(file,'utf8'))
  await pg.query('INSERT INTO livestock_sync.farms(id,name) VALUES($1,$2)',[farm,'Account Browser Farm'])
  await pg.query('INSERT INTO livestock_sync.identities(id) VALUES($1)',[identity])
  await pg.query('INSERT INTO livestock_sync.farm_members(farm_id,identity_id) VALUES($1,$2)',[farm,identity])
  await pg.query("INSERT INTO livestock_sync.owner_setup(digest,farm_id,identity_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[hash(code),farm,identity])
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  const address=server.address()
  if(!address||typeof address==='string')throw Error()
  await context.route('**/api/{auth,sync}',async route=>{
   const path=new URL(route.request().url()).pathname
   const cookies=await context.cookies(baseURL!)
   const response=await fetch('http://127.0.0.1:'+address.port+path,{method:'POST',
    headers:{origin:baseURL!,'content-type':'application/json',cookie:cookies.map(x=>x.name+'='+x.value).join('; ')},
    body:route.request().postData()})
   const set=response.headers.get('set-cookie')
   if(set){
    const [name,value]=set.split(';')[0].split('=')
    if(value)await context.addCookies([{name,value,domain:'127.0.0.1',path:'/',httpOnly:true,secure:true}])
    else await context.clearCookies({name})
   }
   await route.fulfill({status:response.status,contentType:'application/json',body:await response.text()})
  })
  await page.goto('/')
  await page.locator('select[aria-label="Language"], select[aria-label="Account language"]').selectOption('en')
  await page.getByRole('button',{name:'Set up owner'}).click()
  await page.getByLabel('Username',{exact:true}).fill('browser_admin')
  await page.getByLabel('Password',{exact:true}).fill(password)
  await page.getByLabel('Device name').fill('Desktop')
  await page.getByLabel('Private setup code').fill(code)
  await page.getByRole('button',{name:'Set up owner',exact:true}).first().click()
  await expect(page.getByText('browser_admin · ADMIN',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Sign in',exact:true}).click()
  await expect(page.getByRole('link',{name:'Kafshët',exact:true})).toBeVisible()
  await page.locator('select[aria-label="Language"], select[aria-label="Account language"]').selectOption('en')
  await page.getByRole('button',{name:'Veterinarian account',exact:true}).click()
  await page.getByLabel('Username',{exact:true}).fill('browser_vet')
  await page.getByLabel('Password',{exact:true}).fill(vetPassword)
  await page.getByLabel('Your current password').fill(password)
  await page.getByRole('button',{name:'Save veterinarian account'}).click()
  await expect(page.getByText('Account saved.',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Veterinarian account',exact:true}).click()
  await page.getByRole('link',{name:'Settings',exact:true}).click()
  await page.getByRole('button',{name:'Add DEMO data'}).click()
  await page.getByRole('button',{name:'Sign out',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Hyr në LivestockOS'})).toBeVisible()
  await page.locator('select[aria-label="Language"], select[aria-label="Account language"]').selectOption('en')
  await page.getByLabel('Username',{exact:true}).fill('browser_vet')
  await page.getByLabel('Password',{exact:true}).fill(vetPassword)
  await page.getByLabel('Device name').fill('Vet')
  await page.getByRole('button',{name:'Sign in',exact:true}).click()
  await expect(page.getByText('browser_vet · VETERINARIAN',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Sign in',exact:true}).click()
  await expect(page.getByText(/VETERINARIAN/)).toBeVisible()
  await expect(page.getByRole('link',{name:'Settings',exact:true})).toHaveCount(0)
  await page.locator('select[aria-label="Language"], select[aria-label="Account language"]').selectOption('en')
  await page.getByRole('button',{name:'Review records',exact:true}).click()
  await page.getByRole('button',{name:'Confirm reconciliation'}).click()
  await expect(page.getByText('Fully synchronized',{exact:true}).last()).toBeVisible()
  await page.getByRole('link',{name:'Animals',exact:true}).click()
  await expect(page.getByText('DEMO-001',{exact:true})).toHaveCount(0)
  await expect(page.getByText('The app is ready for offline use.')).toHaveCount(0)
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByText(/VETERINARIAN/)).toBeVisible()
  await page.getByRole('link',{name:/^(Animals|Kafshët)$/}).click()
  await expect(page.getByRole('button',{name:/Ruaj|Save/})).toHaveCount(0)
  await context.setOffline(false)
  await page.getByRole('button',{name:'Dil',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Hyr në LivestockOS'})).toBeVisible()
  await page.locator('select[aria-label="Language"], select[aria-label="Account language"]').selectOption('en')
  await page.getByLabel('Username',{exact:true}).fill('browser_admin')
  await page.getByLabel('Password',{exact:true}).fill(password)
  await page.getByLabel('Device name').fill('Desktop again')
  await page.getByRole('button',{name:'Sign in',exact:true}).click()
  await expect(page.getByText('browser_admin · ADMIN',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Sign in',exact:true}).click()
  await page.locator('select[aria-label="Language"], select[aria-label="Account language"]').selectOption('en')
  await page.getByRole('link',{name:'Animals',exact:true}).click()
  await expect(page.getByText('DEMO-001',{exact:true})).toBeVisible()
 }finally{server.closeAllConnections();if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));await pg.close()}
})
