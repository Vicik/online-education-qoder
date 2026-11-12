import { expect, test } from '@playwright/test';
import { loginWith, registerUniqueUser } from './helpers/auth';

test('新用户购买课程、完成支付并进入学习页', async ({ page }) => {
  // 本次唯一账号，避免已购买导致重跑失败
  const account = await registerUniqueUser(page);
  await loginWith(page, account);

  await page.goto('/courses/1');
  await expect(page.getByText('TypeScript 系统入门')).toBeVisible();
  await page.getByRole('button', { name: '立即购买' }).click();

  await expect(page).toHaveURL(/\/checkout\/1$/);
  await expect(page.getByText('产品信息')).toBeVisible();
  await expect(page.getByText('¥99.00').first()).toBeVisible();

  // 结算页直接创建订单并进入支付页；模拟支付完成后自动跳结果页
  await page.getByRole('button', { name: '确认支付' }).click();

  await expect(page).toHaveURL(/\/order\/\d+\/result$/);
  await expect(page.getByText('支付成功')).toBeVisible();

  await page.getByRole('link', { name: '去学习' }).click();
  await expect(page).toHaveURL(/\/learning\/1$/);
  await expect(page.getByText('第一章 类型基础').first()).toBeVisible();
});
