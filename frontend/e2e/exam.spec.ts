import { expect, test } from '@playwright/test';
import { loginAsAdmin, loginWith, registerUniqueUser } from './helpers/auth';
import { uniqueSuffix } from './helpers/unique';

test('管理员组卷发布，学员作答后看到成绩与解析', async ({ browser }) => {
  // 本次唯一后缀：题目/考试名称与重跑隔离
  const suffix = uniqueSuffix();
  // 第一道单选题干
  const stemFirst = `E2E 单选题 ${suffix}`;
  // 第二道单选题干
  const stemSecond = `E2E 单选题二 ${suffix}`;

  // 管理端上下文
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await loginAsAdmin(adminPage);

  // 创建两道答案固定为 A 的单选题
  for (const stem of [stemFirst, stemSecond]) {
    await adminPage.goto('/admin/questions/create');
    await adminPage.getByLabel('题干').fill(stem);
    await adminPage.getByPlaceholder('选项 A').fill('正确选项');
    await adminPage.getByPlaceholder('选项 B').fill('错误选项');
    await adminPage.getByRole('radio', { name: 'A. 正确选项' }).check();
    await adminPage.getByLabel('分值').fill('5');
    // 答案解析为必填，交卷后向考生展示
    await adminPage.getByLabel('答案解析').fill('E2E 解析');
    await adminPage.getByRole('button', { name: '创建题目' }).click();
    await adminPage.getByRole('button', { name: '确认创建' }).click();
    await adminPage.waitForURL('**/admin/questions');
  }

  // 组卷：两道题，总分 10，及格 6
  const examName = `E2E 考试 ${suffix}`;
  await adminPage.goto('/admin/exams/create');
  await adminPage.getByLabel('考试名称').fill(examName);
  await adminPage.getByLabel('考试说明').fill('E2E 自动组卷');
  await adminPage.getByLabel('考试时长（分钟）').fill('30');
  // 搜索题干后勾选，避免长列表滚动定位
  const questionSearch = adminPage.getByPlaceholder('搜索题干');
  await questionSearch.fill(stemFirst);
  await adminPage.getByRole('checkbox', { name: stemFirst }).check();
  await questionSearch.fill(stemSecond);
  await adminPage.getByRole('checkbox', { name: stemSecond }).check();
  await adminPage.getByLabel('及格分').fill('6');
  await adminPage.getByRole('button', { name: '创建考试' }).click();
  await adminPage.getByRole('button', { name: '确认创建' }).click();
  await adminPage.waitForURL('**/admin/exams');

  // 从「编辑」链接提取考试 id
  const examRow = adminPage.locator('tr', { hasText: examName });
  const editHref = await examRow.getByRole('link', { name: '编辑' }).getAttribute('href');
  const examId = Number(editHref?.split('/').pop());
  expect(examId).toBeGreaterThan(0);

  // 发布后用户端可见
  await examRow.getByRole('button', { name: '发布' }).click();
  await adminPage.getByRole('button', { name: '确认发布' }).click();
  await expect(examRow.getByText('已发布')).toBeVisible();
  await adminContext.close();

  // 新注册学员上下文，避免历史 attempt 直接返回成绩
  const userContext = await browser.newContext();
  const userPage = await userContext.newPage();
  const account = await registerUniqueUser(userPage);
  await loginWith(userPage, account);

  await userPage.goto(`/exams/${examId}`);
  await userPage.getByRole('button', { name: '开始考试' }).click();
  await userPage.getByRole('button', { name: '确定' }).click();
  await expect(userPage.getByText(stemFirst)).toBeVisible();

  // 两题都选 A
  const correctOptions = userPage.getByRole('radio', { name: 'A 正确选项' });
  await correctOptions.nth(0).check();
  await correctOptions.nth(1).check();

  await userPage.getByRole('button', { name: '交卷' }).click();
  await userPage.getByRole('button', { name: '确定' }).click();

  await expect(userPage.getByText('10 / 10')).toBeVisible();
  await expect(userPage.getByText(/解析：/).first()).toBeVisible();
  await userContext.close();
});
