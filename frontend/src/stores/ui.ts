import { create } from 'zustand';

// UI 状态：仅保存不进入服务端缓存的界面偏好
interface UiState {
  adminSidebarCollapsed: boolean;
  toggleAdminSidebar: () => void;
}

// 全局 UI Store
export const useUiStore = create<UiState>((set) => ({
  adminSidebarCollapsed: false,
  toggleAdminSidebar: () =>
    set((state) => ({ adminSidebarCollapsed: !state.adminSidebarCollapsed })),
}));
