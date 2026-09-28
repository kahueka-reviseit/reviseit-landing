import {test,expect} from '@playwright/test';
import paper from '../../design/paper/paragraph-styles.json';
test('paragraph first: explicit Configure, editable inferred choices and original words retained',async({page})=>{
 await page.goto('/configurator.html?brief=1');await page.getByRole('button',{name:/Q2 · Synthetic structured question/}).click();
 const text=page.getByLabel('Your brief',{exact:true});await text.fill('Use setting one and a blue shade.');
 const configure=page.getByRole('button',{name:'Configure →',exact:true});await expect(configure).toBeEnabled();
 await expect(page.getByRole('heading',{name:'What we understood'})).toHaveCount(0);
 await configure.click();await expect(page.getByRole('heading',{name:'What we understood'})).toBeVisible();
 await expect(text).toHaveValue('Use setting one and a blue shade.');
 const label=page.locator('[class*="interpretation__label"]').first();
 await expect(label).toHaveCSS('font-size',paper.styles['99M-0'].fontSize);await expect(label).toHaveCSS('line-height',paper.styles['99M-0'].lineHeight);
 const row=page.locator('[class*="interpretation__row"]').first();await expect(row).toHaveCSS('gap',paper.styles['99K-0'].gap);
 await expect(page.getByRole('heading',{name:'What we understood'})).toHaveCSS('font-size',paper.styles['99G-0'].fontSize);

 await expect(page.getByText('Setting one',{exact:true}).first()).toBeVisible();
 await page.getByRole('button',{name:'Change Synthetic shade'}).click();
 await page.getByRole('radio',{name:'Red',exact:true}).click();
 await expect(page.getByText('Your current choice takes precedence: Red')).toBeVisible();
 await expect(text).toHaveValue('Use setting one and a blue shade.');
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('provider unavailable: words remain and manual configuration remains usable',async({page})=>{
 await page.goto('/configurator.html?brief=1&briefFailure=1');await page.getByRole('button',{name:/Q2 · Synthetic structured question/}).click();
 await page.getByLabel('Your brief',{exact:true}).fill('Use blue.');
 const configure=page.getByRole('button',{name:'Configure →',exact:true});await expect(configure).toBeEnabled();await configure.click();
 await expect(page.getByRole('alert').filter({hasText:'Your brief is saved'})).toBeVisible();
 await page.getByRole('button',{name:'Keep my words and choose options myself →'}).click();
 await expect(page.getByRole('radio',{name:'Blue',exact:true})).toBeVisible();
 await expect(page.getByLabel('Your brief',{exact:true})).toHaveValue('Use blue.');
});
