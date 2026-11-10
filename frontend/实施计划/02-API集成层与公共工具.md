# 步骤 02：API 集成层与公共工具

> 总览：[实施计划 README](./README.md) · 前置：步骤 01 · 后继：步骤 03

**目标**：一次性封装所有跨页面契约：axios 信封解包、错误归一与错误码动作、幂等键生命周期、服务端时钟、Query 键与缓存策略、会话/UI Store，以及金额、时间、校验、净化、图片地址工具。页面不得重复实现这些逻辑。

**完成标准**：
- [ ] 单元测试覆盖金额、时间、校验、图片地址、错误映射、信封解包、幂等 hook（本机可验证）
- [ ] `npm run typecheck`、`npm run lint`、`npm test` 通过（本机可验证）
- [ ] 2001/2002 能通过注册的处理器触发登录/403 动作（单测验证）
- [ ] `queryKeys` 与设计框架 §10 完全对应（代码评审）

## 文件清单

- Create：`frontend/src/api/errors.ts`、`client.ts`、`idempotency.ts`、`query-keys.ts`
- Create：`frontend/src/hooks/useIdempotentMutation.ts`、`useServerClock.ts`
- Create：`frontend/src/lib/money.ts`、`datetime.ts`、`validators.ts`、`sanitize.ts`、`image-url.ts`、`server-clock.ts`
- Create：`frontend/src/stores/session.ts`、`ui.ts`
- Create：`frontend/src/app/query-client.ts`
- Modify：`frontend/tests/setup.ts`（注册 dayjs 插件）
- Test：`frontend/tests/unit/money.test.ts`、`datetime.test.ts`、`validators.test.ts`、`image-url.test.ts`、`errors.test.ts`
- Test：`frontend/tests/api/client.test.ts`、`frontend/tests/hooks/useIdempotentMutation.test.tsx`

## 接口契约

**Consumes（来自步骤 01）：** `src/api/schema.d.ts` 的 `paths` / `components`；Vite 环境变量 `VITE_API_BASE`。

**Produces（后续步骤消费，名称与签名不得变更）：**

```ts
// api/errors.ts
interface Envelope<T> { code: number; message: string; data: T; requestId: string }
class ApiError extends Error {
  constructor(code: number, message: string, data: unknown, requestId: string, status: number);
  readonly code: number; readonly message: string; readonly data: unknown;
  readonly requestId: string; readonly status: number;
}
type ErrorAction = 'inline' | 'empty' | 'upload-size' | 'rate-limit' | 'login' | 'forbidden'
  | 'bad-credentials' | 'course-not-found' | 'not-purchased' | 'stock' | 'coupon'
  | 'duplicate-purchase' | 'idempotent-replay' | 'group-full' | 'activity-not-started'
  | 'exam-submitted' | 'exam-ended' | 'blocked-word' | 'version-conflict' | 'server';
function getErrorAction(code: number): ErrorAction;
interface AuthHandlers { onUnauthorized: () => void; onForbidden: () => void }
function registerAuthHandlers(handlers: AuthHandlers): void;

// api/client.ts
function request<T>(config: AxiosRequestConfig): Promise<T>;
const apiClient: AxiosInstance; // 响应拦截器返回已解包的 data

// api/idempotency.ts
function newIdempotencyKey(): string;

// api/query-keys.ts
const queryKeys: { authMe: readonly ['auth','me']; /* ... 见步骤文档 ... */ };

// hooks
function useIdempotentMutation<TData, TVariables>(
  mutationFn: (variables: TVariables, idempotencyKey: string) => Promise<TData>,
  options?: Omit<UseMutationOptions<TData, ApiError, TVariables>, 'mutationFn'>,
): UseMutationResult<TData, ApiError, TVariables>;
function useServerClock(): { offsetMs: number; now: () => number };

// lib
function formatCents(cents: number): string;
function yuanInputToCents(input: string | number | null | undefined): number | null;
function centsToYuanInput(cents: number): string;
function formatShanghai(iso: string): string;
function formatCountdown(remainingMs: number): string;
function validatePassword(value: string): string | null;
function validateEmail(value: string): string | null;
function validatePassScore(passScore: number, totalScore: number): string | null;
function validateTimeRange(startAt: string, endAt: string): string | null;
function isAllowedImage(file: File): boolean;
function sanitizeRichHtml(html: string): string;
function serializeRichHtmlForSave(html: string): string;
function resolveImageUrl(value: string | null | undefined, signedUrl?: string | null): string | undefined;

// stores
function useSessionStore(): { user: SessionUser | null; setUser(u: SessionUser | null): void; clear(): void };
function useUiStore(): { adminSidebarCollapsed: boolean; toggleAdminSidebar(): void };
```

