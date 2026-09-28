import {test,expect} from '@playwright/test';
import paper from '../../design/paper/table-layout.json';
test('Paper table opens a side panel or full-page mobile editor and keeps edits when closed',async({page},info)=>{
 await page.goto('/configurator.html?brief=1&many=1');
 const table=page.getByRole('table',{name:'Questions in your paper'});
 await expect(table).toBeVisible();await expect(table.getByRole('row')).toHaveCount(info.project.name==='desktop'?19:18);
 await expect(page.getByRole('heading',{name:'Your paper',exact:true})).toBeVisible();
 await expect(page.getByRole('navigation',{name:'Questions in this paper'})).toHaveCount(0);
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.screenshot({path:`workspace-test-results/paper-table-${info.project.name}.png`,fullPage:true});
 const edit=page.getByRole('button',{name:'Edit question 2',exact:true});await edit.click();
 const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
 if(info.project.name==='desktop')await expect(dialog).toHaveCSS('width',paper.styles['8YA-0'].width);
 else {const box=(await dialog.boundingBox())!;expect(box.width).toBe(page.viewportSize()!.width);expect(box.y).toBe(0);}
 await expect(page.getByRole('heading',{name:'Still to decide'})).toHaveCount(0);
 const text=dialog.getByLabel('Your brief',{exact:true});await text.fill('Use a familiar context and let learners explain the result.');
 // Close while autosave is pending; the draft lives above the dialog.
 await dialog.getByRole('button',{name:'Close editor'}).click();await expect(edit).toBeFocused();await edit.click();
 await expect(dialog.getByLabel('Your brief',{exact:true})).toHaveValue('Use a familiar context and let learners explain the result.');
 await page.screenshot({path:`workspace-test-results/paper-editor-${info.project.name}.png`,fullPage:false});
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(edit).toBeFocused();
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.reload(); // Preview has no persistence: isolate the following fixture.
 await page.goto('/configurator.html?brief=1');await page.getByRole('button',{name:'Edit question 2',exact:true}).click();
 await page.getByLabel('Your brief',{exact:true}).fill('Use setting one and a blue shade.');
 const configure=page.getByRole('button',{name:'Configure →',exact:true});await expect(configure).toBeEnabled();await configure.click();
 await expect(page.getByRole('heading',{name:'What we understood'})).toBeVisible();
 await expect(page.getByText('Use setting one and a blue shade.',{exact:true})).toBeVisible();
 await page.screenshot({path:`workspace-test-results/paper-understood-${info.project.name}.png`,fullPage:false});
 await page.getByRole('button',{name:'Edit brief',exact:true}).click();await expect(page.getByLabel('Your brief',{exact:true})).toHaveValue('Use setting one and a blue shade.');
});

test('tablet table does not clip editing actions',async({page})=>{
 await page.setViewportSize({width:1080,height:900});await page.goto('/configurator.html?brief=1');
 const edit=page.getByRole('button',{name:'Edit question 2',exact:true});
 const box=(await edit.boundingBox())!;expect(box.x+box.width).toBeLessThanOrEqual(1080);await edit.click();
 await expect(page.getByRole('dialog')).toBeVisible();
});
