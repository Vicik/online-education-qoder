/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 第三方依赖分包：把低频编辑器与 UI 库从入口拆开，避免首屏加载编辑器
function manualChunks(id: string): string | undefined {
  // 非依赖模块交给 Rollup 默认处理
  if (!id.includes('node_modules')) return undefined;
  // Tiptap / ProseMirror / 净化库只在编辑与展示富文本时加载
  if (id.includes('@tiptap') || id.includes('prosemirror') || id.includes('dompurify')) {
    return 'editor';
  }
  // AntD 及其 rc-* 组件
  if (id.includes('antd') || id.includes('@ant-design') || id.includes('rc-')) {
    return 'antd';
  }
  // 请求、缓存、状态、时间
  if (
    id.includes('@tanstack') ||
    id.includes('axios') ||
    id.includes('zustand') ||
    id.includes('dayjs')
  ) {
    return 'data';
  }
  // React 运行时（放在 tiptap 判断之后，避免误吞 @tiptap/react）
  if (id.includes('react') || id.includes('scheduler')) {
    return 'react';
  }
  return undefined;
}

// Vite 配置：路径别名、开发代理、Vitest 运行环境、构建分包
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
    testTimeout: 20_000,
    setupFiles: ['./tests/setup.ts'],
    css: true,
    coverage: { reporter: ['text', 'lcov'] },
  },
  build: {
    rollupOptions: {
      output: { manualChunks },
    },
  },
});
