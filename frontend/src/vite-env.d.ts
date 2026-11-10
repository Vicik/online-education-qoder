/// <reference types="vite/client" />

// 环境变量类型声明，保证 import.meta.env 可被类型检查
interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}