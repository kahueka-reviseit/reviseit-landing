import {test,expect,type Page} from '@playwright/test';
import paper from '../../design/paper/question-context.json';
// C06: the catalogue reminder above the brief (Paper D9–D11). Synthetic preview only.
const s=paper.styles;
const shot=(page:Page,name:string,full=false)=>page.screenshot({path:`workspace-test-results/question-context-${name}.png`,fullPage:full});
async function recordRequests(page:Page){await page.evaluate(()=>{const w=window as any,f=window.fetch;w.__requests=[];window.fetch=(i,o)=>{w.__requests.push(String(i));return f(i,o);};});}
const requests=(page:Page)=>page.evaluate(()=>(window as any).__requests as string[]);

test('reminder follows the Paper export, sits above the brief and keeps the draft through the outline',async({page},info)=>{
 const desktop=info.project.name==='desktop';if(desktop)await page.setViewportSize({width:1440,height:1000});
 await page.goto('/configurator.html?brief=1');await recordRequests(page);
 const edit=page.getByRole('button',{name:'Edit question 3',exact:true});await edit.click();
 const dialog=page.getByRole('dialog'),context=dialog.getByRole('region',{name:'About the question you chose'});
 await expect(context).toBeVisible();
 const frame=desktop?s['A22-0']:s['AG2-0'];
 await expect(context).toHaveCSS('padding-top',frame.paddingBlock);await expect(context).toHaveCSS('padding-left',frame.paddingInline);await expect(context).toHaveCSS('gap',frame.gap);
 const heading=context.getByRole('heading',{name:'About the question you chose'});
 await expect(heading).toHaveCSS('font-size',s['A23-0'].fontSize);await expect(heading).toHaveCSS('line-height',s['A23-0'].lineHeight);await expect(heading).toHaveCSS('letter-spacing','1.44px');
 const diagram=context.getByRole('img',{name:'Synthetic diagram for the authored question'});
 await expect(diagram).toHaveCSS('width',s['A26-0'].width);await expect(diagram).toHaveCSS('height',s['A26-0'].height);
 await expect(context.getByText('Synthetic relationships')).toHaveCSS('line-height',s['A28-0'].lineHeight);
 await expect(context.getByText(/^Learners use a synthetic/)).toHaveCSS('font-size',s['A29-0'].fontSize);
 await expect(context.getByText('12 marks selected')).toHaveCSS('font-weight',String(s['A2C-0'].fontWeight));
 const toggle=context.locator('button[aria-controls]');await expect(toggle).toHaveAccessibleName('View question outline');
 await expect(toggle).toHaveCSS('padding-top',s['A2G-0'].paddingTop);await expect(toggle).toHaveCSS('font-size',s['A2H-0'].fontSize);
 const prompts=dialog.getByRole('list',{name:'For this question, you could describe'});
 await expect(prompts.locator('..')).toHaveCSS('padding-left',s['A2O-0'].paddingLeft);await expect(prompts.locator('..')).toHaveCSS('border-left-width',s['A2O-0'].borderLeftWidth);
 const brief=dialog.getByLabel('Your brief',{exact:true});
 await expect(brief).toHaveCSS('min-height',s['A2S-0'].height);await expect(brief).toHaveCSS('font-size',s['A2T-0'].fontSize);
 // Hierarchy: reminder, then prompts, then the teacher's own words.
 const [c,p,b]=await Promise.all([context.boundingBox(),prompts.boundingBox(),brief.boundingBox()]);
 expect(c!.y+c!.height).toBeLessThanOrEqual(p!.y);expect(p!.y+p!.height).toBeLessThan(b!.y);
 await shot(page,`collapsed-${info.project.name}`);

 await brief.fill('Two familiar synthetic cases, then explain the difference.');await brief.focus();
 const node=await brief.elementHandle();
 await toggle.click();await expect(toggle).toHaveAttribute('aria-expanded','true');
 const outline=page.locator(`#${await toggle.getAttribute('aria-controls')}`);
 await expect(outline.getByRole('listitem')).toHaveCount(3);
 const row=outline.getByRole('listitem').first();
 await expect(row).toHaveCSS('padding-top',s['AEC-0'].paddingBlock);await expect(row).toHaveCSS('gap',s['AEC-0'].gap);
 await expect(row.getByText('Remember')).toHaveCSS('width',s['AEF-0'].width);
 await expect(outline.getByText(/Example structure/)).toHaveCSS('font-size',s['AEA-0'].fontSize);
 // Same textarea, same words: the disclosure never remounts the input.
 expect(await node!.evaluate(el=>el.isConnected)).toBe(true);await expect(brief).toHaveValue('Two familiar synthetic cases, then explain the difference.');
 await shot(page,`expanded-${info.project.name}`);
 // One scroll area: the reminder never scrolls on its own and the page does not scroll sideways.
 expect(await context.evaluate(el=>el.scrollHeight<=el.clientHeight+1)).toBe(true);
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 // Keyboard: the disclosure toggles with Enter; Escape still closes and returns focus.
 await toggle.focus();await page.keyboard.press('Enter');await expect(toggle).toHaveAttribute('aria-expanded','false');await page.keyboard.press('Enter');
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(edit).toBeFocused();
 await edit.click();await expect(dialog.getByLabel('Your brief',{exact:true})).toHaveValue('Two familiar synthetic cases, then explain the difference.');
 await expect(dialog.getByRole('button',{name:'Hide question outline'})).toHaveAttribute('aria-expanded','true');
 expect((await requests(page)).filter(u=>/interpret|hints/.test(u))).toEqual([]);
});

