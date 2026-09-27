import {test,expect,type Page} from '@playwright/test';
// Runs against the isolated synthetic preview (npm run preview:workspace), never the hosted pilot.
const noSideScroll=async(page:Page)=>expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
test.beforeEach(async({page})=>{await page.goto('/');await page.evaluate(()=>localStorage.clear());await page.reload();});

test('diagrams load, cards show computed metadata and the paper bar stays usable',async({page},info)=>{
 const image=page.getByRole('img',{name:'A block with horizontal and upward force arrows'}).first();
 await image.scrollIntoViewIfNeeded();await expect.poll(()=>image.evaluate((e:HTMLImageElement)=>e.naturalWidth)).toBeGreaterThan(0);
 const card=page.getByRole('article',{name:'Block on a rough slope'});
 await expect(card.getByText('12–18')).toBeVisible();await expect(card.getByText('Remember to Analyse')).toBeVisible();
 await card.getByLabel('Select Block on a rough slope').check();
 await expect(card.getByText('Added')).toBeVisible();
 const bar=page.getByRole('complementary',{name:'Your paper'});
 await expect(bar.getByText('1 · 12–18 marks')).toBeVisible();
 await expect(page.getByRole('article',{name:'Two connected trolleys'}).getByLabel('Select Two connected trolleys')).toBeDisabled();
 await noSideScroll(page);
 await page.screenshot({path:`workspace-test-results/catalogue-${info.project.name}.png`});
});

test('filters by keyboard: counts before ticking, Escape returns focus, selection survives clearing',async({page})=>{
 await page.getByLabel('Select Block on a rough slope').check();
 const topic=page.getByRole('button',{name:'Topic',exact:true});await topic.focus();await page.keyboard.press('Enter');
 const menu=page.getByRole('group',{name:'Topic filter'});
 // Opening the menu moves focus to its first option.
 await expect(menu.getByRole('checkbox',{name:/Vectors and mechanics/})).toBeFocused();
 await expect(menu.locator('label',{hasText:'Electric circuits'})).toContainText('4');
 await menu.getByRole('checkbox',{name:/Electric circuits/}).check();
 await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:/^Topic/})).toBeFocused();
 await expect(page.getByText('4 of 40 questions match')).toBeVisible();
 await expect(page.getByLabel('Select Block on a rough slope')).toHaveCount(0);
 await expect(page.getByText(/1 selected question is outside/)).toBeVisible();
 await page.getByRole('button',{name:'Clear all'}).click();await expect(page.getByLabel('Select Block on a rough slope')).toBeChecked();
 await noSideScroll(page);
});

test('type to search suggests topics and questions; the detail view opens, focuses and returns',async({page},info)=>{
 const box=page.getByRole('combobox',{name:'Search this catalogue'});await box.fill('circuit');
 await expect(page.getByRole('listbox')).toBeVisible();await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');
 await page.keyboard.press('Enter');
 const heading=page.getByRole('heading',{level:1});await expect(heading).toBeFocused();
 await page.getByRole('button',{name:'Add to your paper'}).click();await expect(page.getByText(/In your paper/)).toBeVisible();
 await page.screenshot({path:`workspace-test-results/detail-${info.project.name}.png`,fullPage:true});
 await page.getByRole('button',{name:/Back to results|Back to catalogue/}).click();
 await expect(page.getByRole('heading',{name:'Results for “circuit”'})).toBeVisible();
 await page.goBack();await expect(page.getByRole('heading',{level:1})).toBeVisible();
 await noSideScroll(page);
});

test('curriculum search offers a switch into the matching paper',async({page})=>{
 await page.getByRole('combobox',{name:'Search this catalogue'}).fill('grade 10 demonstration');
 const browse=page.getByRole('button',{name:'Browse Grade 10 Physical Sciences'});await expect(browse).toBeVisible();await browse.click();
 await expect(page.getByRole('heading',{name:'Grade 10 Physical Sciences catalogue'})).toBeVisible();
});

