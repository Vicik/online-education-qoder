import type { Page } from '@playwright/test';
import { DEMO_ADMIN, DEMO_USER } from './accounts';

// AntD 会为两字按钮插入空格（「登 录」），用正则匹配
const LOGIN_BUTTON = /登\s*录/;
// 注册按钮同理
const REGISTER_BUTTON = /注\s*册/;

// 普通用户登录：默认落到 /user
export async function loginAsUser(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('邮箱').fill(DEMO_USER.email);
  await page.getByLabel('密码').fill(DEMO_USER.password);
  await page.getByRole('button', { name: LOGIN_BUTTON }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

// 管理员登录：与普通用户共用登录页，仅邮箱与密码
export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('邮箱').fill(DEMO_ADMIN.email);
  await page.getByLabel('密码').fill(DEMO_ADMIN.password);
  await page.getByRole('button', { name: LOGIN_BUTTON }).click();
  await page.waitForURL('**/admin');
}

// 注册唯一用户并停在登录页（注册成功不自动登录）
export async function registerUniqueUser(
  page: Page,
): Promise<{ email: string; password: string }> {
  // 本次运行的唯一邮箱
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  // 固定演示密码
  const password = 'abc12345';

  await page.goto('/register');
  await page.getByLabel('邮箱').fill(email);
  // 「密码」会子串匹配到「确认密码」，注册页需精确匹配
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByLabel('确认密码').fill(password);
  await page.getByLabel('昵称').fill('E2E 学员');
  await page.getByRole('button', { name: REGISTER_BUTTON }).click();
  await page.waitForURL('**/login?registered=1');
  return { email, password };
}

// 用唯一账号登录
export async function loginWith(
  page: Page,
  account: { email: string; password: string },
): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('邮箱').fill(account.email);
  await page.getByLabel('密码').fill(account.password);
  await page.getByRole('button', { name: LOGIN_BUTTON }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}
