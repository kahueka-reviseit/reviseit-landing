import {test,expect} from '@playwright/test';
test('human approval and worker confirmation are distinct on desktop and mobile',async({page})=>{
 await page.goto('/?screen=release-publication');await expect(page.getByRole('heading',{name:'Review and publish'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Approve this package'})).toBeDisabled();
 await page.getByRole('textbox').fill('Reviewed the exact synthetic package.');await page.getByRole('checkbox').check();
 await expect(page.getByRole('button',{name:'Approve this package'})).toBeEnabled();
 await expect(page.getByRole('button',{name:'Publish and activate'})).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`studio-test-results/release-publication-${test.info().project.name}.png`,fullPage:true});
});
