import { test as base, expect } from '@playwright/test';

export const test = base.extend<{ localOnly: void; noPageErrors: void }>({
  localOnly: [async ({ context, baseURL }, use) => {
    if (!baseURL) throw new Error('A local baseURL is required');
    const origin = new URL(baseURL).origin;
    await context.route('**/*', async (route) => {
      if (new URL(route.request().url()).origin === origin) {
        await route.continue();
      } else {
        // Never submit real enquiry forms, load trackers or depend on third parties.
        await route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
      }
    });
    await use();
  }, { auto: true }],
  noPageErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await use();
    expect(errors, 'Browser JavaScript errors').toEqual([]);
  }, { auto: true }],
});

export { expect };
