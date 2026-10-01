import {test,expect,type Locator,type Page} from '@playwright/test';
import fs from 'node:fs';
import record from '../../design/paper/linked-components.json';
// C15: one definition, several feature areas. Synthetic preview only.
// Each check measures a shared component where two different features render it, compares
// the result with the value exported from its Paper master, then changes that one value
// and expects every use to follow. The measurements are saved for the propagation record.
const value=(page:Page,name:string)=>page.evaluate(n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim(),name);
const set=(page:Page,name:string,to:string)=>page.evaluate(([n,v])=>document.documentElement.style.setProperty(n,v),[name,to]);
const css=(target:Locator,property:string)=>target.evaluate((e,p)=>getComputedStyle(e).getPropertyValue(p),property);
const rgb=(hex:string)=>/^#[0-9a-f]{6}$/i.test(hex)?`rgb(${[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)).join(', ')})`:hex;
const save=(name:string,project:string,data:unknown)=>{fs.mkdirSync('workspace-test-results',{recursive:true});fs.writeFileSync(`workspace-test-results/linked-${name}-${project}.json`,JSON.stringify(data,null,1));};

async function catalogueTag(page:Page){
 await page.goto('/');await page.getByRole('button',{name:'Block on a rough slope',exact:true}).click();
 return page.getByRole('table').getByText('Remember',{exact:true}).first();
}
async function editorTag(page:Page){
 await page.goto('/configurator.html?brief=1');await page.getByRole('button',{name:'Edit question 3',exact:true}).click();
 const context=page.getByRole('dialog').getByRole('region',{name:'About the question you chose'});
 await context.locator('button[aria-controls]').click();
 return context.getByRole('listitem').first().getByText('Remember',{exact:true});
}

test('the Bloom’s tag is one definition in the catalogue and in the paid editor',async({page},info)=>{
 expect(Object.keys(record.masters.tag.values)).toContain('--pc-tag-border-radius');
 const measured:Record<string,Record<string,string>>={};
 for(const [area,open] of [['catalogue detail',catalogueTag],['paid question editor',editorTag]] as const){
  const tag=await open(page);await expect(tag).toBeVisible();
  // As exported from the Paper master.
  await expect(tag).toHaveCSS('border-radius',await value(page,'--pc-tag-border-radius'));
  await expect(tag).toHaveCSS('background-color',rgb(await value(page,'--pc-tag-background-color')));
  await expect(tag).toHaveCSS('font-size',await value(page,'--pc-tag__label-font-size'));
  await expect(tag).toHaveCSS('padding-top',await value(page,'--pc-tag-padding-block'));
  measured[area]={radius:await css(tag,'border-radius'),background:await css(tag,'background-color'),fontSize:await css(tag,'font-size'),paddingTop:await css(tag,'padding-top'),paddingLeft:await css(tag,'padding-left'),width:await css(tag,'width'),letterSpacing:await css(tag,'letter-spacing'),whiteSpace:await css(tag,'white-space')};
  // Change the component value once, then the token it is bound to: this use follows both.
  await set(page,'--pc-tag-border-radius','11px');await expect(tag).toHaveCSS('border-radius','11px');
  await set(page,'--color-sage-700','#102030');await expect(tag).toHaveCSS('background-color','rgb(16, 32, 48)');
 }
 const [catalogue,editor]=[measured['catalogue detail'],measured['paid question editor']];
 for(const property of ['radius','background','fontSize','paddingTop','letterSpacing','whiteSpace'])expect(catalogue[property]).toBe(editor[property]);
 // The declared context variant: a fixed column inside an outline row. Everything else is shared.
 expect(editor.width).toBe(await value(page,'--pc-tag--column-width'));expect(editor.paddingLeft).toBe(await value(page,'--pc-tag--column-padding-inline'));
 expect(catalogue.paddingLeft).toBe(await value(page,'--pc-tag-padding-inline'));
 save('tag',info.project.name,measured);
});

