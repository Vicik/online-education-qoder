import { create } from 'zustand';

// 请求活动状态：拦截器增减计数，驱动全局加载遮罩
interface RequestActivityState {
  pendingCount: number;
  startRequest: () => void;
  finishRequest: () => void;
}

// 全局请求活动 Store
export const useRequestActivityStore = create<RequestActivityState>((set) => ({
  pendingCount: 0,
  startRequest: () => set((state) => ({ pendingCount: state.pendingCount + 1 })),
  finishRequest: () =>
    set((state) => ({ pendingCount: Math.max(0, state.pendingCount - 1) })),
}));