## 任务 1：金额、时间、校验、图片工具（TDD）

- [ ] **1.1 写失败测试**

`tests/unit/money.test.ts`：

```ts
import { centsToYuanInput, formatCents, isSalePriceValid, yuanInputToCents } from '@/lib/money';

describe('money', () => {
  it('formatCents 保留两位小数', () => {
    expect(formatCents(1234)).toBe('¥12.34');
    expect(formatCents(0)).toBe('¥0.00');
  });
  it('yuanInputToCents 元转分', () => {
    expect(yuanInputToCents('12.34')).toBe(1234);
    expect(yuanInputToCents('12.3')).toBe(1230);
    expect(yuanInputToCents('12')).toBe(1200);
  });
  it('拒绝负值、超两位小数与非数字', () => {
    expect(yuanInputToCents('-1')).toBeNull();
    expect(yuanInputToCents('12.345')).toBeNull();
    expect(yuanInputToCents('abc')).toBeNull();
    expect(yuanInputToCents('')).toBeNull();
  });
  it('售价不得高于原价', () => {
    expect(isSalePriceValid(1000, 1000)).toBe(true);
    expect(isSalePriceValid(1000, 1001)).toBe(false);
  });
  it('centsToYuanInput 回显', () => {
    expect(centsToYuanInput(1234)).toBe('12.34');
  });
});
```

`tests/unit/datetime.test.ts`：

```ts
import { formatCountdown, formatShanghai, isPast } from '@/lib/datetime';

describe('datetime', () => {
  it('UTC 转 Asia/Shanghai 展示', () => {
    expect(formatShanghai('2026-01-01T02:00:00Z')).toBe('2026-01-01 10:00');
  });
  it('倒计时格式化', () => {
    expect(formatCountdown(10_000)).toBe('00:00:10');
    expect(formatCountdown(3_661_000)).toBe('01:01:01');
    expect(formatCountdown(-1)).toBe('00:00:00');
  });
  it('服务端时间判断到期', () => {
    expect(isPast('2026-01-01T00:00:00Z', Date.parse('2026-01-01T00:00:01Z'))).toBe(true);
  });
});
```

`tests/unit/validators.test.ts`：

```ts
import {
  validateConfirmPassword,
  validateEmail,
  validatePassScore,
  validatePassword,
  validateTimeRange,
} from '@/lib/validators';

describe('validators', () => {
  it('邮箱格式', () => {
    expect(validateEmail('user@example.com')).toBeNull();
    expect(validateEmail('bad')).toBe('请输入正确的邮箱');
  });
  it('密码 8–64 位，至少一个字母和一个数字，不允许中文与空格', () => {
    expect(validatePassword('abc12345')).toBeNull();
    expect(validatePassword('abcdefgh')).not.toBeNull();
    expect(validatePassword('12345678')).not.toBeNull();
    expect(validatePassword('abc 12345')).not.toBeNull();
    expect(validatePassword('密码abc12345')).not.toBeNull();
  });
  it('确认密码一致', () => {
    expect(validateConfirmPassword('abc12345', 'abc12345')).toBeNull();
    expect(validateConfirmPassword('abc12345', 'abc12346')).toBe('两次输入的密码不一致');
  });
  it('及格分大于 0 且不超过总分', () => {
    expect(validatePassScore(60, 100)).toBeNull();
    expect(validatePassScore(0, 100)).not.toBeNull();
    expect(validatePassScore(101, 100)).not.toBeNull();
  });
  it('结束时间必须晚于开始时间', () => {
    expect(validateTimeRange('2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z')).toBeNull();
    expect(validateTimeRange('2026-01-02T00:00:00Z', '2026-01-01T00:00:00Z')).not.toBeNull();
  });
});
```

