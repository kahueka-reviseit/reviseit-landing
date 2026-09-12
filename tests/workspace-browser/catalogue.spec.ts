import {test,expect} from '@playwright/test';
test('diagrams load and topic search preserves the paper selection',async({page},info)=>{
 await page.goto('/');
 const image=page.getByRole('img',{name:'Velocity against time graph with a rising line followed by a horizontal line'});
 await image.scrollIntoViewIfNeeded();await expect.poll(()=>image.evaluate((e:HTMLImageElement)=>e.naturalWidth)).toBeGreaterThan(0);
 await page.getByLabel('Select Reading a motion graph').check();
 await expect(page.getByText('8–12 marks')).toBeVisible();
 await expect(page.getByRole('complementary').locator('strong').first()).toHaveText('8–12');
 await page.getByRole('searchbox').fill('electricity');
 await expect(page.getByText('2 matching questions.')).toBeVisible();
 await expect(page.getByLabel('Select Reading a motion graph')).toHaveCount(0);
 await expect(page.getByRole('complementary').getByText('Reading a motion graph')).toBeVisible();
 await expect(page.getByRole('button',{name:'Browse Grade 11 Physical Sciences · demonstration'})).toBeVisible();
 await page.getByRole('button',{name:'Clear search'}).click();await expect(page.getByLabel('Select Reading a motion graph')).toBeChecked();
 await expect.poll(()=>page.locator('img').evaluateAll(images=>images.every(e=>(e as HTMLImageElement).complete && (e as HTMLImageElement).naturalWidth>0))).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:`workspace-test-results/catalogue-diagrams-${info.project.name}.png`,fullPage:true});
});
test('curriculum search offers a switch into the matching paper',async({page})=>{
 await page.goto('/');await page.getByRole('searchbox').fill('grade 11 electricity');
 await expect(page.getByText('1 matching question.')).toBeVisible();
 await page.getByRole('button',{name:'Browse Grade 11 Physical Sciences · demonstration'}).click();
 await expect(page.getByLabel('Select Investigating a circuit')).toBeVisible();
 await page.getByLabel('Select Investigating a circuit').check();
 await expect(page.getByRole('complementary').getByText('Investigating a circuit')).toBeVisible();
});
