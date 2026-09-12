import { test, expect } from './fixtures';

test('home page loads and its catalogue link reaches the selection control', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('A Complete Package.');
  await page.getByRole('link', { name: 'View the Catalogue' }).click();
  await expect(page).toHaveURL(/#catalogue$/);
  await expect(page.getByRole('combobox', { name: 'Select a curriculum' })).toBeInViewport();
});

test('available catalogue selection loads its preview; unavailable grades stay disabled', async ({ page }) => {
  await page.goto('/#catalogue');
  const select = page.getByRole('combobox', { name: 'Select a curriculum' });
  await expect(page.locator('#catalogue iframe')).toHaveCount(0);
  await expect(select.getByRole('option', { name: /Grade 12.*Coming Soon/ })).toBeDisabled();
  await select.selectOption('caps-gr11-phys-sci');

  const preview = page.getByRole('img', { name: /Preview of the Grade 11 Physical Sciences/ });
  await expect(preview).toBeVisible();
  await expect(preview).toHaveJSProperty('complete', true);
  await expect.poll(() => preview.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByTitle(/Get the Grade 11 Physical Sciences/)).toHaveCount(1);
});

test('pilot page navigation and comparison controls work after hydration', async ({ page }) => {
  await page.goto('/');
  await page.locator('footer').getByRole('link', { name: /Pilot Programme/ }).click();
  await expect(page).toHaveURL('/pilot');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('three schools');
  await page.getByRole('button', { name: 'With Revise It' }).click();
  await expect(page.getByText(/A comprehensive teacher memo/)).toBeVisible();
  await expect(page.getByText(/Teachers either build papers from scratch/)).toHaveCount(0);
  await page.getByRole('button', { name: 'How departments do it today' }).click();
  await expect(page.getByText(/Teachers either build papers from scratch/)).toBeVisible();
});

test('privacy policy is reachable and its home link returns to the site', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Privacy Policy', exact: true }).click();
  await expect(page).toHaveURL('/privacy-policy');
  await expect(page.getByRole('heading', { name: 'Privacy Policy', exact: true })).toBeVisible();
  await expect(page.locator('article')).toContainText('Who we are');
  await page.getByRole('link', { name: /Back to home/ }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
