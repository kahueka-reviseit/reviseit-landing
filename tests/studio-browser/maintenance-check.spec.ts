import {test,expect} from '@playwright/test';
test('candidate review separates structural findings and explicit human judgement',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/?screen=check');
 await expect(page.getByRole('heading',{name:'Proposed bank review',exact:true})).toBeVisible();await expect(page.getByText(/does not authorise bank integration/)).toBeVisible();
 await page.getByLabel('Outcome').selectOption('approved');await page.getByLabel('Review reason').fill('I have inspected the synthetic evidence and compatibility.');const button=page.getByRole('button',{name:'Record content review'});await expect(button).toBeDisabled();for(const box of await page.getByRole('checkbox').all())await box.check();await button.click();await expect(page.getByRole('alert')).toContainText('fresh check');await expect(page.getByLabel('Review reason')).toHaveValue('I have inspected the synthetic evidence and compatibility.');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`studio-test-results/${test.info().project.name}-maintenance-check.png`,fullPage:true});expect(errors).toEqual([]);
});
