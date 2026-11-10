import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from 'axios';
import { syncServerClock } from '@/lib/server-clock';
import {
  ApiError,
  handleAuthError,
  normalizeAxiosError,
  type Envelope,
} from './errors';

// 扩展请求配置：/auth/me 等探测请求不触发全局跳登录
declare module 'axios' {
  export interface AxiosRequestConfig {
    skipAuthRedirect?: boolean;
  }
}

// 全局 axios 实例：同源凭据 + JSON
export const apiClient: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE ?? '/api/v1',
  withCredentials: true,
  headers: { Accept: 'application/json' },
});

// 成功响应：解包信封；非 0 业务码抛 ApiError
apiClient.interceptors.response.use(
  (response) => {
    syncServerClock(response.headers.date);
    const envelope = response.data as Envelope<unknown>;
    if (envelope.code !== 0) {
      const error = new ApiError(
        envelope.code,
        envelope.message,
        envelope.data,
        envelope.requestId,
        response.status,
      );
      if (!response.config.skipAuthRedirect) handleAuthError(error);
      throw error;
    }
    return envelope.data as unknown as AxiosResponse;
  },
  (error) => {
    const normalized = normalizeAxiosError(error);
    if (!axios.isAxiosError(error) || !error.config?.skipAuthRedirect) {
      handleAuthError(normalized);
    }
    return Promise.reject(normalized);
  },
);

// 类型化请求：拦截器已把响应替换为 data，axios 类型无法表达该变换
export function request<T>(config: AxiosRequestConfig): Promise<T> {
  return apiClient.request<T, T>(config) as unknown as Promise<T>;
}
