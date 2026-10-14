import {test,expect} from '@playwright/test';
test('source-to-impact journey exposes evidence and its limits on each viewport',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/?screen=file');
 await page.getByRole('link',{name:'Inspect dependency impact',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Dependency impact',exact:true})).toBeVisible();await expect(page.getByText(/does not approve a change/)).toBeVisible();
 await expect(page.getByRole('heading',{name:'Existing orders stay pinned'})).toBeVisible();
 await page.getByText('Report binding',{exact:true}).click();await expect(page.getByText('Record projection',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`studio-test-results/${test.info().project.name}-dependency-impact.png`,fullPage:true});expect(errors).toEqual([]);
});