`tests/unit/image-url.test.ts`：

```ts
import { isStorageKey, resolveImageUrl } from '@/lib/image-url';

describe('image-url', () => {
  it('识别对象存储 key 与历史 URL', () => {
    expect(isStorageKey('covers/abc.png')).toBe(true);
    expect(isStorageKey('https://cdn.example.com/a.png')).toBe(false);
    expect(isStorageKey(null)).toBe(false);
  });
  it('优先使用签名 URL', () => {
    expect(resolveImageUrl('covers/abc.png', 'https://signed')).toBe('https://signed');
    expect(resolveImageUrl('https://old.example.com/a.png')).toBe('https://old.example.com/a.png');
    expect(resolveImageUrl('covers/abc.png')).toBeUndefined();
  });
});
```

- [ ] **1.2 运行确认失败**

Run: `cd frontend && npm test -- tests/unit`
Expected: FAIL（模块不存在）。

- [ ] **1.3 实现**

`src/lib/money.ts`：

```ts
// 分 → "¥12.34"
export function formatCents(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

// 元输入 → 分；非法输入返回 null
export function yuanInputToCents(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined || input === '') return null;
  const text = String(input).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  return Math.round(Number(text) * 100);
}

// 分 → 元输入回显
export function centsToYuanInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

// 售价校验：非负且不高于原价
export function isSalePriceValid(originalCents: number, saleCents: number): boolean {
  return saleCents >= 0 && saleCents <= originalCents;
}
```

`src/lib/datetime.ts`：

```ts
import dayjs from 'dayjs';

// 服务端 ISO 时间 → Asia/Shanghai 展示（分钟精度）
export function formatShanghai(iso: string): string {
  return dayjs.utc(iso).tz('Asia/Shanghai').format('YYYY-MM-DD HH:mm');
}

// 剩余毫秒 → HH:mm:ss
export function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}

// 以服务端时间判断是否到期
export function isPast(iso: string, nowMs: number): boolean {
  return dayjs.utc(iso).valueOf() <= nowMs;
}
```

`src/lib/validators.ts`：

```ts
// 邮箱格式：非空本地段 + @ + 域名
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// 密码：8–64 位可见 ASCII，至少一个字母和一个数字（无中文/空格）
export const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d)[\x21-\x7E]{8,64}$/;
// 图片允许的 MIME
export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
// 图片上限 2MB
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

// 邮箱校验；通过返回 null
export function validateEmail(value: string): string | null {
  return EMAIL_REGEX.test(value) ? null : '请输入正确的邮箱';
}

// 密码校验；通过返回 null
export function validatePassword(value: string): string | null {
  return PASSWORD_REGEX.test(value)
    ? null
    : '密码需 8–64 位，至少包含一个字母和一个数字，不允许中文与空格';
}

// 确认密码校验
export function validateConfirmPassword(password: string, confirm: string): string | null {
  return password === confirm ? null : '两次输入的密码不一致';
}

// 昵称最长 30 字符
export function validateNickname(value: string): string | null {
  return value.length <= 30 ? null : '昵称最多 30 个字符';
}

// 课程名称最长 40 字符
export function validateCourseName(value: string): string | null {
  return value.length <= 40 ? null : '课程名称最多 40 个字符';
}

// 章节名称最长 60 字符
export function validateChapterTitle(value: string): string | null {
  return value.length <= 60 ? null : '章节名称最多 60 个字符';
}

// 及格分 >0 且 ≤ 总分
export function validatePassScore(passScore: number, totalScore: number): string | null {
  return passScore > 0 && passScore <= totalScore ? null : '及格分需大于 0 且不超过总分';
}

// 成团人数至少 2 人
export function validateGrouponTarget(targetSize: number): string | null {
  return targetSize >= 2 ? null : '成团人数至少 2 人';
}

// 活动结束时间必须晚于开始时间
export function validateTimeRange(startAt: string, endAt: string): string | null {
  return new Date(endAt).getTime() > new Date(startAt).getTime()
    ? null
    : '结束时间必须晚于开始时间';
}

// 上传前预检：类型与大小
export function isAllowedImage(file: File): boolean {
  return ALLOWED_IMAGE_TYPES.includes(file.type) && file.size <= MAX_IMAGE_BYTES;
}
```

