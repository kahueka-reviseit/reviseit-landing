import {test,expect} from '@playwright/test';
test('optional Jev advice follows a saved note and can be dismissed without changing it',async({page},info)=>{
 await page.goto('/configurator.html?jev=1');await page.getByRole('button',{name:/^Q2 ·/}).click();
 const advice=page.getByRole('region',{name:'Jev suggestions'});
 await expect(advice.getByText('Jev can help when you describe a choice in your own words.')).toBeVisible();
 const note=page.getByRole('group',{name:'Anything else (optional)'});await note.getByLabel('Write my answer').check();
 const input=note.getByRole('textbox');await input.fill('Use a different setting.');
 await expect(advice.getByText('Your synthetic note may conflict with the selected setting.')).toBeVisible();
 await expect(input).toHaveValue('Use a different setting.');
 await page.screenshot({path:`workspace-test-results/jev-advice-${info.project.name}.png`,fullPage:true});
 await advice.getByRole('button',{name:'Keep my answer'}).click();await expect(advice.getByText('Your synthetic note may conflict with the selected setting.')).not.toBeVisible();
 await expect(input).toHaveValue('Use a different setting.');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
