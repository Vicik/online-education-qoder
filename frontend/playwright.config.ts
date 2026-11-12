import { defineConfig, devices } from '@playwright/test';

// 目标前端：本地 dev 或 CI 启动的 Vite
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173';
// 本地无法下载 Playwright 浏览器时，可指定已安装的 Chrome/Edge 通道；CI 保持默认 Chromium
const browserChannel = process.env.E2E_CHANNEL as 'chrome' | 'msedge' | undefined;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // 共享同一后端数据库，串行避免数据互相污染
  fullyParallel: false,
  workers: 1,
  // CI 失败重试一次，本地不重试
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // 本地 Chrome 通道无 ffmpeg，跳过视频录制；CI 的 Chromium 自带 ffmpeg
    video: browserChannel ? 'off' : 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], ...(browserChannel ? { channel: browserChannel } : {}) },
    },
  ],
});
