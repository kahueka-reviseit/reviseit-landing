import { test,expect,type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { randomUUID,createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync } from 'node:fs';
const execute=promisify(execFile);
const password='Synthetic-Teacher-Test-123!';
async function driver(...args:string[]){const script=process.env.JOB_TEST_DRIVER;if(!script)throw new Error('Configure the local synthetic worker driver');const r=await execute('python3',[script,...args],{timeout:180000,maxBuffer:2_000_000});return JSON.parse(r.stdout);}
async function login(page:Page,email:string){await page.goto('/login');await page.locator('main form').first().getByLabel('School email address').fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Log in',exact:true}).click();await expect(page).toHaveURL(/\/(account|teacher)$/);}
test('teacher submits once, leaves, worker restarts, reviewer releases and another school cannot download',async({browser},testInfo)=>{
 const url=process.env.SUPABASE_URL!,database=process.env.AUTH_TEST_DATABASE_URL!,key=process.env.AUTH_TEST_SERVICE_KEY!;
 if(![url,database].every(u=>u&&['127.0.0.1','localhost'].includes(new URL(u).hostname)))throw new Error('Disposable local database required');
 const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});const db=new Client({connectionString:database});await db.connect();
 const run=randomUUID(),order=randomUUID(),school=randomUUID(),otherSchool=randomUUID();const people:any[]=[];
 for(const role of ['teacher','other','reviewer']){const email=`${role}-${run}@synthetic.example`;const r=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:'Synthetic '+role,school:'Synthetic school',department:'Sciences'}});expect(r.error).toBeNull();people.push({id:r.data.user!.id,email});}
 const [teacher,other,reviewer]=people;
 await db.query("insert into public.curriculum_modules(id,name,current_release,is_demo) values('synthetic-module','Synthetic internal curriculum','test-1',true) on conflict(id) do nothing");
 for(const [id,name] of [[school,'First'],[otherSchool,'Second']]){await db.query('insert into public.schools(id,slug,name) values($1,$2,$3)',[id,'synthetic-'+id,'Synthetic '+name]);await db.query("insert into public.departments(id,school_id,name) values($1,$1,'Sciences')",[id]);await db.query("insert into public.school_curriculum_access(school_id,module_id) values($1,'synthetic-module')",[id]);}
 for(const [person,s] of [[teacher,school],[other,otherSchool]])await db.query("update public.teacher_accounts set status='approved',school_id=$2,department_id=$2,reviewed_by=$3,reviewed_at=now() where user_id=$1",[person.id,s,reviewer.id]);
 await db.query('insert into private.paper_reviewers values($1)',[reviewer.id]);
 const fixture=await driver('prepare',order,school);
 await db.query("insert into private.paper_orders(id,teacher_id,school_id,module_id,release,title,entitlement,adapter_key,form,snapshot) values($1,$2,$3,'synthetic-module','test-1','Synthetic internal paper','internal_test','synthetic-ohmic',$4,$5)",[order,teacher.id,school,JSON.stringify(fixture.form),JSON.stringify(fixture.job.snapshot)]);
 const tc=await browser.newContext(),oc=await browser.newContext(),rc=await browser.newContext();let page=await tc.newPage();const otherPage=await oc.newPage(),reviewPage=await rc.newPage();
 const evidence:any={order,school,otherSchool,synthetic:true,paidProviderCalls:0};
 try{
  expect((await page.request.get(`/api/teacher/orders/${order}`)).status()).toBe(401);
  expect((await page.request.post('/api/internal/jobs',{data:{action:'claim',worker:'intruder'}})).status()).toBe(401);
  await login(page,teacher.email);await page.goto(`/teacher/orders/${order}`);await expect(page.getByRole('heading',{name:'Ready for your answers'})).toBeVisible();
  for(const field of fixture.form)await page.getByLabel(field.label,{exact:true}).selectOption(field.options[0]);
  expect((await page.request.post(`/api/teacher/orders/${order}/submit`,{data:{},headers:{origin:'https://untrusted.example'}})).status()).toBe(403);
  expect((await page.request.get(`/api/teacher/orders/${order}/documents/paper?review=true`)).status()).toBe(403);
  const post=page.waitForRequest(r=>r.url().endsWith('/submit')&&r.method()==='POST');await page.getByRole('button',{name:'Submit answers',exact:true}).click();const request=await post;const submitted=request.postDataJSON();
  await expect(page.getByRole('heading',{name:'Queued',exact:true})).toBeVisible();
  const duplicate=await page.request.post(`/api/teacher/orders/${order}/submit`,{data:submitted,headers:{origin:'http://127.0.0.1:3101'}});expect(duplicate.status()).toBe(202);expect(await duplicate.json()).toEqual({id:order});
  expect((await page.request.get(`/api/teacher/orders/${order}/documents/paper`)).status()).toBe(404);
  await page.close();evidence.leftPage=true;
  const first=await driver('run');evidence.firstWorker=first;expect(first.exitCode).toBe(0);
  expect((await db.query('select state from private.paper_orders where id=$1',[order])).rows[0].state).toBe('awaiting_memo_review');
  page=await tc.newPage();await page.goto('/teacher/orders');await page.getByRole('link',{name:'Synthetic internal paper'}).click();await expect(page.getByRole('heading',{name:'Checking the memorandum'})).toBeVisible();
  await login(reviewPage,reviewer.email);await reviewPage.goto(`/admin/papers/${order}`);await expect(reviewPage.getByRole('heading',{name:'Review the memorandum'})).toBeVisible();await reviewPage.getByLabel('Review evidence').fill('Synthetic protocol test: all supplied memo rows and exact arithmetic witness inspected.');await reviewPage.getByRole('checkbox').check();await reviewPage.getByRole('button',{name:'Approve memorandum',exact:true}).click();await expect(reviewPage).toHaveURL(/\/admin\/papers$/);
  await driver('renderer-start');const second=await driver('run');evidence.secondWorker=second;expect(second.container).not.toBe(first.container);expect(second.exitCode).toBe(0);
  await page.reload();await expect(page.getByRole('heading',{name:'Checking your documents'})).toBeVisible();expect((await page.request.get(`/api/teacher/orders/${order}/documents/paper`)).status()).toBe(404);
  await reviewPage.goto(`/admin/papers/${order}`);await expect(reviewPage.getByRole('heading',{name:'Inspect all four documents'})).toBeVisible();
  const names=['paper','memo','learner-memo','teacher-description'];const reviewHashes:Record<string,string>={};
  for(const name of names){const r=await reviewPage.request.get(`/api/teacher/orders/${order}/documents/${name}?review=true`);expect(r.status()).toBe(200);const data=await r.body();expect(data.subarray(0,4).toString('hex')).toBe('504b0304');reviewHashes[name]=createHash('sha256').update(data).digest('hex');}
  await reviewPage.getByLabel('Review evidence').fill('Synthetic integration release: all four generated Word files retrieved and byte identities recorded; no real school release.');await reviewPage.getByRole('checkbox').check();await reviewPage.getByRole('button',{name:'Release four documents',exact:true}).click();await expect(reviewPage).toHaveURL(/\/admin\/papers$/);
  await page.reload();await expect(page.getByRole('heading',{name:'Ready to download',exact:true})).toBeVisible();
  evidence.documents={};for(const name of names){const r=await page.request.get(`/api/teacher/orders/${order}/documents/${name}`);expect(r.status()).toBe(200);const data=await r.body();const hash=createHash('sha256').update(data).digest('hex');expect(hash).toBe(reviewHashes[name]);writeFileSync(testInfo.outputPath(name+'.docx'),data);evidence.documents[name]={sha256:hash,bytes:data.length};}
  await login(otherPage,other.email);expect((await otherPage.request.get(`/api/teacher/orders/${order}`)).status()).toBe(404);for(const name of names)expect((await otherPage.request.get(`/api/teacher/orders/${order}/documents/${name}`)).status()).toBe(404);
  expect((await otherPage.request.post(`/api/teacher/orders/${order}/submit`,{data:submitted,headers:{origin:'http://127.0.0.1:3101'}})).status()).toBe(403);
  evidence.otherSchoolDenied=true;evidence.generation=await driver('report');expect(evidence.generation).toEqual([{status:'ready_for_render',mode:'replay',steps:[1,2,3,4,5,6]}]);
  const events=(await db.query('select event,actor from private.paper_job_events where order_id=$1 order by id',[order])).rows;evidence.events=events;expect(events.filter(e=>e.event==='submitted')).toHaveLength(1);expect(events.find(e=>e.event==='release_approved')?.actor).toBe(reviewer.id);
  await page.screenshot({path:testInfo.outputPath('released-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:testInfo.outputPath('released-mobile.png'),fullPage:true});
  await db.query("update public.teacher_accounts set status='suspended' where user_id=$1",[teacher.id]);expect((await page.request.get(`/api/teacher/orders/${order}/documents/paper`)).status()).toBe(403);evidence.revocationDenied=true;
  writeFileSync(testInfo.outputPath('journey-evidence.json'),JSON.stringify(evidence,null,2));
 }finally{await db.query("update private.paper_orders set state='cancelled',lease=null,lease_until=null where id=$1 and state<>'released'",[order]);await driver('cleanup');await Promise.all([tc.close(),oc.close(),rc.close()]);await db.end();}
});