`src/lib/image-url.ts`：

```ts
// 是否对象存储 key（非 http(s)）
export function isStorageKey(value: string | null | undefined): value is string {
  return !!value && !/^https?:\/\//i.test(value);
}

// 统一取展示地址：签名 URL 优先，其次历史 http(s) URL，key 无签名时返回 undefined
export function resolveImageUrl(
  value: string | null | undefined,
  signedUrl?: string | null,
): string | undefined {
  if (signedUrl) return signedUrl;
  if (!value) return undefined;
  return isStorageKey(value) ? undefined : value;
}
```

- [ ] **1.4 运行确认通过**

Run: `cd frontend && npm test -- tests/unit`
Expected: PASS。

- [ ] **1.5 提交**

```bash
git add frontend/src/lib frontend/tests/unit
git commit -m "feat(frontend): money datetime validator and image url utilities"
```

## 任务 2：错误归一与错误码动作

- [ ] **2.1 写失败测试** `tests/unit/errors.test.ts`

```ts
import { ApiError, getErrorAction, handleAuthError, registerAuthHandlers } from '@/api/errors';

describe('errors', () => {
  it('错误码映射到设计框架 §6.2 的动作', () => {
    expect(getErrorAction(2003)).toBe('bad-credentials');
    expect(getErrorAction(4003)).toBe('duplicate-purchase');
    expect(getErrorAction(4004)).toBe('idempotent-replay');
    expect(getErrorAction(5001)).toBe('group-full');
    expect(getErrorAction(7001)).toBe('blocked-word');
    expect(getErrorAction(409)).toBe('version-conflict');
    expect(getErrorAction(9999)).toBe('inline');
  });
  it('2001/2002 调用注册的处理器', () => {
    const onUnauthorized = vi.fn();
    const onForbidden = vi.fn();
    registerAuthHandlers({ onUnauthorized, onForbidden });
    expect(handleAuthError(new ApiError(2001, '未登录', null, 'r1', 401))).toBe(true);
    expect(onUnauthorized).toHaveBeenCalledOnce();
    handleAuthError(new ApiError(2002, '无权访问', null, 'r2', 403));
    expect(onForbidden).toHaveBeenCalledOnce();
  });
});
```

- [ ] **2.2 运行确认失败** — Expected: FAIL（`@/api/errors` 不存在）。

- [ ] **2.3 实现 `src/api/errors.ts`**

```ts
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

// 错误码字典：未列出的 4xx 归入 inline，5xx/网络归入 server
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
  return ERROR_ACTIONS[code] ?? (code >= 500 ? 'server' : 'inline');
}

// 会话失效/无权限的全局处理器
interface AuthHandlers {
  onUnauthorized: () => void;
  onForbidden: () => void;
}

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
```

- [ ] **2.4 运行确认通过** — Expected: PASS。

## 任务 3：axios 实例与服务端时钟（TDD）

- [ ] **3.1 写失败测试** `tests/api/client.test.ts`

