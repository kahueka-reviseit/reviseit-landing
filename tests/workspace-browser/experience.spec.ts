import {test,expect,type Page} from '@playwright/test';
// C08 My papers and paper page (Paper M1 to M5) on the synthetic screens harness.
const noSideScroll=async(page:Page)=>expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
test('My papers puts what needs the teacher first and keeps closed papers last',async({page})=>{
 await page.goto('/screens.html?screen=papers');
 const list=page.getByRole('region',{name:'Your papers'});
 await expect(list.getByRole('heading',{level:2}).first()).toBeVisible();
 await expect(page.getByRole('link',{name:/^Finish details:/})).toBeVisible();
 await expect(page.getByRole('link',{name:/^Continue to payment:/})).toBeVisible();
 await expect(page.getByText('Closed · no further action')).toBeVisible();
 // Payment is never shown as paid for an open checkout.
 await expect(page.getByText('Not paid yet').first()).toBeVisible();
 await noSideScroll(page);
 await page.goto('/screens.html?screen=papers&empty=1');await expect(page.getByRole('heading',{name:'No papers yet'})).toBeVisible();
 await page.goto('/screens.html?screen=papers&failed=1');await expect(page.getByRole('alert')).toContainText('We could not load your papers');
});
test('ready paper offers four private downloads and the submitted details per question',async({page})=>{
 await page.goto('/screens.html?screen=order&state=released');
 const downloads=page.getByRole('link',{name:/^Download /});await expect(downloads).toHaveCount(4);
 for(const name of ['paper','memo','learner-memo','teacher-description'])await expect(page.locator(`a[href$="/documents/${name}"]`)).toHaveCount(1);
 const summary=page.getByRole('region',{name:'What you asked for'});
 await expect(summary.getByText('second occurrence')).toBeVisible();
 await expect(summary.getByText('Synthetic shade: Revise It chose')).toBeVisible();
 await expect(summary.getByText('Synthetic setting: Setting two')).toHaveCount(1);
 await expect(page.getByText('Submitted · 4 of 4')).toBeVisible();
 await noSideScroll(page);
});
test('creation shows the real stages without a percentage; a stopped paper releases nothing',async({page})=>{
 await page.goto('/screens.html?screen=order&state=rendering');
 const current=page.locator('li[aria-current="step"]',{hasText:'Formatting your documents'});await expect(current).toContainText('In progress');
 await expect(page.getByText('%')).toHaveCount(0);
 await page.goto('/screens.html?screen=order&state=held');
 await expect(page.getByRole('alert')).toContainText('Your paper has stopped and needs our attention');
 await expect(page.getByRole('link',{name:/^Download /})).toHaveCount(0);
 await page.goto('/screens.html?screen=order&state=released&summary=fail');
 await expect(page.getByText('Your submitted details could not be loaded just now.')).toBeVisible();
});
test('an unpaid older order waits for the server and keeps its payment actions together',async({page})=>{
 await page.goto('/screens.html?screen=order&state=awaiting_payment&legacy=1');
 await expect(page.getByText('We have not received a payment confirmation yet')).toBeVisible();
 await expect(page.getByRole('link',{name:'Continue to secure payment'})).toBeVisible();
 await expect(page.getByRole('button',{name:'I have paid: check again'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Cancel this checkout'})).toBeVisible();
 await page.goto('/screens.html?screen=order&state=awaiting_answers&payment=refunded');
 await expect(page.getByText('This payment was refunded. The paper is closed.')).toBeVisible();
});
test('the teacher menu opens, closes with Escape and returns focus on phones',async({page},info)=>{
 test.skip(info.project.name!=='mobile','Phone menu');
 await page.goto('/screens.html?screen=papers');
 const menu=page.getByRole('button',{name:'Menu'});await menu.click();
 await expect(page.getByRole('link',{name:'My account'})).toBeVisible();
 await page.keyboard.press('Escape');await expect(menu).toBeFocused();await expect(menu).toHaveAttribute('aria-expanded','false');
});
