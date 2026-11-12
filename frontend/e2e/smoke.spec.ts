import { expect, test } from '@playwright/test';

test('首页可加载且主导航可见', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: '知序课堂' })).toBeVisible();
  await expect(
    page.getByRole('banner').getByRole('link', { name: '课程' }),
  ).toBeVisible();
});