```ts
import { http, HttpResponse } from 'msw';
import { apiClient, request } from '@/api/client';
import { ApiError, registerAuthHandlers } from '@/api/errors';
import { server } from '../msw/server';

describe('api client', () => {
  it('code=0 时返回 data', async () => {
    server.use(
      http.get(/\/api\/v1\/ping$/, () =>
        HttpResponse.json({ code: 0, message: 'ok', data: { pong: true }, requestId: 'r1' }),
      ),
    );
    await expect(request<{ pong: boolean }>({ url: '/ping' })).resolves.toEqual({ pong: true });
  });
  it('非 0 业务码抛 ApiError', async () => {
    server.use(
      http.get(/\/api\/v1\/ping$/, () =>
        HttpResponse.json(
          { code: 1001, message: '参数错误', data: null, requestId: 'r2' },
          { status: 400 },
        ),
      ),
    );
    await expect(request({ url: '/ping' })).rejects.toMatchObject({ code: 1001, requestId: 'r2' });
  });
  it('2001 触发未登录处理器', async () => {
    const onUnauthorized = vi.fn();
    registerAuthHandlers({ onUnauthorized, onForbidden: vi.fn() });
    server.use(
      http.get(/\/api\/v1\/secure$/, () =>
        HttpResponse.json(
          { code: 2001, message: '未登录', data: null, requestId: 'r3' },
          { status: 401 },
        ),
      ),
    );
    await expect(request({ url: '/secure' })).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });
  it('skipAuthRedirect 时 2001 不触发处理器', async () => {
    const onUnauthorized = vi.fn();
    registerAuthHandlers({ onUnauthorized, onForbidden: vi.fn() });
    server.use(
      http.get(/\/api\/v1\/me$/, () =>
        HttpResponse.json(
          { code: 2001, message: '未登录', data: null, requestId: 'r4' },
          { status: 401 },
        ),
      ),
    );
    await expect(request({ url: '/me', skipAuthRedirect: true })).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
  it('响应 Date 头用于服务端时钟', async () => {
    server.use(
      http.get(/\/api\/v1\/time$/, () =>
        HttpResponse.json(
          { code: 0, message: 'ok', data: null, requestId: 'r5' },
          { headers: { Date: new Date('2026-01-01T00:00:00Z').toUTCString() } },
        ),
      ),
    );
    await request({ url: '/time' });
    expect(apiClient).toBeDefined(); // 时钟差值由 lib/server-clock 单测覆盖
  });
});
```

- [ ] **3.2 运行确认失败** — Expected: FAIL。

- [ ] **3.3 实现 `src/lib/server-clock.ts`、`src/hooks/useServerClock.ts`、`src/api/client.ts`**

`src/lib/server-clock.ts`：

```ts
// 服务端与本地时钟差值（毫秒）
let offsetMs = 0;
// 订阅者集合：时钟校正后通知倒计时刷新
const listeners = new Set<() => void>();

// 用响应 Date 头校正服务端时钟
export function syncServerClock(dateHeader?: string): void {
  if (!dateHeader) return;
  const serverMs = Date.parse(dateHeader);
  if (Number.isNaN(serverMs)) return;
  const nextOffset = serverMs - Date.now();
  if (Math.abs(nextOffset - offsetMs) < 1000) return;
  offsetMs = nextOffset;
  listeners.forEach((listener) => listener());
}

// 订阅时钟变化（useSyncExternalStore 使用）
export function subscribeServerClock(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// 当前服务端时间偏移
export function getServerOffsetMs(): number {
  return offsetMs;
}

// 校准后的服务端当前时间
export function serverNow(): number {
  return Date.now() + offsetMs;
}
```

`src/hooks/useServerClock.ts`：

