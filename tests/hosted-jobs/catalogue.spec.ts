import {test,expect,type Page} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {requireHostedTarget,requireHostedFixture} from './target';
const target=requireHostedTarget(process.env);
test('published catalogues and private frozen questionnaire work through teacher sessions',async({browser},info)=>{
 const fixture=JSON.parse(readFileSync(process.env.HOSTED_CATALOGUE_FIXTURE!,'utf8'));
 const base=requireHostedFixture(fixture.base);
 const contexts=await Promise.all([browser.newContext(),browser.newContext()]);
 const headers={'x-vercel-protection-bypass':target.secret,origin:target.origin};
 const results:any[]=[];
 async function login(page:Page,person:{email:string,password:string}){
  await page.goto('/login');await page.locator('main form').first().getByLabel('School email address').fill(person.email);
  await page.getByLabel('Password',{exact:true}).fill(person.password);await page.getByRole('button',{name:'Log in',exact:true}).click();
  await expect(page).toHaveURL(/\/(account|teacher)$/);
 }
 try{
  for(const context of contexts) await context.route('**/*',route=>new URL(route.request().url()).origin!==target.origin?route.abort():route.continue({headers:{...route.request().headers(),...headers}}));
  const page=await contexts[0].newPage(),other=await contexts[1].newPage();
  expect((await page.request.get(target.origin+'/api/teacher/workspace',{headers})).status()).toBe(401);
  await login(page,base.teacher);await login(other,base.other);
  await page.goto('/teacher');
  for(const expected of fixture.modules){
   const path='/api/teacher/workspace?curriculum='+expected.id;
   const response=await page.request.get(target.origin+path,{headers});expect(response.status()).toBe(200);
   const workspace=await response.json();expect(workspace.module.release).toBe(expected.release);
   expect(workspace.entries).toHaveLength(expected.entries);
   expect(workspace.entries.filter((e:any)=>e.thumbnail)).toHaveLength(expected.diagrams);
   expect(workspace.entries.every((e:any)=>e.orderable===false)).toBe(true);
   expect(workspace.entries.some((e:any)=>e.marks.min<e.marks.max)).toBe(true);
   expect(JSON.stringify(workspace)).not.toMatch(/formRevision|bundleDigest|sourceDependencies|paperFields/);
   expect((await other.request.get(target.origin+path,{headers})).status()).toBe(403);
   await page.getByRole('combobox',{name:/^Curriculum/}).selectOption(expected.id);
   await expect(page.locator('article')).toHaveCount(expected.entries);
   await expect(page.locator('article input[type=checkbox]').first()).toBeDisabled();
   const image=page.locator('article img').first();await image.scrollIntoViewIfNeeded();await expect(image).toBeVisible();
   await expect.poll(()=>image.evaluate((e:HTMLImageElement)=>e.complete&&e.naturalWidth>0)).toBe(true);
   const diagram=workspace.entries.find((e:any)=>e.thumbnail);
   const png=await page.request.get(target.origin+diagram.thumbnail.src,{headers});expect(png.status()).toBe(200);
   expect((await png.body()).subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');
   expect((await other.request.get(target.origin+diagram.thumbnail.src,{headers})).status()).toBe(404);
   const code=workspace.entries.find((e:any)=>e.id.startsWith('structured:')).id.split(':')[1];
   await page.getByLabel('Search topics or curricula').fill(code);
   await expect(page.locator('article').first()).toBeVisible();
   const search=await page.request.get(target.origin+'/api/teacher/catalogue/search?q='+encodeURIComponent(code),{headers});
   expect(search.status()).toBe(200);expect((await search.json()).matches.some((m:any)=>m.module.id===expected.id&&m.entry.id.endsWith(code))).toBe(true);
   await page.getByRole('button',{name:'Clear search',exact:true}).click();
   const denied=await page.request.put(target.origin+'/api/teacher/workspace',{headers,data:{kind:'selection',moduleId:expected.id,release:expected.release,revision:workspace.selection.revision,entryIds:[workspace.entries[0].id]}});
   expect(denied.status()).toBe(422);
   results.push({module:expected.id,entries:workspace.entries.length,diagrams:expected.diagrams,enabled:0,marks:true,search:true,disabledSelection:true,otherSchoolDenied:true});
  }
  const orderPath=target.origin+'/api/teacher/orders/'+fixture.order;
  expect((await other.request.get(orderPath,{headers})).status()).toBe(404);
  const visible=await page.request.get(orderPath,{headers});expect(visible.status()).toBe(200);const order=await visible.json();expect(order.form).toEqual(fixture.form);
  expect(JSON.stringify(order)).not.toMatch(/bundleDigest|manifestSha256|generationPlan|sourceDependencies/);
  await page.goto('/teacher/orders/'+fixture.order);
  await expect(page.getByText('No further details are needed for this question.',{exact:true})).toBeVisible();
  expect(await page.locator('main select').evaluateAll((els:any[])=>els.every(e=>e.value===''))).toBe(true);
  const submitted=await page.request.post(orderPath+'/submit',{headers,data:{requestKey:fixture.requestKey,answers:fixture.answers}});expect(submitted.status()).toBe(202);
  const duplicate=await page.request.post(orderPath+'/submit',{headers,data:{requestKey:fixture.requestKey,answers:fixture.answers}});expect(duplicate.status()).toBe(202);
  const final=await (await page.request.get(orderPath,{headers})).json();expect(final.answers).toEqual(fixture.answers);expect(final.state).toBe('queued');expect(final.documents).toEqual([]);
  writeFileSync(info.outputPath('catalogue-evidence.json'),JSON.stringify({project:target.project,origin:target.origin,modules:results,order:fixture.order,formFrozen:true,explicitEmptyForm:true,privateInputsHidden:true,otherSchoolOrderDenied:true,answersRetained:true,duplicateAccepted:true,scope:'Internal questionnaire admission only. Dedicated worker fence; no generation.'},null,2));
 }finally{await Promise.all(contexts.map(c=>c.close()));}
});
