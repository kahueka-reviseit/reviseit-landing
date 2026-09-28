import {test,expect} from '@playwright/test';
import paper from '../../design/paper/snapshot.json';

// These assertions compare rendered components to captured Paper declarations.
// They run only against the synthetic preview, with no account or order writes.
test('catalogue and navigation render Paper typography and card spacing',async({page},info)=>{
  await page.goto('/');
  const nav=page.getByRole('navigation',{name:'Account navigation'});
  await expect(nav.getByRole('link',{name:'Revise It'})).toHaveCSS('line-height',paper.styles['59Q-0'].lineHeight);
  if(info.project.name==='desktop'){
    await expect(nav).toHaveCSS('padding-left',paper.styles['59L-0'].paddingInline);
    await expect(nav).toHaveCSS('padding-top',paper.styles['59L-0'].paddingBlock);
  }
  const card=page.getByRole('article',{name:'Block on a rough slope'});
  await expect(card).toHaveCSS('padding',paper.styles['434-0'].padding);
  await expect(card).toHaveCSS('border-radius',paper.styles['434-0'].borderRadius);
  await expect(card.getByRole('button',{name:'Block on a rough slope'})).toHaveCSS('font-size',paper.styles['43W-0'].fontSize);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('paid choices use Paper labels and keep hints clear of their status',async({page},info)=>{
  await page.goto('/configurator.html');
  await page.getByRole('button',{name:'Edit question 2',exact:true}).click();
  const setting=page.getByRole('group',{name:'Synthetic setting'});
  const choice=setting.getByLabel('Setting two');
  await choice.check();
  await expect(choice.locator('..')).toHaveCSS('font-size',paper.styles['65M-0'].fontSize);
  await expect(choice.locator('..')).toHaveCSS('line-height',paper.styles['65M-0'].lineHeight);
  const note=page.getByRole('group',{name:'Anything else (optional)'});
  await expect(note.getByText('Optional. It can stay blank.')).toBeVisible();
  // Long authored help is permitted. Its first line must never share the status row.
  await note.getByText('Optional. It can stay blank.').evaluate(el=>{el.textContent='A long instruction that wraps onto several lines on a phone. '.repeat(8);});
  const status=await note.locator('legend [aria-hidden=true]').boundingBox();
  const hint=await note.locator('p').first().boundingBox();
  expect(status).not.toBeNull();expect(hint).not.toBeNull();
  expect(hint!.y).toBeGreaterThanOrEqual(status!.y+status!.height);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`workspace-test-results/paper-alignment-${info.project.name}.png`,fullPage:true});
});