test('multiple-choice and missing catalogue information stay explicit',async({page},info)=>{
 if(info.project.name==='desktop')await page.setViewportSize({width:1440,height:1000});
 await page.goto('/configurator.html?brief=1');
 await page.getByRole('button',{name:'Edit question 2',exact:true}).click();
 const context=page.getByRole('region',{name:'About the question you chose'});
 await expect(context.getByText('A short description has not been published for this question.')).toBeVisible();
 await expect(context.getByText('An example question outline has not been published for this question.')).toBeVisible();
 await expect(context.getByRole('img')).toHaveCount(0);await expect(context.getByRole('button')).toHaveCount(0);
 await shot(page,`missing-${info.project.name}`);
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'Edit question 1.1',exact:true}).click();
 await expect(context.getByText('2 marks · fixed')).toBeVisible();await expect(context.getByText('One multiple-choice item')).toBeVisible();
 await shot(page,`multiple-choice-${info.project.name}`);
 // After interpretation the reminder stays above the retained brief and the revealed choices.
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'Edit question 2',exact:true}).click();
 await page.getByLabel('Your brief',{exact:true}).fill('Use setting one and a blue shade.');
 await page.getByRole('button',{name:'Configure →',exact:true}).click();
 await expect(page.getByRole('heading',{name:'What we understood'})).toBeVisible();await expect(context).toBeVisible();
 await page.getByRole('button',{name:'Change Synthetic shade'}).click();await expect(page.getByRole('radio',{name:'Red',exact:true})).toBeVisible();await expect(context).toBeVisible();
 await shot(page,`after-configure-${info.project.name}`);
});

test('long context and an 18-question paper do not bury the brief',async({page},info)=>{
 const desktop=info.project.name==='desktop';if(desktop)await page.setViewportSize({width:1440,height:1000});
 await page.goto('/configurator.html?brief=1&long=1');await page.getByRole('button',{name:'Edit question 3',exact:true}).click();
 const context=page.getByRole('dialog').getByRole('region',{name:'About the question you chose'});
 // A long description is capped; its full text is one explicit click away and the brief keeps its words.
 const more=context.getByRole('button',{name:'Show full description'});await expect(more).toHaveAttribute('aria-expanded','false');
 expect((await context.boundingBox())!.height).toBeLessThan(desktop?420:560);
 await shot(page,`long-capped-${info.project.name}`);
 const brief=page.getByLabel('Your brief',{exact:true});await brief.scrollIntoViewIfNeeded();await expect(brief).toBeInViewport();
 await brief.fill('Still reachable and editable.');
 await more.click();await expect(context.getByRole('button',{name:'Show less'})).toHaveAttribute('aria-expanded','true');
 await expect(brief).toHaveValue('Still reachable and editable.');
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await context.scrollIntoViewIfNeeded();
 await shot(page,`long-${info.project.name}`);
 await page.goto('/configurator.html?brief=1&many=1');await page.getByRole('button',{name:'Edit question 2',exact:true}).click();
 await expect(page.getByRole('region',{name:'About the question you chose'})).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await shot(page,`many-${info.project.name}`);
});

test('tablet widths keep the reminder, diagram and brief within the editor',async({page})=>{
 for(const [width,height] of [[1080,900],[768,1024]]){
  await page.setViewportSize({width,height});await page.goto('/configurator.html?brief=1');
  await page.getByRole('button',{name:'Edit question 3',exact:true}).click();
  const dialog=page.getByRole('dialog'),box=(await dialog.boundingBox())!;
  for(const el of [dialog.getByRole('img'),dialog.getByLabel('Your brief',{exact:true})]){const b=(await el.boundingBox())!;expect(b.x+b.width).toBeLessThanOrEqual(box.x+box.width);}
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await shot(page,`tablet-${width}`);
 }
});
