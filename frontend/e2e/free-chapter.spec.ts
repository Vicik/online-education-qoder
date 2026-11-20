import { expect, test } from '@playwright/test';

test('游客可试看第一章，点击付费章节得到登录引导', async ({ page }) => {
  await page.goto('/courses/1');

  await expect(page.getByRole('button', { name: '立即购买' })).toBeVisible();
  await page.getByRole('tab', { name: '章节目录' }).click();

  // 种子第一章免费试看，第二章锁定
  await expect(page.getByText('试看')).toBeVisible();
  await expect(page.getByText('购买后学习')).toBeVisible();

  await page.getByText(/第一章 类型基础/).click();
  await expect(page).toHaveURL(/\/learning\/1\?chapterId=\d+$/);
  await expect(page.getByText('正在学习：第一章 类型基础')).toBeVisible();
  await expect(page).not.toHaveURL(/\/login/);

  // 章节目录点击第二章：展示登录引导且不跳转
  await page.getByRole('tab', { name: '章节目录' }).click();
  await page.getByText(/第二章 泛型进阶/).click();
  await expect(page.getByText('登录后可学习')).toBeVisible();
  await expect(page.getByRole('button', { name: '去登录' })).toBeVisible();
});
