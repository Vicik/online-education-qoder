import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import { uniqueSuffix } from './helpers/unique';

test('创建课程、双标签保存触发 409，刷新后可发布', async ({ browser }) => {
  // 共享登录 Cookie 的上下文
  const context = await browser.newContext();
  const pageA = await context.newPage();
  await loginAsAdmin(pageA);

  // 本次唯一课程名
  const courseName = `E2E 课程 ${uniqueSuffix()}`;

  // 创建草稿：图文课避免视频 key
  await pageA.goto('/admin/courses/create');
  await expect(pageA.getByLabel('课程名称')).toBeVisible();
  await pageA.getByLabel('课程名称').fill(courseName);
  // 点击 Select 当前选中项打开下拉；AntD v5 的可见选项无 option 角色，按文本点击
  await pageA.getByText('视频', { exact: true }).click();
  await pageA.getByText('图文', { exact: true }).click();
  // InputNumber 的可访问名是占位符，而非 Form.Item 标签
  await pageA.getByPlaceholder('原价（元）').fill('100');
  await pageA.getByPlaceholder('售价（元）').fill('90');
  await pageA.getByLabel('讲师').fill('E2E 讲师');
  await pageA.getByRole('button', { name: '保存并维护章节' }).click();
  await pageA.getByRole('button', { name: '保存', exact: true }).click();
  await pageA.waitForURL(/\/admin\/courses\/\d+(\?.*)?$/);

  // 课程 id（URL 带 ?step=chapters，按 pathname 解析）
  const courseId = Number(new URL(pageA.url()).pathname.split('/').pop());
  expect(courseId).toBeGreaterThan(0);

  // 新增章节，满足完整工作区路径
  await pageA.getByRole('button', { name: '新增章节' }).click();
  await pageA.getByLabel('章节标题').fill('E2E 第一章');
  await pageA.getByRole('button', { name: '确定' }).click();
  await expect(pageA.getByText('E2E 第一章')).toBeVisible();

  // 回到基本信息步骤
  await pageA.getByText('基本信息', { exact: true }).click();
  await expect(pageA.getByLabel('课程名称')).toBeVisible();

  // 第二个标签打开同一课程，持有旧 version
  const pageB = await context.newPage();
  await pageB.goto(`/admin/courses/${courseId}`);
  await expect(pageB.getByLabel('课程名称')).toHaveValue(courseName);

  // A 先保存
  await pageA.getByLabel('课程名称').fill(`${courseName}-A`);
  await pageA.getByRole('button', { name: '保存基本信息' }).click();
  await pageA.getByRole('button', { name: '保存', exact: true }).click();
  await expect(pageA.getByText('基本信息已保存')).toBeVisible();

  // B 用旧 version 保存 → 409，不自动覆盖
  await pageB.getByLabel('课程名称').fill(`${courseName}-B`);
  await pageB.getByRole('button', { name: '保存基本信息' }).click();
  await pageB.getByRole('button', { name: '保存', exact: true }).click();
  await expect(
    pageB.getByText('内容已在其他页面被修改，请刷新后重试'),
  ).toBeVisible();

  // 刷新后拿到 A 的名称
  await pageB.getByRole('button', { name: '刷新' }).click();
  await expect(pageB.getByLabel('课程名称')).toHaveValue(`${courseName}-A`);

  // 发布并确认状态
  await pageB.getByRole('button', { name: '发布' }).click();
  await pageB.getByRole('button', { name: '确定' }).click();
  await expect(pageB.getByText('已发布', { exact: true })).toBeVisible();

  await context.close();
});
