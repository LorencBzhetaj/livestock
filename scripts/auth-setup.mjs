import {randomBytes,createHash} from 'node:crypto'
import {writeFile} from 'node:fs/promises'
import {isAbsolute} from 'node:path'
import process from 'node:process'
import console from 'node:console'
import {URL} from 'node:url'
import {Client} from 'pg'
import {z} from 'zod'

async function prepare(){
 const farm=z.uuid().parse(process.env.AUTH_SETUP_FARM_ID)
 const file=process.argv[2]
 const u=new URL(process.env.SYNC_OPERATOR_DATABASE_URL)
 if(!file||!isAbsolute(file)||!file.endsWith('.setup-code')||u.pathname!=='/'+(process.env.AUTH_SETUP_EXPECTED_DATABASE??'livestock_m8_preview')||
   u.protocol!=='postgresql:'||u.hostname.includes('-pooler.')||u.searchParams.get('sslmode')!=='verify-full'||
   u.hostname!==process.env.AUTH_SETUP_EXPECTED_HOST)throw Error('Private setup configuration is invalid')
 const c=new Client({connectionString:u.href,connectionTimeoutMillis:7000,statement_timeout:5000})
 try {
  await c.connect();await c.query('BEGIN')
  await c.query('SELECT id FROM livestock_sync.farms WHERE id=$1 FOR UPDATE',[farm])
  if((await c.query("SELECT 1 FROM livestock_sync.accounts WHERE farm_id=$1 AND role='ADMIN'",[farm])).rows.length)throw Error('Already configured')
  const members=(await c.query('SELECT identity_id FROM livestock_sync.farm_members WHERE farm_id=$1',[farm])).rows
  if(members.length!==1)throw Error('Owner identity is ambiguous')
  const code=randomBytes(32).toString('base64url')
  const digest=createHash('sha256').update(code).digest('hex')
  await c.query(`INSERT INTO livestock_sync.owner_setup(digest,farm_id,identity_id,expires_at)
   VALUES($1,$2,$3,now()+interval '24 hours') ON CONFLICT(farm_id) DO UPDATE
   SET digest=excluded.digest,expires_at=excluded.expires_at,used_at=NULL`,[digest,farm,members[0].identity_id])
  await writeFile(file,code+'\n',{flag:'wx',mode:0o600})
  await c.query('COMMIT')
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}finally{await c.end()}
}
try{await prepare();console.info('Private owner setup file is ready. It expires after 24 hours.')}
catch{console.error('Owner setup preparation failed. Inspect the private configuration and destination before retrying.');process.exitCode=1}
