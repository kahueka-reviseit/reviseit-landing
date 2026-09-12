import { test, expect } from './fixtures';

test('login introduces school email and verification, with registration and recovery links', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name:'Log in', exact:true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', {name:'Welcome back'})).toBeVisible();
  await expect(page.getByText('Create your account using your school email address.',{exact:false})).toBeVisible();
  await expect(page.getByRole('link',{name:'Forgot your password?'})).toBeVisible();
  await page.getByRole('link',{name:'Create an account',exact:true}).click();
  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByLabel('School email address')).toBeVisible();
  await expect(page.getByLabel('School name',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Department',{exact:true})).toBeVisible();
});
test('registration rejects personal email on the server without contacting an identity provider', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Your full name').fill('Synthetic Teacher');
  await page.getByLabel('School name',{exact:true}).fill('Synthetic School');
  await page.getByLabel('Department',{exact:true}).fill('Physical Sciences');
  await page.getByLabel('School email address').fill('synthetic@gmail.com');
  await page.getByLabel('Password',{exact:true}).fill('Synthetic-password-123');
  await page.getByRole('button',{name:'Create account',exact:true}).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Use your school-issued email address');
});
test('protected pages cannot be opened without a connected authenticated account', async ({ page, request }) => {
  for (const path of ['/teacher','/admin/accounts','/account','/reset-password']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
  }
  const response=await request.get('/api/teacher/session');
  expect([401,503]).toContain(response.status());
  expect(response.headers()['cache-control']).toContain('no-store');
});
test('confirmation links are not consumed by opening a page, and invalid links show recovery navigation', async ({ page }) => {
  await page.goto('/auth/confirm?token_hash=synthetic-token&type=signup');
  await expect(page.getByRole('button',{name:'Continue',exact:true})).toBeVisible();
  await page.goto('/auth/confirm?type=unexpected');
  await expect(page.getByText('This confirmation link is incomplete.',{exact:false})).toBeVisible();
  await expect(page.getByRole('link',{name:'Back to log in'})).toBeVisible();
});
