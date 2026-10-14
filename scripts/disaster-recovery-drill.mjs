import assert from 'node:assert/strict';
import {readFile,writeFile,readdir,mkdir,rename} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {makeHarness} from '../tests/backend/helpers.mjs';
import {accountingFixture} from '../tests/backend/accounting-fixture.mjs';
import {sha256,containedFile,writeRecoveryBundle,readRecoveryBundle,restoreStorageFiles} from './lib/recovery-bundle.mjs';

const root=resolve(import.meta.dirname,'..');
const require=createRequire(join(resolve(process.env.PGLITE_PACKAGE_ROOT||join(root,'tests/backend')),'package.json'));
const {PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
const quoted=name=>'"'+name.replaceAll('"','""')+'"';
async function inventory(db){
 const tables=(await db.query("select schemaname,tablename from pg_tables where schemaname in ('elio','public','auth','storage','supabase_migrations') order by schemaname,tablename")).rows;
 const data=[];for(const table of tables){const key=table.schemaname+'.'+table.tablename;const row=(await db.query(`select count(*)::int as rows,md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) as checksum from ${quoted(table.schemaname)}.${quoted(table.tablename)} t`)).rows[0];data.push({table:key,...row});}
 const functions=(await db.query("select n.nspname as schema,p.proname as name,pg_get_function_identity_arguments(p.oid) as arguments,md5(pg_get_functiondef(p.oid)) as checksum,p.prosecdef as security_definer,p.proacl::text as privileges from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('elio','public','auth','storage') and p.prokind='f' order by 1,2,3")).rows;
 const policies=(await db.query("select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname in ('elio','public','auth','storage') order by 1,2,3")).rows;
 const constraints=(await db.query("select n.nspname as schema,c.relname as table_name,k.conname as name,pg_get_constraintdef(k.oid) as definition from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('elio','public','auth','storage') order by 1,2,3")).rows;
 const security=(await db.query("select n.nspname as schema,c.relname as name,c.relrowsecurity as rls,c.relforcerowsecurity as force_rls,c.relacl::text as privileges from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in ('elio','public','auth','storage') order by 1,2")).rows;
 const indexes=(await db.query("select schemaname,tablename,indexname,indexdef from pg_indexes where schemaname in ('elio','public','auth','storage') order by 1,2,3")).rows;
 const columns=(await db.query("select table_schema,table_name,column_name,ordinal_position,data_type,udt_schema,udt_name,is_nullable,column_default,is_identity,identity_generation from information_schema.columns where table_schema in ('elio','public','auth','storage','supabase_migrations') order by table_schema,table_name,ordinal_position")).rows;
 const views=(await db.query("select schemaname,viewname,definition from pg_views where schemaname in ('elio','public','auth','storage') order by 1,2")).rows;
 const sequences=(await db.query("select schemaname,sequencename,start_value,min_value,max_value,increment_by,cycle,cache_size,last_value from pg_sequences where schemaname in ('elio','public','auth','storage') order by 1,2")).rows;
 const triggers=(await db.query("select n.nspname as schema,c.relname as table_name,t.tgname as name,pg_get_triggerdef(t.oid) as definition,t.tgenabled as enabled from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('elio','public','auth','storage') order by 1,2,3")).rows;
 const schemas=(await db.query("select nspname,nspacl::text as privileges from pg_namespace where nspname in ('elio','public','auth','storage','supabase_migrations') order by 1")).rows;
 const roles=(await db.query("select rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls from pg_roles where rolname in ('anon','authenticated','service_role') order by 1")).rows;
 return {data,functions,policies,constraints,security,indexes,columns,views,sequences,triggers,schemas,roles};
}

export async function runDisasterRecoveryDrill({publicStorageExport=null,outputRoot=join(root,'test-results/approved-batches-2026-10-03/disaster-recovery')}={}){
 const started=performance.now(),run=join(outputRoot,new Date().toISOString().replaceAll(':','-')+'-'+randomUUID().slice(0,8));await mkdir(run,{recursive:true});
 const report={status:'RUNNING',scope:'Isolated PGlite application-schema snapshot/restore, synthetic Auth and separate Storage-byte recovery. No production restore, GoTrue service or external delivery.',checks:[],migrationFiles:[],hostedOnlyMigrations:[],productionEffects:'None: no network calls, production credentials, or external sends in this drill.'};
 const db=new PGlite({extensions:{pgcrypto}});let restored;
 const check=(name,fn)=>Promise.resolve().then(fn).then(()=>{report.checks.push({name,status:'PASS'});});
 try{
  await db.exec(await readFile(join(root,'tests/backend/bootstrap.sql'),'utf8'));
  await db.exec('create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key,name text);');
  const migrationDir=join(root,'supabase/migrations');
  for(const name of (await readdir(migrationDir)).filter(name=>name.endsWith('.sql')).sort()){
   const sql=await readFile(join(migrationDir,name),'utf8');report.migrationFiles.push({name,sha256:sha256(sql)});
   if(sql.startsWith('-- Hosted infrastructure: pg_cron, pg_net, and Supabase Vault.')){report.hostedOnlyMigrations.push(name);continue;}
   await db.exec(sql);await db.query('insert into supabase_migrations.schema_migrations(version,name) values($1,$2)',[name.split('_')[0],name]);
  }
  // Deliberately minimal host fixtures: these demonstrate identity/password
  // persistence, not the complete hosted Auth service or token validation.
  await db.exec("alter table auth.users add column encrypted_password text; create table auth.identities(id uuid primary key,user_id uuid not null references auth.users(id),provider text not null,identity_data jsonb not null);");
  const h=await makeHarness(db);
  await db.query("update auth.users set encrypted_password=extensions.crypt('synthetic-only-local-password',extensions.gen_salt('bf')) where id=$1",[h.ids.customer]);
  await db.query("insert into auth.identities values($1::uuid,$2::uuid,'email',jsonb_build_object('sub',($2::uuid)::text))",[randomUUID(),h.ids.customer]);
  await h.api('save_settings',{settings:{paused:false,payment_instructions:'Isolated recovery fixture only',pickup_address:'Synthetic kitchen',contact_email:'owner@example.invalid',site_url:'https://example.invalid',reminders_enabled:false}},h.ids.owner);
  const fixture=await accountingFixture(h),unpaid=await h.api('create_order',h.checkout(fixture.product,fixture.date),h.ids.customer);
  let paid=await h.api('create_order',h.checkout(fixture.product,fixture.date),h.ids.customer);paid=await h.proof(paid);paid=await h.order(paid.id);paid=await h.action('approve_payment',paid);
  await h.service('newsletter_subscribe',{email:'recovery@example.invalid',source:'home_footer',consent:true,consent_version:'elio-newsletter-v1',ip_hash:sha256('isolated-recovery')});
  const proof=(await db.query('select proof_path from elio.orders where id=$1',[paid.id])).rows[0].proof_path;
  const buckets=(await db.query('select * from storage.buckets order by id')).rows;
  assert.equal(buckets.length,4);
  // Real image bytes without contact/order data; synthetic proofs cover both
  // private buckets even when the production buckets contain no objects.
  const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6nFQAAAAASUVORK5CYII=','base64');
  const objects=buckets.map(bucket=>({bucket:bucket.id,name:bucket.id==='payment-proofs'?proof:'synthetic-recovery/'+randomUUID()+'.png',mimetype:'image/png',bytes:Buffer.from(image)}));
  if(publicStorageExport){
   const exported=JSON.parse(await readFile(join(publicStorageExport,'manifest.json'),'utf8'));
   for(const object of exported.objects){
    assert.equal(exported.buckets.find(bucket=>bucket.id===object.bucket)?.public,true,'Only public exported images may enter this local fixture');
    const bytes=await readFile(containedFile(publicStorageExport,object.path));assert.equal(bytes.length,object.size);assert.equal(sha256(bytes),object.sha256);objects.push({...object,bytes});
   }
   report.publicStorageExport={at:exported.capturedAt,objects:exported.objects.length,bytes:exported.objects.reduce((sum,object)=>sum+object.size,0)};
  }
  for(const object of objects)await db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',[object.bucket,object.name,JSON.stringify({size:object.bytes.length,mimetype:object.mimetype})]);
  const before=await inventory(db),snapshotAt=new Date().toISOString(),backupStarted=performance.now();
  const database=Buffer.from(await (await db.dumpDataDir('gzip')).arrayBuffer());
  const bundleDir=join(run,'bundle'),bundle=await writeRecoveryBundle(bundleDir,{database,objects,buckets,metadata:{snapshotAt,migrations:report.migrationFiles,hostedOnlyMigrations:report.hostedOnlyMigrations}});
  report.timings={backupMs:Math.round(performance.now()-backupStarted)};report.databaseBytes=database.length;report.manifestSha256=bundle.manifestSha256;
  await check('Tampered manifest and unsafe paths are rejected before restore',async()=>{
   await assert.rejects(()=>readRecoveryBundle(bundleDir,'0'.repeat(64)),/manifest checksum/);
   assert.throws(()=>containedFile(bundleDir,'../outside'),/Unsafe/);assert.throws(()=>containedFile(bundleDir,'C:/outside'),/Unsafe/);
  });
  const proofFile=containedFile(bundleDir,'storage/'+objects[0].bucket+'/'+objects[0].name),proofBytes=await readFile(proofFile);
  await rename(proofFile,proofFile+'.missing-fixture');
  await check('A missing Storage object rejects the entire bundle',()=>assert.rejects(()=>readRecoveryBundle(bundleDir,bundle.manifestSha256),{code:'ENOENT'}));
  await rename(proofFile+'.missing-fixture',proofFile);
  await writeFile(proofFile,proofBytes.subarray(0,proofBytes.length-1));
  await check('Truncated Storage content rejects the entire bundle',()=>assert.rejects(()=>readRecoveryBundle(bundleDir,bundle.manifestSha256),/checksum mismatch/));
  await writeFile(proofFile,proofBytes);
  const databaseFile=join(bundleDir,'database.tgz'),damaged=Buffer.from(database);damaged[0]^=1;await writeFile(databaseFile,damaged);
  await check('Corrupted database snapshot rejects the entire bundle',()=>assert.rejects(()=>readRecoveryBundle(bundleDir,bundle.manifestSha256),/checksum mismatch/));
  await writeFile(databaseFile,database);
  // Simulate losing/changing the source after the backup. Restore must come
  // from the verified bundle, not an accidental live database reference.
  await db.query("update elio.settings set data=jsonb_set(data,'{pickup_address}','\"CHANGED AFTER SNAPSHOT\"'::jsonb)");
  await db.close();
  const restoreStarted=performance.now(),verified=await readRecoveryBundle(bundleDir,bundle.manifestSha256);
  restored=new PGlite({extensions:{pgcrypto},loadDataDir:new Blob([verified.database])});await restored.waitReady;
  await restoreStorageFiles(join(run,'restored-storage'),verified.objects);
  report.timings.restoreMs= Math.round(performance.now()-restoreStarted);
  await check('Every application/Auth/Storage/history table, row digest, column, view, sequence definition, trigger, function, constraint, index, policy, role and grant is restored',async()=>{
   const after=await inventory(restored),sequenceDefinitions=items=>items.map(({last_value,...definition})=>definition);
   assert.deepEqual({...after,sequences:sequenceDefinitions(after.sequences)},{...before,sequences:sequenceDefinitions(before.sequences)});
   // PostgreSQL may advance sequence reservations when a physical snapshot is
   // reopened. Gaps are valid; restored sequences must never reuse old values.
   for(const sequence of before.sequences){const recovered=after.sequences.find(item=>item.schemaname===sequence.schemaname&&item.sequencename===sequence.sequencename);if(sequence.last_value!==null)assert.ok(recovered.last_value>=sequence.last_value);}
   const next=(await restored.query("select nextval('elio.history_id_seq') value,(select max(id) from elio.history) previous")).rows[0];assert.ok(next.value>next.previous);
  });
  await check('Synthetic password, identity and MFA/session relationships survive',async()=>{
   const password=(await restored.query("select encrypted_password=extensions.crypt('synthetic-only-local-password',encrypted_password) as valid from auth.users where id=$1",[h.ids.customer])).rows[0];assert.equal(password.valid,true);
   assert.equal((await restored.query('select count(*)::int n from auth.identities where user_id=$1',[h.ids.customer])).rows[0].n,1);
   assert.equal((await restored.query('select count(*)::int n from auth.sessions s join auth.mfa_factors f on f.id=s.factor_id where s.user_id=$1 and s.aal=\'aal2\' and f.status=\'verified\'',[h.ids.owner])).rows[0].n,1);
  });
  async function as(role,user,claims,query,args=[]){
   await restored.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false),set_config('request.jwt.claims',$3,false)",[user||'',role,JSON.stringify(claims)]);await restored.exec('set role '+role);
   try{return await restored.query(query,args)}finally{await restored.exec('reset role');await restored.query("select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claim.role','',false),set_config('request.jwt.claims','{}',false)");}
  }
  await check('Encrypted private order link remains usable and paid/unpaid orders both survive',async()=>{
   const order=(await as('anon',null,{},'select public.shop_api($1,$2::jsonb,$3) result',['get_order',JSON.stringify({order_id:unpaid.id}),unpaid.access_token])).rows[0].result;assert.equal(order.id,unpaid.id);assert.equal(order.payment_status,'awaiting_payment');
   const status=(await restored.query('select payment_status from elio.orders where id=$1',[paid.id])).rows[0];assert.equal(status.payment_status,'paid');
   assert.equal((await restored.query('select elio.order_token(o) token from elio.orders o where id=$1',[unpaid.id])).rows[0].token,unpaid.access_token);
  });
  await check('Restored owner authorization works and anonymous/staff/customer boundaries remain enforced',async()=>{
   const owner={sub:h.ids.owner,role:'authenticated',aal:'aal2',session_id:h.ownerSession};
   assert.ok((await as('authenticated',h.ids.owner,owner,"select public.shop_api('admin_bootstrap') result")).rows[0].result);
   await assert.rejects(()=>as('anon',null,{},"select public.shop_api('admin_bootstrap')"),/Authorized/);
   await assert.rejects(()=>as('authenticated',h.ids.customer,{sub:h.ids.customer,role:'authenticated'},'select * from elio.orders'),/permission denied/);
   await assert.rejects(()=>as('authenticated',h.ids.staff,{sub:h.ids.staff,role:'authenticated'},"select public.shop_api('save_settings','{}')"),/owner/);
  });
  await check('Every restored object has matching bytes, database metadata and bucket privacy',async()=>{
   for(const object of verified.objects){const bytes=await readFile(containedFile(join(run,'restored-storage'),object.bucket+'/'+object.name));assert.equal(sha256(bytes),object.sha256);const row=(await restored.query('select o.metadata,b.public from storage.objects o join storage.buckets b on b.id=o.bucket_id where o.bucket_id=$1 and o.name=$2',[object.bucket,object.name])).rows[0];assert.equal(row.metadata.size,bytes.length);assert.equal(row.public,buckets.find(bucket=>bucket.id===object.bucket).public);}
  });
  await check('Migration inputs remained stable throughout the rehearsal',async()=>{for(const file of report.migrationFiles)assert.equal(sha256(await readFile(join(migrationDir,file.name))),file.sha256);});
  report.status='PASS';report.tables=before.data;report.objectCount=objects.length;report.objectBytes=objects.reduce((sum,object)=>sum+object.bytes.length,0);report.functionCount=before.functions.length;report.constraintCount=before.constraints.length;report.indexCount=before.indexes.length;report.policyCount=before.policies.length;report.snapshotAt=snapshotAt;report.finishedAt=new Date().toISOString();report.timings.totalMs=Math.round(performance.now()-started);report.artifactDirectory=run;
  await writeFile(join(run,'report.json'),JSON.stringify(report,null,2));await writeFile(join(outputRoot,'latest-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks.length,tables:report.tables.length,functions:report.functionCount,objects:report.objectCount,timings:report.timings,hostedOnlyMigrations:report.hostedOnlyMigrations.length,artifactDirectory:run}));return report;
 }catch(error){report.status='FAIL';report.error=error.message;await writeFile(join(run,'report.json'),JSON.stringify(report,null,2));throw error;}
 finally{if(!db.closed)await db.close();if(restored&&!restored.closed)await restored.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const option=process.argv.find(argument=>argument.startsWith('--public-storage-export='));
 try{await runDisasterRecoveryDrill({publicStorageExport:option?resolve(option.slice('--public-storage-export='.length)):null});}
 catch(error){console.error('FAIL isolated recovery drill: '+error.message+(error.detail?' — '+error.detail:''));process.exitCode=1;}
}
