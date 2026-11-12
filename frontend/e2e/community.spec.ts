import { expect, test } from '@playwright/test';
import { loginAsUser } from './helpers/auth';
import { uniqueSuffix } from './helpers/unique';

test('发帖、评论、回复并删除帖子', async ({ page }) => {
  await loginAsUser(page);
  // 本次唯一正文，避免历史帖子干扰断言
  const content = `E2E 学习心得 ${uniqueSuffix()}`;

  await page.goto('/community/new');
  await page.locator('.ProseMirror').fill(content);
  await page.getByRole('button', { name: '发布' }).click();

  await expect(page).toHaveURL(/\/community\/\d+$/);
  await expect(page.getByText(content)).toBeVisible();

  // 一级评论
  await page.getByPlaceholder('写下你的评论').fill('E2E 评论');
  await page.getByRole('button', { name: '发表评论' }).click();
  await expect(page.getByText('E2E 评论')).toBeVisible();

  // 回复一级评论：第二个「发表评论」按钮属于回复表单
  await page.getByRole('button', { name: /^回\s*复$/ }).first().click();
  await page.getByPlaceholder(/回复 @/).fill('E2E 回复');
  await page.getByRole('button', { name: '发表评论' }).last().click();
  await expect(page.getByText('回复 @学员小明')).toBeVisible();
  await expect(page.getByText('E2E 回复')).toBeVisible();

  // 删除帖子（级联删除评论与回复）
  await page.getByRole('button', { name: '删除帖子' }).click();
  await page.getByRole('button', { name: '确定' }).click();
  await expect(page).toHaveURL(/\/community$/);
  await expect(page.getByText(content)).toHaveCount(0);
});