test('builder: repeated multiple choice, reorder within a section, marks and review',async({page},info)=>{
 for(const t of ['Choosing the correct force diagram','Mass compared with weight','Block on a rough slope','Series and parallel resistors']) await page.getByLabel(`Select ${t}`).check();
 await page.getByRole('button',{name:/Open paper builder/}).click();
 await page.getByRole('button',{name:'Arrange'}).click();
 await page.getByRole('button',{name:'Add another Choosing the correct force diagram'}).click();
 await page.getByRole('button',{name:'Move Choosing the correct force diagram occurrence 2 later'}).click();
 // Numbering, not screen position: the column header row is hidden on phones.
 const table=page.getByRole('table',{name:'Multiple-choice order'});
 await expect(table.getByRole('row').filter({hasText:'occurrence 2'})).toContainText('1.3');
 await expect(table.getByRole('row').filter({hasText:'Mass compared with weight'})).toContainText('1.2');
 await page.getByRole('button',{name:'Back to paper builder'}).first().click();
 await page.getByRole('button',{name:'Move Series and parallel resistors earlier'}).click();
 await expect(page.getByRole('table',{name:'Structured questions'}).getByRole('row').filter({hasText:'Series and parallel resistors'})).toContainText(/^2/);
 await page.getByLabel('Total marks for this paper').fill('40');
 await page.getByLabel('Series and parallel resistors: marks (16–27)').fill('20');
 await page.getByLabel('Block on a rough slope: marks (12–18)').fill('14');
 await expect(page.getByRole('status').getByText('Ready for payment')).toBeVisible();
 await noSideScroll(page);
 await page.screenshot({path:`workspace-test-results/builder-${info.project.name}.png`,fullPage:true});
 await page.getByRole('button',{name:/Review and pay/}).click();
 await expect(page.getByRole('heading',{name:'Review and pay'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Pay with Stripe · R100'})).toBeEnabled();
 await noSideScroll(page);
 await page.getByRole('button',{name:'Pay with Stripe · R100'}).click();
 await expect(page).toHaveURL(/configurator\.html\?paid=0/);
});

test('payment confirmation unlocks details; a stale tab keeps its unsaved edit',async({page},info)=>{
 await page.goto('/configurator.html?paid=0');
 await expect(page.getByRole('heading',{name:'Your paper is waiting for payment'})).toBeVisible();
 await expect(page.getByRole('group',{name:'Synthetic setting'})).toHaveCount(0);
 await page.getByRole('button',{name:'I have paid: check again'}).click();
 await expect(page.getByRole('heading',{name:'Finish your paper'})).toBeVisible();
 await page.getByRole('button',{name:/^Q2 ·/}).click();
 const setting=page.getByRole('group',{name:'Synthetic setting'});await setting.getByLabel('Setting two').focus();await page.keyboard.press('Space');
 await expect(setting.getByLabel('Setting two')).toBeChecked();
 await expect(page.getByText('All changes saved')).toBeVisible({timeout:5000});
 await page.evaluate(()=>(window as unknown as {simulateOtherTab:()=>void}).simulateOtherTab());
 await page.getByRole('button',{name:'One mark more for question 2'}).click();
 await expect(page.getByText('Not saved: this paper changed elsewhere')).toBeVisible({timeout:5000});
 await expect(page.getByLabel('Marks for question 2')).toHaveValue('15');
 await noSideScroll(page);
 await page.screenshot({path:`workspace-test-results/configure-${info.project.name}.png`,fullPage:true});
});

// C05A R3: the pilot's real catalogue shape (89 entries, 81 topic labels, 73 used once).
test('a dense catalogue keeps the overview bounded and cards flowing compactly',async({page},info)=>{
 await page.goto('/?data=dense');await page.evaluate(()=>localStorage.clear());await page.reload();await page.getByRole('article').first().waitFor();
 const m=await page.evaluate(()=>{const cards=[...document.querySelectorAll('article')];const rows=new Set(cards.map(c=>Math.round(c.getBoundingClientRect().top+scrollY)));
  return {tiles:[...document.querySelectorAll('section[aria-label="Catalogue overview"] li')].filter(li=>getComputedStyle(li).display!=='none').length,
   cards:cards.length,firstCardY:cards[0].getBoundingClientRect().top+scrollY,perRow:cards.length/rows.size};});
 expect(m.cards).toBe(89);
 const phone=info.project.name==='mobile';
 expect(m.tiles).toBe(phone?4:8);
 expect(m.firstCardY).toBeLessThan(phone?1400:1000);
 if(!phone) expect(m.perRow).toBeGreaterThan(3);
 await page.getByRole('button',{name:'Show all 81 topics'}).click();
 await expect(page.getByRole('button',{name:'Show the largest topics only'})).toHaveAttribute('aria-expanded','true');
 await noSideScroll(page);
 await page.screenshot({path:`workspace-test-results/dense-${info.project.name}.png`});
});
