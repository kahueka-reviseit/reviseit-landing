import {test,expect,type Page} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {requireHostedTarget,requireHostedFixture} from './target';
const mode=process.env.HOSTED_MIXED_MODE === 'live' ? 'live' : 'replay';
const target=requireHostedTarget(process.env,mode);
test('internal mixed paper has protected submission and automatic four-document delivery',async({browser},info)=>{
 const fixture=JSON.parse(readFileSync(process.env.HOSTED_MIXED_FIXTURE!,'utf8'));
 const base=requireHostedFixture(fixture.base,mode),phase=process.env.HOSTED_MIXED_PHASE;
 expect(['submit','download','held']).toContain(phase);
 if(mode==='live')expect(fixture.mode).toBe('live');
 const contexts=await Promise.all([browser.newContext(),browser.newContext()]);
 const headers={'x-vercel-protection-bypass':target.secret,origin:target.origin};
 const path='/api/teacher/orders/'+fixture.order;
 async function login(page:Page,person:{email:string,password:string}){
  await page.goto('/login');await page.locator('main form').first().getByLabel('School email address').fill(person.email);
  await page.getByLabel('Password',{exact:true}).fill(person.password);await page.getByRole('button',{name:'Log in',exact:true}).click();
  await expect(page).toHaveURL(/\/(account|teacher)$/);
 }
 try{
  for(const c of contexts)await c.route('**/*',r=>new URL(r.request().url()).origin!==target.origin?r.abort():r.continue({headers:{...r.request().headers(),...headers}}));
  const page=await contexts[0].newPage(),other=await contexts[1].newPage();
  expect((await page.request.get(target.origin+path,{headers})).status()).toBe(401);
  await login(page,base.teacher);await login(other,base.other);
  expect((await other.request.get(target.origin+path,{headers})).status()).toBe(404);
  const initial=await (await page.request.get(target.origin+path,{headers})).json();
  expect(JSON.stringify(initial)).not.toMatch(/bundleDigest|manifestSha256|workflowManifestSha256|sourceDependencies/);
  if(phase==='submit'){
   expect(initial.form).toEqual(fixture.form);await page.goto('/teacher/orders/'+fixture.order);
   await expect(page.getByText('No further details are needed for this question.',{exact:true})).toBeVisible();
   for(let n=0;n<2;n++)expect((await page.request.post(target.origin+path+'/submit',{headers,data:{requestKey:fixture.requestKey,answers:fixture.answers}})).status()).toBe(202);
   expect((await (await page.request.get(target.origin+path,{headers})).json()).state).toBe('queued');
   writeFileSync(info.outputPath('mixed-submit.json'),JSON.stringify({order:fixture.order,phase,privateInputsHidden:true,otherSchoolDenied:true,duplicateSubmissionAccepted:true}));
  }else if(phase==='held'){
   expect(initial.state).toBe('held');expect(initial.documents).toHaveLength(0);
   for(const name of ['paper','memo','learner-memo','teacher-description']){
    expect((await page.request.get(target.origin+path+'/documents/'+name,{headers})).status()).toBe(404);
    expect((await other.request.get(target.origin+path+'/documents/'+name,{headers})).status()).toBe(404);
   }
   writeFileSync(info.outputPath('mixed-held.json'),JSON.stringify({order:fixture.order,phase,noPartialDocuments:true,otherSchoolDenied:true}));
  }else{
   expect(initial.state).toBe('released');expect(initial.documents).toHaveLength(4);
   await page.goto('/teacher/orders/'+fixture.order);await expect(page.getByRole('heading',{name:'Ready to download',exact:true})).toBeVisible();
   const documents:Record<string,unknown>={};
   for(const name of ['paper','memo','learner-memo','teacher-description']){
    const response=await page.request.get(target.origin+path+'/documents/'+name,{headers});expect(response.status()).toBe(200);
    const bytes=await response.body();expect(bytes.subarray(0,4).toString('hex')).toBe('504b0304');
    documents[name]={sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};
    writeFileSync(info.outputPath(name+'.docx'),bytes);
    expect((await other.request.get(target.origin+path+'/documents/'+name,{headers})).status()).toBe(404);
   }
   writeFileSync(info.outputPath('mixed-download.json'),JSON.stringify({order:fixture.order,phase,documents,otherSchoolDenied:true,humanApprovalActions:0}));
  }
 }finally{await Promise.all(contexts.map(c=>c.close()));}
});
