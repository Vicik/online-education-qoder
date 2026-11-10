import axios from 'axios';

// 后端统一响应包
export interface Envelope<T> {
  code: number; // 0=成功；非 0 为业务错误码
  message: string; // 展示文案
  data: T; // 业务数据或错误附加信息
  requestId: string; // 排查用请求 id
}

// 业务/网络错误统一对象
export class ApiError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data: unknown,
    public readonly requestId: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// 错误码到 UI 动作（与设计框架 §6.2 一一对应）
export type ErrorAction =
  | 'inline'
  | 'empty'
  | 'upload-size'
  | 'rate-limit'
  | 'login'
  | 'forbidden'
  | 'bad-credentials'
  | 'course-not-found'
  | 'not-purchased'
  | 'stock'
  | 'coupon'
  | 'duplicate-purchase'
  | 'idempotent-replay'
  | 'group-full'
  | 'activity-not-started'
  | 'exam-submitted'
  | 'exam-ended'
  | 'blocked-word'
  | 'version-conflict'
  | 'server';

// 错误码字典：未列出的 HTTP 5xx 归入 server，其余（4xx/业务码）归入 inline
const ERROR_ACTIONS: Record<number, ErrorAction> = {
  1001: 'inline',
  1002: 'empty',
  1004: 'upload-size',
  1005: 'rate-limit',
  2001: 'login',
  2002: 'forbidden',
  2003: 'bad-credentials',
  3001: 'course-not-found',
  3002: 'not-purchased',
  4001: 'stock',
  4002: 'coupon',
  4003: 'duplicate-purchase',
  4004: 'idempotent-replay',
  5001: 'group-full',
  5002: 'activity-not-started',
  5003: 'stock',
  6001: 'exam-submitted',
  6002: 'exam-ended',
  7001: 'blocked-word',
  409: 'version-conflict',
};

// 查询错误码对应的前端动作
export function getErrorAction(code: number): ErrorAction {
  return ERROR_ACTIONS[code] ?? (code >= 500 && code < 600 ? 'server' : 'inline');
}

// 会话失效/无权限的全局处理器
interface AuthHandlers {
  onUnauthorized: () => void;
  onForbidden: () => void;
}

// 全局处理器实例：应用根部注册一次
let authHandlers: AuthHandlers | null = null;

// 注册全局会话处理器（步骤 03 在应用根部调用）
export function registerAuthHandlers(handlers: AuthHandlers): void {
  authHandlers = handlers;
}

// 命中 2001/2002 时调用处理器；返回是否已处理
export function handleAuthError(error: ApiError): boolean {
  if (error.code === 2001) {
    authHandlers?.onUnauthorized();
    return true;
  }
  if (error.code === 2002) {
    authHandlers?.onForbidden();
    return true;
  }
  return false;
}

// 任意异常归一为 ApiError
export function normalizeAxiosError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (axios.isAxiosError(error)) {
    const envelope = error.response?.data as Partial<Envelope<unknown>> | undefined;
    if (envelope && typeof envelope.code === 'number') {
      return new ApiError(
        envelope.code,
        envelope.message ?? '请求失败',
        envelope.data ?? null,
        envelope.requestId ?? '',
        error.response?.status ?? 0,
      );
    }
    return new ApiError(
      1006,
      error.response ? '请求失败，请稍后重试' : '网络异常，请检查网络后重试',
      null,
      '',
      error.response?.status ?? 0,
    );
  }
  return new ApiError(1006, '未知错误，请稍后重试', null, '', 0);
}