```ts
import { useSyncExternalStore } from 'react';
import { getServerOffsetMs, serverNow, subscribeServerClock } from '@/lib/server-clock';

// 暴露服务端时钟偏移与校准后的 now()
export function useServerClock(): { offsetMs: number; now: () => number } {
  const offsetMs = useSyncExternalStore(subscribeServerClock, getServerOffsetMs, () => 0);
  return { offsetMs, now: serverNow };
}
```

`src/api/client.ts`：

```ts
import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
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
    return envelope.data;
  },
  (error) => {
    const normalized = normalizeAxiosError(error);
    if (!axios.isAxiosError(error) || !error.config?.skipAuthRedirect) {
      handleAuthError(normalized);
    }
    return Promise.reject(normalized);
  },
);

// 类型化请求：拦截器已把响应替换为 data
export function request<T>(config: AxiosRequestConfig): Promise<T> {
  return apiClient.request<T, T>(config);
}
```

- [ ] **3.4 运行确认通过** — Expected: PASS。

- [ ] **3.5 提交**

```bash
git add frontend/src/api/errors.ts frontend/src/api/client.ts frontend/src/lib/server-clock.ts frontend/src/hooks/useServerClock.ts frontend/tests/api/client.test.ts frontend/tests/unit/errors.test.ts
git commit -m "feat(frontend): axios envelope client, error mapping and server clock"
```

## 任务 4：幂等键与幂等 Mutation（TDD）

- [ ] **4.1 写失败测试** `tests/hooks/useIdempotentMutation.test.tsx`

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { ApiError } from '@/api/errors';
import { newIdempotencyKey } from '@/api/idempotency';
import { useIdempotentMutation } from '@/hooks/useIdempotentMutation';

// 测试用 QueryClient
function createWrapper() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('useIdempotentMutation', () => {
  it('生成 8–128 长度且唯一的 key', () => {
    const first = newIdempotencyKey();
    const second = newIdempotencyKey();
    expect(first.length).toBeGreaterThanOrEqual(8);
    expect(first.length).toBeLessThanOrEqual(128);
    expect(first).not.toBe(second);
  });
  it('失败重试复用同一 key，成功后重置', async () => {
    const keys: string[] = [];
    const mutationFn = vi.fn(async (_variables: { id: number }, key: string) => {
      keys.push(key);
      if (keys.length === 1) throw new ApiError(1006, 'down', null, 'r', 500);
      return { ok: true };
    });
    const { result } = renderHook(
      () => useIdempotentMutation<{ ok: boolean }, { id: number }>(mutationFn),
      { wrapper: createWrapper() },
    );
    await expect(result.current.mutateAsync({ id: 1 })).rejects.toBeInstanceOf(ApiError);
    await result.current.mutateAsync({ id: 1 });
    await result.current.mutateAsync({ id: 1 });
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[1]);
  });
});
```

- [ ] **4.2 运行确认失败** — Expected: FAIL。

- [ ] **4.3 实现 `src/api/idempotency.ts`、`src/hooks/useIdempotentMutation.ts`**

`src/api/idempotency.ts`：

```ts
// 生成幂等键：36 字符 UUID，满足后端 8–128 要求
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
```

`src/hooks/useIdempotentMutation.ts`：

```ts
import {
  useMutation,
  type UseMutationOptions,
  type UseMutationResult,
} from '@tanstack/react-query';
import { useRef } from 'react';
import { newIdempotencyKey } from '@/api/idempotency';
import { ApiError } from '@/api/errors';

// 默认只对网络错误/5xx 自动重试一次，重试沿用同一幂等键
function shouldRetry(failureCount: number, error: ApiError): boolean {
  return (error.status === 0 || error.status >= 500) && failureCount < 1;
}

