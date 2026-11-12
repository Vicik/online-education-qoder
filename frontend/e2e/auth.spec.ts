import { expect, test } from '@playwright/test';
import { DEMO_ADMIN, DEMO_USER } from './helpers/accounts';
import { loginAsAdmin, loginAsUser } from './helpers/auth';

test('游客访问受保护路由，登录后回跳原页面', async ({ page }) => {
  await page.goto('/checkout/1');
  await expect(page).toHaveURL(/\/login\?redirect=%2Fcheckout%2F1$/);

  await page.getByLabel('邮箱').fill(DEMO_USER.email);
  await page.getByLabel('密码').fill(DEMO_USER.password);
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/checkout\/1$/);
  await expect(page.getByText('产品信息')).toBeVisible();
});

test('管理员仅凭邮箱密码登录并刷新保持会话', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('邮箱').fill(DEMO_ADMIN.email);
  await page.getByLabel('密码').fill(DEMO_ADMIN.password);
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: '工作台' })).toBeVisible();
});

test('管理员访问用户端统一重定向 /admin', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/courses');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/user');
  await expect(page).toHaveURL(/\/admin$/);
});

test('普通用户访问管理端跳 403，可返回', async ({ page }) => {
  await loginAsUser(page);
  await page.goto('/admin/courses');
  await expect(page).toHaveURL(/\/403$/);
  await expect(page.getByText('无权访问')).toBeVisible();
  await page.getByRole('button', { name: '返回首页' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('普通用户刷新后会话保持', async ({ page }) => {
  await loginAsUser(page);
  await page.reload();
  // 已登录头像按钮的可访问名来自昵称
  await expect(page.getByRole('button', { name: '学员小明的账户菜单' })).toBeVisible();
});
