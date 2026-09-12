import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
const url = process.env.SUPABASE_URL || '';
const key = process.env.AUTH_TEST_SERVICE_KEY || '';
const database = process.env.AUTH_TEST_DATABASE_URL || '';
// No skips: missing local infrastructure must be an explicit test failure.
let admin: SupabaseClient;
test.beforeAll(() => {
  if (![url,database].every(v => v && ['localhost','127.0.0.1'].includes(new URL(v).hostname)) || !key) throw new Error('Run npm run test:auth:integration with disposable local Supabase running.');
  admin = createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
});
const password = 'Synthetic-Test-Password-123!';
async function login(page: Page, email: string, pass = password) {
  await page.goto('/login');
  await page.locator('main form').first().getByLabel('School email address').fill(email);
  await page.getByLabel('Password',{exact:true}).fill(pass);
  await page.getByRole('button',{name:'Log in',exact:true}).click();
  await expect(page).toHaveURL(/\/account$/);
}

test('real signup, email confirmation, team approval, suspension and password recovery', async ({page,browser}) => {
  const suffix = Date.now();
  const email = `teacher-${suffix}@synthetic-school.example`;
  const reviewerEmail = `reviewer-${suffix}@reviseit.example`;
  const db = new Client({connectionString:database});
  await db.connect();
  const { data: reviewer, error: reviewerError } = await admin.auth.admin.createUser({email:reviewerEmail,password,email_confirm:true});
  expect(reviewerError).toBeNull();
  await db.query('insert into private.account_reviewers(user_id) values($1)',[reviewer.user!.id]);
  const reviewContext = await browser.newContext();
  const reviewPage = await reviewContext.newPage();
  try {
    await page.goto('/register');
    await page.getByLabel('Your full name').fill('Synthetic Teacher');
    await page.getByLabel('School name',{exact:true}).fill('Synthetic School');
    await page.getByLabel('Department',{exact:true}).fill('Physical Sciences');
    await page.getByLabel('School email address').fill(email);
    await page.getByLabel('Password',{exact:true}).fill(password);
    await page.getByRole('button',{name:'Create account',exact:true}).click();
    await expect(page.getByRole('status')).toContainText('Check your school email');
    await page.goto('/login');
    await page.locator('main form').first().getByLabel('School email address').fill(email);
    await page.getByLabel('Password',{exact:true}).fill(password);
    await page.getByRole('button',{name:'Log in',exact:true}).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('confirm your school email first');
    // Retrieve a local-only signup link through the admin test client; real hosted email delivery is a separate smoke check.
    const {data:confirmation,error:linkError} = await admin.auth.admin.generateLink({type:'signup',email,password});
    expect(linkError).toBeNull();
    await page.goto(`/auth/confirm?token_hash=${confirmation.properties!.hashed_token}&type=signup`);
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Your account is awaiting verification'})).toBeVisible();
    await page.goto('/teacher');
    await expect(page).toHaveURL(/\/account$/);
    expect((await page.request.get('/api/teacher/session')).status()).toBe(403);
    await login(reviewPage,reviewerEmail);
    await reviewPage.getByRole('link',{name:'Review school accounts'}).click();
    await reviewPage.getByText('Add a verified school department',{exact:true}).click();
    const schoolForm = reviewPage.locator('details form');
    await schoolForm.getByLabel('Full school name').fill('Synthetic School');
    await schoolForm.getByLabel('School identifier').fill('synthetic-school');
    await schoolForm.getByLabel('Department',{exact:true}).fill('Physical Sciences');
    await schoolForm.getByRole('button',{name:'Save school department'}).click();
    await expect(schoolForm.getByRole('status')).toContainText('available');
    const account = reviewPage.locator('article').filter({hasText:email});
    await account.getByRole('combobox',{name:/^Decision/}).selectOption('approved');
    await account.getByLabel('Verified school and department').selectOption({label:'Synthetic School · Physical Sciences'});
    await account.getByLabel('Verification evidence or reason').fill('Confirmed affiliation using synthetic test evidence.');
    await account.getByRole('button',{name:'Save verification decision'}).click();
    await expect(account.getByRole('status')).toContainText('Decision saved');
    await page.goto('/teacher');
    await expect(page.getByRole('heading',{name:'Welcome to your workspace'})).toBeVisible();
    expect((await page.request.get('/api/teacher/session')).status()).toBe(200);
    await account.getByRole('combobox',{name:/^Decision/}).selectOption('suspended');
    await account.getByLabel('Verification evidence or reason').fill('Synthetic suspension test.');
    await account.getByRole('button',{name:'Save verification decision'}).click();
    await expect(account.getByText('Status: suspended')).toBeVisible();
    expect((await page.request.get('/api/teacher/session')).status()).toBe(403);
    await page.goto('/teacher');
    await expect(page.getByRole('heading',{name:'Your account access is paused'})).toBeVisible();
    await page.getByRole('button',{name:'Log out',exact:true}).click();
    await expect(page).toHaveURL(/\/login$/);
    const {data:recovery,error:recoveryError} = await admin.auth.admin.generateLink({type:'recovery',email});
    expect(recoveryError).toBeNull();
    await page.goto(`/auth/confirm?token_hash=${recovery.properties!.hashed_token}&type=recovery`);
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Choose a new password'})).toBeVisible();
    await page.getByLabel('Password',{exact:true}).fill(`${password}new`);
    await page.getByLabel('Confirm password',{exact:true}).fill(`${password}new`);
    await page.getByRole('button',{name:'Save password'}).click();
    await expect(page).toHaveURL(/\/login\?message=password-updated$/);
    await login(page,email,`${password}new`);
    await expect(page.getByRole('heading',{name:'Your account access is paused'})).toBeVisible();
  } finally { await Promise.allSettled([reviewContext.close(), db.end()]); }
});