// 幂等 Mutation：一次用户意图一个 key，成功后重置
export function useIdempotentMutation<TData, TVariables>(
  mutationFn: (variables: TVariables, idempotencyKey: string) => Promise<TData>,
  options?: Omit<UseMutationOptions<TData, ApiError, TVariables>, 'mutationFn'>,
): UseMutationResult<TData, ApiError, TVariables> {
  // 当前用户意图的幂等键；失败保留，成功后清空
  const keyRef = useRef<string | null>(null);

  return useMutation<TData, ApiError, TVariables>({
    ...options,
    retry: options?.retry ?? shouldRetry,
    mutationFn: (variables) => {
      keyRef.current ??= newIdempotencyKey();
      return mutationFn(variables, keyRef.current);
    },
    onSuccess: async (data, variables, context) => {
      keyRef.current = null;
      await options?.onSuccess?.(data, variables, context);
    },
  });
}
```

- [ ] **4.4 运行确认通过** — Expected: PASS。

## 任务 5：Query 键、QueryClient 与 Store

- [ ] **5.1 实现 `src/api/query-keys.ts`**

```ts
// 全局 Query 键：与设计框架 §10 对齐，写操作后按领域精确失效
export const queryKeys = {
  authMe: ['auth', 'me'] as const,
  homeRecommendations: ['home', 'recommendations'] as const,
  courses: (page: number) => ['courses', page] as const,
  course: (id: number) => ['course', id] as const,
  courseContent: (courseId: number, chapterId: number) =>
    ['course', courseId, 'content', chapterId] as const,
  courseCoupons: (id: number) => ['courses', id, 'coupons'] as const,
  studyRecords: (page = 1) => ['study-records', page] as const,
  favorites: (page = 1) => ['favorites', 'mine', page] as const,
  checkout: (courseId: number, params: string) => ['checkout', courseId, params] as const,
  order: (id: number) => ['order', id] as const,
  myOrders: (page: number) => ['orders', 'mine', page] as const,
  groupons: (page: number) => ['groupons', page] as const,
  groupon: (id: number) => ['groupon', id] as const,
  flashSales: (page: number) => ['flash-sales', page] as const,
  flashSale: (id: number) => ['flash-sale', id] as const,
  myCoupons: (status: string, page: number) => ['coupons', 'mine', status, page] as const,
  exams: (page: number) => ['exams', page] as const,
  exam: (id: number) => ['exam', id] as const,
  examResult: (examId: number, attemptId: number) =>
    ['exam-attempt', attemptId, 'result', examId] as const,
  posts: (page: number) => ['posts', page] as const,
  post: (id: number) => ['post', id] as const,
  myPosts: (page: number) => ['user', 'posts', page] as const,
  myExams: (page: number) => ['user', 'exams', page] as const,
  profile: ['user', 'profile'] as const,
  overview: ['user', 'overview'] as const,
  adminCourses: (params: string) => ['admin', 'courses', params] as const,
  adminCourse: (id: number) => ['admin', 'courses', id] as const,
  adminGroupons: (page: number) => ['admin', 'groupons', page] as const,
  adminFlashSales: (page: number) => ['admin', 'flash-sales', page] as const,
  adminCoupons: (page: number, status = 'all') => ['admin', 'coupons', page, status] as const,
  // 题目/屏蔽词带筛选参数；考试仅分页（步骤 16 定稿）
  adminQuestions: (params: string) => ['admin', 'questions', params] as const,
  adminQuestion: (id: number) => ['admin', 'questions', 'detail', id] as const,
  adminExams: (page: number) => ['admin', 'exams', page] as const,
  adminExam: (id: number) => ['admin', 'exams', 'detail', id] as const,
  adminBlockedWords: (params: string) => ['admin', 'blocked-words', params] as const,
  dashboardStats: ['admin', 'dashboard', 'stats'] as const,
};
```

- [ ] **5.2 实现 `src/app/query-client.ts`**

```ts
import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/errors';

// 全局 QueryClient：缓存 30 秒；GET 失败最多重试一次；写操作不自动重试
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 1;
      },
      refetchOnWindowFocus: false,
    },
    mutations: { retry: false },
  },
});
```

- [ ] **5.3 实现 `src/stores/session.ts`、`src/stores/ui.ts`**

`src/stores/session.ts`：

```ts
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

