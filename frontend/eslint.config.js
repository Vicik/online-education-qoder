import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

// ESLint 9 flat config：TS + React Hooks + Fast Refresh
export default tseslint.config(
  {
    // 忽略构建产物与生成代码
    ignores: ['dist', 'coverage', 'playwright-report', 'test-results', 'src/api/schema.d.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node 脚本：声明 console/process 等 Node 全局变量
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
);
