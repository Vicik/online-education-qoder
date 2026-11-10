import { create } from 'zustand';
import type { components } from '@/api/schema';

// 会话用户类型：直接复用 OpenAPI 生成类型
export type SessionUser = components['schemas']['User'];

// 会话状态：仅保存当前用户，不复制业务列表
interface SessionState {
  user: SessionUser | null;
  setUser: (user: SessionUser | null) => void;
  clear: () => void;
}

// 全局会话 Store
export const useSessionStore = create<SessionState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
  clear: () => set({ user: null }),
}));