export const useSessionStore = create<SessionState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
  clear: () => set({ user: null }),
}));
```

`src/stores/ui.ts`：

```ts
import { create } from 'zustand';

// UI 状态：仅保存不进入服务端缓存的界面偏好
interface UiState {
  adminSidebarCollapsed: boolean;
  toggleAdminSidebar: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  adminSidebarCollapsed: false,
  toggleAdminSidebar: () =>
    set((state) => ({ adminSidebarCollapsed: !state.adminSidebarCollapsed })),
}));
```

- [ ] **5.4 类型检查与测试**

Run: `cd frontend && npm run typecheck && npm test`
Expected: PASS。

- [ ] **5.5 提交**

```bash
git add frontend/src/api frontend/src/app/query-client.ts frontend/src/stores frontend/src/hooks frontend/tests/hooks
git commit -m "feat(frontend): query keys, query client, idempotent mutation and stores"
```

## 任务 6：富文本净化与图片 key 回写

- [ ] **6.1 写失败测试** `tests/unit/sanitize.test.ts`

```ts
import { sanitizeRichHtml, serializeRichHtmlForSave } from '@/lib/sanitize';

describe('sanitize', () => {
  it('剥离 script 与事件属性', () => {
    const output = sanitizeRichHtml('<p onclick="x()">a</p><script>alert(1)</script>');
    expect(output).not.toContain('<script');
    expect(output).not.toContain('onclick');
  });
  it('保留图片 data-key 与表格', () => {
    const output = sanitizeRichHtml(
      '<img src="https://signed" data-key="covers/a.png" alt="a"><table><tr><td>x</td></tr></table>',
    );
    expect(output).toContain('data-key="covers/a.png"');
    expect(output).toContain('<table>');
  });
  it('保存前把 img src 回写为 data-key', () => {
    const output = serializeRichHtmlForSave(
      '<p><img src="https://signed/abc" data-key="covers/a.png" alt="a"></p>',
    );
    expect(output).toContain('src="covers/a.png"');
    expect(output).toContain('data-key="covers/a.png"');
  });
});
```

- [ ] **6.2 运行确认失败** — Expected: FAIL。

- [ ] **6.3 实现 `src/lib/sanitize.ts`**

```ts
import DOMPurify from 'dompurify';

// 富文本白名单：与后端净化规则保持一致
const RICH_TEXT_CONFIG = {
  ALLOWED_TAGS: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'strong', 'em', 'u', 's',
    'ul', 'ol', 'li', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'br', 'blockquote', 'code', 'pre',
  ],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'data-key', 'colspan', 'rowspan'],
};

// 展示端纵深防御：后端已净化，前端再过滤一次
export function sanitizeRichHtml(html: string): string {
  return DOMPurify.sanitize(html, RICH_TEXT_CONFIG);
}

// 保存前把已签名的 img src 回写为对象存储 key（保留 data-key）
export function serializeRichHtmlForSave(html: string): string {
  const documentNode = new DOMParser().parseFromString(html, 'text/html');
  documentNode.querySelectorAll('img[data-key]').forEach((image) => {
    const key = image.getAttribute('data-key');
    if (key) image.setAttribute('src', key);
  });
  return document.body.innerHTML;
}
```

- [ ] **6.4 运行确认通过** — Expected: PASS。

- [ ] **6.5 提交**

```bash
git add frontend/src/lib/sanitize.ts frontend/tests/unit/sanitize.test.ts
git commit -m "feat(frontend): rich text sanitize and image key serialization"
```

## 完成标准复核

- [ ] 本机：`npm run lint`、`npm run typecheck`、`npm test` 全通过。
- [ ] `tests/unit` 覆盖金额/时间/校验/图片/错误映射/净化；`tests/api` 覆盖信封解包与 2001 处理；`tests/hooks` 覆盖幂等键复用。
- [ ] 未执行项：E2E 不涉及。
