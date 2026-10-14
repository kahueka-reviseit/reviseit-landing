import {test,expect} from '@playwright/test';
for(const [view,title] of [['sources','Source library'],['source','Synthetic Grade 10 paper · March 2099'],['queue','Work queue'],['run','Analysis progress'],['inventory','Review the paper inventory'],['execution','Execution history'],['library','Question library'],['item','Synthetic charge calculation'],['file','PHYS_01_Synthetic.md'],['releases','Catalogue releases']]) {
 test(`${view} renders without browser errors or page overflow`,async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`/?screen=${view}`);await expect(page.getByRole('heading',{name:title,exact:true,level:1})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
  await page.screenshot({path:`studio-test-results/${test.info().project.name}-${view}.png`,fullPage:true});
 });
}
test('connected source to inventory and execution journey',async({page})=>{
 await page.goto('/');await page.getByRole('link',{name:'Open source',exact:true}).click();await page.getByRole('link',{name:/Open run/}).click();await page.getByRole('link',{name:'Review →',exact:true}).click();await expect(page.getByRole('heading',{name:'Review the paper inventory'})).toBeVisible();await page.getByRole('link',{name:'Open execution history →'}).click();await expect(page.getByRole('heading',{name:'Execution history'})).toBeVisible();
});
test('library connects item questions, bank source files and release records',async({page})=>{
 await page.goto('/?screen=library');await page.getByRole('link',{name:'Synthetic charge calculation',exact:true}).click();await page.getByRole('button',{name:'Teacher questions',exact:true}).click();await expect(page.getByRole('heading',{name:'Which charge should learners find?',exact:true})).toBeVisible();
 await page.getByRole('link',{name:'Release records →'}).click();await expect(page.getByRole('heading',{name:'Catalogue releases'})).toBeVisible();await expect(page.getByText('Historical',{exact:true})).toBeVisible();
 await page.goto('/?screen=library');await page.getByRole('button',{name:'Browse files',exact:true}).click();await page.getByRole('link',{name:'data/task-types/physics/PHYS_01_Synthetic.md',exact:true}).click();await expect(page.getByRole('heading',{name:'Source document',exact:true})).toBeVisible();
});
test('review controls retain uncertainty and never silently approve',async({page})=>{
 await page.goto('/?screen=inventory');await page.getByRole('button',{name:'Needs attention · 2'}).click();await expect(page.getByRole('heading',{name:'Review part 1.2'})).toBeVisible();
 await page.getByText('Correct Bloom’s level',{exact:true}).click();await expect(page.getByLabel('Bloom’s level for 1.2')).toHaveValue('Apply');await expect(page.getByLabel('Bloom’s level for 1.2').locator('option')).toHaveText(['Unresolved','Remember','Understand','Apply','Analyse','Evaluate','Create']);
 await page.getByLabel('Bloom’s level for 1.2').selectOption('Analyse');await page.getByLabel('Reason for Bloom’s classification of 1.2').fill('Synthetic reviewer reason.');await page.getByRole('button',{name:'Save Bloom’s correction'}).click();await expect(page.getByRole('alert')).toHaveText('Preview only: no correction was saved.');
 const decision=page.getByRole('button',{name:'Record inventory decision'});await expect(decision).toBeDisabled();await page.getByRole('combobox',{name:'Decision',exact:true}).selectOption('approved');await page.getByLabel('Review rationale').fill('Synthetic evidence reviewed.');await expect(decision).toBeDisabled();await page.getByRole('checkbox').check();await expect(decision).toBeEnabled();
 await page.getByRole('button',{name:'Next',exact:true}).click();await expect(page.getByRole('heading',{name:'Review part 2.1'})).toBeVisible();
});
