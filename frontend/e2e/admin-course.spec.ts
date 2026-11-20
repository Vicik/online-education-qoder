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

  // 创建草稿视频课（默认类型即视频）
  await pageA.goto('/admin/courses/create');
  await expect(pageA.getByLabel('课程名称')).toBeVisible();
  await pageA.getByLabel('课程名称').fill(courseName);
  // InputNumber 的可访问名是占位符，而非 Form.Item 标签
  await pageA.getByPlaceholder('原价（元）').fill('100');
  await pageA.getByPlaceholder('售价（元）').fill('90');
  await pageA.getByLabel('讲师').fill('E2E 讲师');
  // 封面必填：上传 1x1 PNG，等待上传完成后再提交
  await pageA.locator('.ant-upload input[type="file"]').setInputFiles({
    name: 'cover.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ),
  });
  await expect(pageA.getByRole('button', { name: '更换封面图片' })).toBeVisible();
  await pageA.getByRole('button', { name: '保存并维护章节' }).click();
  await pageA.getByRole('button', { name: '保存', exact: true }).click();
  await pageA.waitForURL(/\/admin\/courses\/\d+(\?.*)?$/);

  // 课程 id（URL 带 ?step=chapters，按 pathname 解析）
  const courseId = Number(new URL(pageA.url()).pathname.split('/').pop());
  expect(courseId).toBeGreaterThan(0);

  // 新增章节：正文必填，用 MediaRecorder 现场生成可解码 WebM 后上传
  await pageA.getByRole('button', { name: '新增章节' }).click();
  await pageA.getByLabel('章节标题').fill('E2E 第一章');
  // 勾选免费试看，保存后应展示「试看」标记
  await pageA.getByRole('switch', { name: '免费试看' }).click();
  // 浏览器内录制 0.8 秒画布视频，避免仓库内放置二进制媒体
  const webmBase64 = await pageA.evaluate(async () => {
    // 单次录制：手动推帧，返回 WebM Blob
    async function recordOnce(): Promise<Blob> {
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 90;
      // Edge 需要画布在文档内并被实际合成，否则 MediaRecorder 不会产生画面帧
      canvas.style.position = 'fixed';
      canvas.style.top = '0';
      canvas.style.left = '0';
      canvas.style.width = '2px';
      canvas.style.height = '2px';
      canvas.style.pointerEvents = 'none';
      document.body.appendChild(canvas);
      const ctx = canvas.getContext('2d');
      // 手动推帧：captureStream(0) 仅在 requestFrame 时产帧，避免依赖合成器节流
      const stream = canvas.captureStream(0);
      const track = stream.getVideoTracks()[0] as MediaStreamTrack & {
        requestFrame?: () => void;
      };
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      const stopped = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
      });
      // 用 requestFrame 手动推帧时不能带分片间隔，Edge 下分片模式会返回空数据
      recorder.start();
      const timer = setInterval(() => {
        ctx?.fillRect(0, 0, 160, 90);
        track.requestFrame?.();
      }, 100);
      await new Promise((r) => setTimeout(r, 800));
      clearInterval(timer);
      recorder.stop();
      await stopped;
      canvas.remove();
      return new Blob(chunks, { type: 'video/webm' });
    }
    // 首次录制在部分 Edge 环境只产空壳，重试直到拿到可上传的数据
    let blob = await recordOnce();
    for (let attempt = 0; attempt < 2 && blob.size < 200; attempt += 1) {
      blob = await recordOnce();
    }
    if (blob.size < 200) throw new Error('浏览器录制视频失败');
    const buffer = await blob.arrayBuffer();
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
  });
  await pageA.locator('.ant-modal input[type="file"]').setInputFiles({
    name: 'chapter.webm',
    mimeType: 'video/webm',
    buffer: Buffer.from(webmBase64, 'base64'),
  });
  await expect(pageA.getByRole('button', { name: '更换视频' })).toBeVisible();
  await pageA.getByRole('button', { name: '确定' }).click();
  await expect(pageA.getByText('E2E 第一章')).toBeVisible();
  await expect(pageA.getByText('试看', { exact: true })).toBeVisible();

  // 编辑回填：免费试看开关保持选中
  await pageA.getByRole('button', { name: '编辑' }).first().click();
  await expect(pageA.getByRole('switch', { name: '免费试看' })).toBeChecked();
  await pageA.getByRole('button', { name: '取消' }).click();

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

  // 发布并确认状态：页头状态标签已移除，以「下架」按钮出现作为已发布标志
  await pageB.getByRole('button', { name: '发布' }).click();
  await pageB.getByRole('button', { name: '确定' }).click();
  await expect(pageB.getByRole('button', { name: '下架' })).toBeVisible();

  await context.close();
});