test('the notice and status marker are one definition across My papers, a paper’s page and payment',async({page},info)=>{
 const places:[string,string,(page:Page)=>Locator][]=[
  ['My papers, load failure','/screens.html?screen=papers&failed=1',p=>p.getByRole('alert')],
  ['paper page, stopped','/screens.html?screen=order&state=held',p=>p.getByRole('alert').filter({hasText:'needs our attention'})],
  ['paid configuration, awaiting payment','/configurator.html?paid=0',p=>p.getByRole('status').filter({hasText:/payment/i}).first()],
 ];
 const measured:Record<string,Record<string,string>>={},tones:Record<string,Record<string,string>>={};
 for(const [name,url,find] of places){
  await page.goto(url);const notice=find(page);await expect(notice).toBeVisible();
  await expect(notice).toHaveCSS('padding-top',await value(page,'--pc-notice-padding-block'));
  await expect(notice).toHaveCSS('border-left-width',await value(page,'--pc-notice-border-left-width'));
  await expect(notice).toHaveCSS('border-top-left-radius',await value(page,'--pc-notice-border-radius'));
  measured[name]={paddingTop:await css(notice,'padding-top'),radius:await css(notice,'border-top-left-radius'),borderLeft:await css(notice,'border-left-width')};
  tones[name]={background:await css(notice,'background-color'),borderLeftColor:await css(notice,'border-left-color')};
  await set(page,'--pc-notice-padding-block','31px');await expect(notice).toHaveCSS('padding-top','31px');
  // A notice is persistent task feedback: it never offers a dismiss control.
  await expect(notice.getByRole('button',{name:/dismiss|close|hide/i})).toHaveCount(0);
 }
 expect(new Set(Object.values(measured).map(m=>JSON.stringify(m))).size).toBe(1);
 // Status markers: the same dot in the list and on the paper page, driven by one status token.
 const dots:Record<string,string>={};
 for(const [name,url] of [['My papers list','/screens.html?screen=papers'],['paper page facts','/screens.html?screen=order&state=released']] as const){
  await page.goto(url);const dot=page.locator('[class*="status__dot--done"]').first();await expect(dot).toBeVisible();
  dots[name]=await css(dot,'background-color');
  await set(page,'--color-status-done','#0A0B0C');await expect(dot).toHaveCSS('background-color','rgb(10, 11, 12)');
 }
 expect(dots['My papers list']).toBe(dots['paper page facts']);
 save('notice-status',info.project.name,{notices:measured,tones,statusDots:dots});
});

test('question context spacing comes from the master and holds at desktop and phone widths',async({page},info)=>{
 const desktop=info.project.name==='desktop';if(desktop)await page.setViewportSize({width:1440,height:1000});
 await page.goto('/configurator.html?brief=1&long=1');await page.getByRole('button',{name:'Edit question 2',exact:true}).click();
 const context=page.getByRole('dialog').getByRole('region',{name:'About the question you chose'});await expect(context).toBeVisible();
 await expect(context).toHaveCSS('gap',await value(page,'--pc-question-context-gap'));
 await expect(context).toHaveCSS('padding-left',await value(page,desktop?'--pc-question-context-padding-inline':'--pc-question-context--narrow-padding-inline'));
 const before={gap:await css(context,'gap'),paddingLeft:await css(context,'padding-left')};
 await set(page,'--pc-question-context-gap','28px');await expect(context).toHaveCSS('gap','28px');
 // Long content still wraps inside the panel and the page never scrolls sideways.
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 save('question-context',info.project.name,{before,after:{gap:await css(context,'gap')}});
});

test('two occurrences of the same question type keep their own words and their own context',async({page},info)=>{
 if(info.project.name==='desktop')await page.setViewportSize({width:1440,height:1000});
 await page.goto('/configurator.html?brief=1&many=1');
 const dialog=page.getByRole('dialog'),brief=dialog.getByLabel('Your brief',{exact:true});
 const open=async(n:string)=>{await page.getByRole('button',{name:`Edit question ${n}`,exact:true}).click();await expect(dialog).toBeVisible();};
 const close=async()=>{await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);};
 await open('1.1');await brief.fill('First occurrence: a familiar everyday case.');
 await expect(dialog.getByRole('region',{name:'About the question you chose'})).toContainText('One multiple-choice item');
 await close();
 await open('1.2');await expect(brief).toHaveValue('');await brief.fill('Second occurrence: an unfamiliar case.');await close();
 await open('1.1');await expect(brief).toHaveValue('First occurrence: a familiar everyday case.');await close();
 await open('1.2');await expect(brief).toHaveValue('Second occurrence: an unfamiliar case.');
 // Keyboard: Escape closes the editor and returns focus to the row that opened it.
 await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Edit question 1.2',exact:true})).toBeFocused();
});

test('the paid question table status is the shared marker at table density',async({page},info)=>{
 await page.goto('/configurator.html');
 const cell=page.getByRole('row').nth(1).locator('[class*="status__label--"]');await expect(cell).toBeVisible();
 await expect(cell).toHaveCSS('font-size','13px');await expect(cell).toHaveCSS('font-weight','400');
 const dot=page.getByRole('row').nth(1).locator('[class*="status__dot--"]');
 await expect(dot).toHaveCSS('width','8px');
 const tone=(await dot.getAttribute('class'))!.match(/status__dot--(\w+)/)![1];
 await set(page,`--color-status-${tone==='done'?'done':'attention'}`,'#0A0B0C');await expect(dot).toHaveCSS('background-color','rgb(10, 11, 12)');
 save('table-status',info.project.name,{tone,fontSize:await css(cell,'font-size')});
});
