/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Vite 配置：路径别名、开发代理、Vitest 运行环境
export default defineConfig({
  plugins: [react()],
  resolve: {
    // 别名：@ 指向 src，避免深层相对路径
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // 开发代理：/api 转发到本地后端，规避 CORS 与 SameSite 会话问题
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true } },
  },
  test: {
    // 单元/组件测试使用 jsdom
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    css: true,
    coverage: { reporter: ['text', 'lcov'] },
  },
});
