import {test,expect} from '@playwright/test';
test('structured form editing, source evidence, preview and failed save preserve the private draft',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/?screen=form');await expect(page.getByRole('heading',{name:'Edit teacher form',level:1})).toBeVisible();
 await expect(page.getByRole('button',{name:'Save draft',exact:true})).toBeDisabled();await page.getByLabel('Teacher-facing question').fill('Which quantity should be calculated?');await page.getByLabel('Allow automatic selection').check();await page.getByLabel('Reason for change',{exact:true}).fill('Make the question clearer for the teacher.');
 await page.screenshot({path:`studio-test-results/${test.info().project.name}-form-editor.png`,fullPage:true});
 await page.getByRole('button',{name:'Teacher preview',exact:true}).click();await expect(page.getByRole('heading',{name:'Which quantity should be calculated? *'})).toBeVisible();await page.getByRole('button',{name:'Check example answers'}).click();await expect(page.getByRole('status').filter({hasText:'example answers pass'})).toContainText('1 of 2');
 await page.getByLabel('Answer · quantity',{exact:true}).selectOption('automatic');await page.getByRole('button',{name:'Check example answers'}).click();await expect(page.getByRole('status').filter({hasText:'example answers pass'})).toContainText('2 of 2');
 await page.getByRole('button',{name:'Source evidence',exact:true}).click();await page.getByText('quantity · Which quantity should learners calculate?',{exact:true}).click();await expect(page.getByText(/Ask for speed or distance/)).toBeVisible();
 await page.getByRole('button',{name:'Difference',exact:true}).click();await expect(page.getByRole('heading',{name:'Difference from the starting file'})).toBeVisible();
 await page.getByRole('button',{name:'Save draft',exact:true}).click();await expect(page.getByRole('alert')).toContainText('newer revision');await page.getByRole('button',{name:'Fields & settings',exact:true}).click();await expect(page.getByLabel('Teacher-facing question')).toHaveValue('Which quantity should be calculated?');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});
