import AxeBuilder from '@axe-core/playwright'
import {mkdir} from 'node:fs/promises'
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

test('password login, Vet read-only offline access, and logout preserve a separate Admin cache',async({page,context,baseURL},testInfo)=>{
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
  // On phones the account language and sign-out live in the menu.
  const menuButton=page.getByRole('button',{name:/^(Menu|Menyja)$/})
  const english=async()=>{
   const signIn=page.locator('select[aria-label="Language"]')
   const accountLanguage=page.locator('select[aria-label="Account language"]').filter({visible:true})
   await expect(signIn.or(menuButton).or(accountLanguage).filter({visible:true}).first()).toBeVisible()
   if(await signIn.isVisible()){await signIn.selectOption('en');return}
   const phone=await menuButton.isVisible()
   if(phone)await menuButton.click()
   await accountLanguage.selectOption('en')
   if(phone)await page.keyboard.press('Escape')
  }
  const signOut=async(name:string|RegExp)=>{
   if(await menuButton.isVisible())await menuButton.click()
   await page.getByRole('button',typeof name==='string'?{name,exact:true}:{name}).click()
  }
  await page.goto('/')
  await english()
  await mkdir('.codex/visual-checks',{recursive:true})
  await page.screenshot({path:'.codex/visual-checks/login-'+testInfo.project.name+'.png',fullPage:true})
  expect((await new AxeBuilder({page}).analyze()).violations.map(v=>v.id)).toEqual([])
  await page.getByRole('button',{name:'Show password',exact:true}).click()
  await expect(page.getByLabel('Password',{exact:true})).toHaveAttribute('type','text')
  await page.getByRole('button',{name:'Hide password',exact:true}).click()
  await page.getByRole('button',{name:'First visit? Set up adi'}).click()
  await expect(page.getByLabel('Username',{exact:true})).toHaveValue('adi')
  await page.getByLabel('Password',{exact:true}).fill(password)

  await page.getByLabel('Private account setup code').fill(code)
  await page.getByRole('button',{name:'Create adi account',exact:true}).click()
  await expect(page.getByRole('link',{name:'Kafshët',exact:true})).toBeVisible()
  await english()
  await page.getByRole('link',{name:'Settings',exact:true}).click()
  await page.getByRole('button',{name:'Veterinarian account',exact:true}).click()
  await expect(page.getByLabel('Username',{exact:true})).toHaveValue('vet')
  await page.getByLabel('Password',{exact:true}).fill(vetPassword)
  await page.getByLabel('Your current password').fill(password)
  await page.getByRole('button',{name:'Save veterinarian account'}).click()
  await expect(page.getByText('Account saved.',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Close',exact:true}).click()
  await expect(page.getByRole('dialog',{name:'Veterinarian account'})).toBeHidden()
  await page.getByRole('link',{name:'Settings',exact:true}).click()
  expect((await new AxeBuilder({page}).analyze()).violations.map(v=>v.id)).toEqual([])
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.getByRole('button',{name:'Add DEMO data'}).click()
  await page.getByRole('link',{name:'Overview',exact:true}).click()
  await expect(page.getByRole('region',{name:'Active animals'})).toContainText('3')
  await page.screenshot({path:'.codex/visual-checks/dashboard-'+testInfo.project.name+'.png',fullPage:true})
  expect((await new AxeBuilder({page}).analyze()).violations.map(v=>v.id)).toEqual([])
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.getByRole('link',{name:'Animals',exact:true}).click()
  await page.getByRole('link',{name:/^DEMO-001\b/}).click()
  await page.screenshot({path:'.codex/visual-checks/profile-'+testInfo.project.name+'.png',fullPage:true})
  expect((await new AxeBuilder({page}).analyze()).violations.map(v=>v.id)).toEqual([])
  await page.getByRole('link',{name:'Veterinary',exact:true}).click()
  expect((await new AxeBuilder({page}).analyze()).violations.map(v=>v.id)).toEqual([])
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await signOut('Sign out')
  await expect(page.getByRole('heading',{name:'Hyr në LivestockOS'})).toBeVisible()
  await english()
  await page.getByLabel('Username',{exact:true}).fill('vet')
  await page.getByLabel('Password',{exact:true}).fill(vetPassword)

  await page.getByRole('button',{name:'Sign in',exact:true}).click()

  await expect(page.getByText(/Vetëm lexim|Read only/).filter({visible:true}).first()).toBeVisible()
  await expect(page.getByRole('link',{name:'Settings',exact:true})).toHaveCount(0)
  await english()
  await page.getByRole('button',{name:'Review records',exact:true}).click()
  await page.getByRole('button',{name:'Confirm and continue'}).click()
  await expect(page.getByText('Synced',{exact:true}).last()).toBeVisible()
  await page.getByRole('link',{name:'Animals',exact:true}).click()
  await expect(page.getByText('DEMO-001',{exact:true})).toHaveCount(0)
  await expect(page.getByText('The app is ready for offline use.')).toHaveCount(0)
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByText(/Vetëm lexim|Read only/).filter({visible:true}).first()).toBeVisible()
  await page.getByRole('link',{name:/^(Animals|Kafshët)$/}).click()
  await expect(page.getByRole('button',{name:/Ruaj|Save/})).toHaveCount(0)
  await context.setOffline(false)
  await signOut(/^(Dil|Sign out)$/)
  await expect(page.getByRole('heading',{name:'Hyr në LivestockOS'})).toBeVisible()
  await english()
  await page.getByLabel('Username',{exact:true}).fill('adi')
  await page.getByLabel('Password',{exact:true}).fill(password)

  await page.getByRole('button',{name:'Sign in',exact:true}).click()

  await english()
  await page.getByRole('link',{name:'Animals',exact:true}).click()
  await expect(page.getByText('DEMO-001',{exact:true})).toBeVisible()
 }finally{server.closeAllConnections();if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));await pg.close()}
})
