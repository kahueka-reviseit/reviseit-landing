import {test,expect} from '@playwright/test';
test('draft editor preserves work after a stale save and shows differences and history',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/?screen=draft');
 await expect(page.getByRole('heading',{name:'Edit bank file',level:1})).toBeVisible();await expect(page.getByText('This rehearsal draft cannot become an accepted bank change.')).toBeVisible();
 const editor=page.getByLabel('Source text');const original=await editor.inputValue();await editor.fill(original+'\nA synthetic correction.');await page.getByLabel('Reason for change',{exact:true}).fill('Clarify the source in this test.');await page.getByRole('button',{name:'Save draft',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('newer revision');await expect(editor).toHaveValue(original+'\nA synthetic correction.');
 page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('link',{name:'Library / Source file',exact:true}).click();await expect(editor).toHaveValue(original+'\nA synthetic correction.');
 await page.getByRole('button',{name:'Difference',exact:true}).click();await expect(page.getByRole('heading',{name:'Difference from the starting file'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`studio-test-results/${test.info().project.name}-draft-difference.png`,fullPage:true});
 await page.getByRole('button',{name:'History',exact:true}).click();await expect(page.getByRole('heading',{name:'Revision 1 · current'})).toBeVisible();expect(errors).toEqual([]);
});
test('restoration prepares text and requires a reason before a new save',async({page})=>{
 await page.goto('/?screen=draft');await page.getByRole('button',{name:'Restore this text as a new revision'}).click();await expect(page.getByRole('button',{name:'Save draft',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Source',exact:true}).click();await expect(page.getByLabel('Source text')).toHaveValue(/Assess one synthetic calculation\./);
 await page.screenshot({path:`studio-test-results/${test.info().project.name}-draft-editor.png`,fullPage:true});
});
