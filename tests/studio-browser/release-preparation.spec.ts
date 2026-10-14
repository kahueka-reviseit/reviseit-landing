import {test,expect} from '@playwright/test';
test('release preparation separates evidence, gaps and publication on desktop and mobile',async({page})=>{
 await page.goto('/?screen=release-preparation');await expect(page.getByRole('heading',{name:'Prepare from the accepted bank'})).toBeVisible();await page.getByText('Items requiring review',{exact:true}).click();await expect(page.getByText('mcq:MISSING',{exact:false})).toBeVisible();await page.getByText('What still needs to happen before publication',{exact:true}).click();await expect(page.getByText('Running worker registration and health',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:/publish|approve/i})).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`studio-test-results/release-preparation-${test.info().project.name}.png`,fullPage:true});
});
