# 步骤 05：公共组件与 Hooks

> 总览：[实施计划 README](./README.md) · 前置：步骤 03 · 后继：步骤 06

**目标**：交付跨页面复用的组件与 hooks：列表、二次确认、倒计时、金额输入/展示、状态标签、富文本编辑/展示、图片上传、页头、空态、错误边界，以及分页、权限、倒计时 hooks。后续页面只组合这些能力，不重复实现。

**完成标准**：
- [ ] 组件单测通过：金额输入元转分、倒计时到期回调一次、状态标签、表格分页、确认取消不回调、富文本图片 key 回写与表格截断（本机可验证）
- [ ] `usePagination` 越界回退单测通过（本机可验证）
- [ ] `npm run lint`、`npm run typecheck`、`npm test` 通过（本机可验证）
- [ ] 富文本编辑器在真实浏览器中可输入、加粗、插入图片与表格（手工验证，步骤 17 E2E 复核）

## 文件清单

- Create：`frontend/src/components/common/AppTable.tsx`、`ConfirmAction.tsx`、`Countdown.tsx`、`MoneyInput.tsx`、`MoneyText.tsx`、`StatusTag.tsx`、`RichTextEditor.tsx`、`RichTextViewer.tsx`、`ImageUploader.tsx`、`PageHeader.tsx`、`EmptyState.tsx`、`ErrorBoundary.tsx`
- Create：`frontend/src/hooks/usePagination.ts`、`usePermission.ts`、`useCountdown.ts`
- Create：`frontend/src/api/files.ts`
- Modify：`frontend/src/lib/sanitize.ts`（新增表格截断并接入保存序列化）
- Test：`frontend/tests/components/money.test.tsx`、`countdown.test.tsx`、`status-tag.test.tsx`、`app-table.test.tsx`、`confirm-action.test.tsx`、`error-boundary.test.tsx`、`rich-text.test.tsx`
- Test：`frontend/tests/hooks/usePagination.test.tsx`

## 接口契约

**Consumes：** 步骤 02 的 `formatCents`、`formatCountdown`、`sanitizeRichHtml`、`serializeRichHtmlForSave`、`useServerClock`、`uploadImage` 类型；步骤 03 的布局样式变量。

**Produces（后续步骤消费，名称与签名不得变更）：**

```ts
// components/common
function AppTable<T extends object>(props: {
  columns: ColumnsType<T>; dataSource: T[]; rowKey: keyof T | ((row: T) => string);
  total: number; page: number; pageSize: number; loading?: boolean; error?: Error | null;
  onRetry?: () => void; onPageChange: (page: number, pageSize: number) => void;
  emptyText?: string;
}): JSX.Element;
function ConfirmAction(props: {
  title: string; content?: ReactNode; okText?: string; cancelText?: string; danger?: boolean;
  disabled?: boolean; onConfirm: () => Promise<void> | void; children: ReactElement;
}): JSX.Element;
function Countdown(props: { deadlineAt: string; onExpire?: () => void; prefix?: string }): JSX.Element;
function MoneyInput(props: { value?: number | null; onChange?: (cents: number | null) => void; disabled?: boolean; maxCents?: number; placeholder?: string }): JSX.Element;
function MoneyText(props: { cents: number; originalCents?: number; size?: 'default' | 'large' }): JSX.Element;
type StatusDomain = 'course' | 'order' | 'groupon' | 'group' | 'flash-sale' | 'exam' | 'coupon' | 'question' | 'user' | 'gender';
function StatusTag(props: { domain: StatusDomain; status: string }): JSX.Element;
function RichTextEditor(props: { value?: string; onChange?: (html: string) => void; placeholder?: string; disabled?: boolean; onUploadImage?: (file: File) => Promise<UploadResult> }): JSX.Element;
function RichTextViewer(props: { html: string; className?: string }): JSX.Element;
interface ImageValue { key: string; url?: string | null }
function ImageUploader(props: { value?: ImageValue | null; onChange?: (value: ImageValue | null) => void; disabled?: boolean }): JSX.Element;
function PageHeader(props: { title: ReactNode; extra?: ReactNode }): JSX.Element;
function EmptyState(props: { description: string; action?: ReactNode }): JSX.Element;
class ErrorBoundary extends Component<PropsWithChildren, { error: Error | null }>;

// hooks
function usePagination(total: number, initialPageSize?: number): {
  page: number; pageSize: number;
  onChange: (page: number, pageSize: number) => void;
  reset: () => void;
};
function usePermission(): {
  user: SessionUser | null; isAdmin: boolean; isUser: boolean;
  can: (roles?: Array<'user' | 'admin'>) => boolean;
};
function useCountdown(deadlineAt: string | null | undefined, onExpire?: () => void): number;

// api/files.ts
interface UploadResult { key: string; url: string }
function uploadImage(file: File): Promise<UploadResult>;
```

## 任务 1：金额、状态、空态、页头（TDD）

- [ ] **1.1 写失败测试** `tests/components/money.test.tsx`、`status-tag.test.tsx`

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { MoneyInput } from '@/components/common/MoneyInput';
import { MoneyText } from '@/components/common/MoneyText';

describe('MoneyInput', () => {
  it('输入元转换为分', () => {
    const onChange = vi.fn();
    render(<MoneyInput value={null} onChange={onChange} />);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '12.34' } });
    expect(onChange).toHaveBeenLastCalledWith(1234);
  });
  it('禁止负数', () => {
    const onChange = vi.fn();
    render(<MoneyInput value={null} onChange={onChange} />);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '-1' } });
    expect(onChange).not.toHaveBeenCalledWith(-100);
  });
});

describe('MoneyText', () => {
  it('展示售价与原价删除线', () => {
    render(<MoneyText cents={9900} originalCents={12900} />);
    expect(screen.getByText('¥99.00')).toBeInTheDocument();
    expect(screen.getByText('¥129.00')).toBeInTheDocument();
  });
});
```

```tsx
import { render, screen } from '@testing-library/react';
import { StatusTag } from '@/components/common/StatusTag';

describe('StatusTag', () => {
  it('按领域映射文案', () => {
    const { rerender } = render(<StatusTag domain="course" status="draft" />);
    expect(screen.getByText('草稿')).toBeInTheDocument();
    rerender(<StatusTag domain="order" status="pending" />);
    expect(screen.getByText('待支付')).toBeInTheDocument();
    rerender(<StatusTag domain="group" status="pending" />);
    expect(screen.getByText('待成团')).toBeInTheDocument();
    rerender(<StatusTag domain="coupon" status="restored" />);
    expect(screen.getByText('未使用')).toBeInTheDocument();
  });
  it('未知状态回退原文', () => {
    render(<StatusTag domain="course" status="unknown-state" />);
    expect(screen.getByText('unknown-state')).toBeInTheDocument();
  });
});
```

- [ ] **1.2 运行确认失败** — Expected: FAIL。

- [ ] **1.3 实现**

`src/components/common/MoneyInput.tsx`：

```tsx
import { InputNumber } from 'antd';

// 金额输入：表单值为整数分，界面以元展示，最多两位小数
export function MoneyInput({
  value,
  onChange,
  disabled,
  maxCents,
  placeholder,
}: {
  value?: number | null;
  onChange?: (cents: number | null) => void;
  disabled?: boolean;
  maxCents?: number;
  placeholder?: string;
}) {
  // 分 → 元展示
  const displayValue = value === null || value === undefined ? null : value / 100;
  return (
    <InputNumber
      style={{ width: '100%' }}
      value={displayValue}
      min={0}
      max={maxCents === undefined ? undefined : maxCents / 100}
      precision={2}
      step={0.01}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(next) => onChange?.(next === null ? null : Math.round(Number(next) * 100))}
    />
  );
}
```

`src/components/common/MoneyText.tsx`：

```tsx
import { formatCents } from '@/lib/money';

// 金额展示：整数分；可选原价删除线
export function MoneyText({
  cents,
  originalCents,
  size = 'default',
}: {
  cents: number;
  originalCents?: number;
  size?: 'default' | 'large';
}) {
  return (
    <span>
      <span
        style={{
          color: 'var(--color-price)',
          fontWeight: 600,
          fontSize: size === 'large' ? 24 : 14,
        }}
      >
        {formatCents(cents)}
      </span>
      {originalCents !== undefined && originalCents > cents && (
        <span
          style={{
            marginLeft: 8,
            color: 'var(--color-price-origin)',
            textDecoration: 'line-through',
          }}
        >
          {formatCents(originalCents)}
        </span>
      )}
    </span>
  );
}
```

`src/components/common/StatusTag.tsx`：

```tsx
import { Tag } from 'antd';

// 状态领域：不同领域的同名字段文案不同
export type StatusDomain =
  | 'course'
  | 'order'
  | 'groupon'
  | 'group'
  | 'flash-sale'
  | 'exam'
  | 'coupon'
  | 'question'
  | 'user'
  | 'gender';

// 每个领域的状态 → 文案/颜色
const STATUS_MAPS: Record<StatusDomain, Record<string, { text: string; color: string }>> = {
  course: {
    draft: { text: '草稿', color: 'default' },
    published: { text: '已发布', color: 'success' },
    unpublished: { text: '已下架', color: 'warning' },
  },
  order: {
    pending: { text: '待支付', color: 'processing' },
    paid: { text: '已支付', color: 'success' },
    refunded: { text: '已退款', color: 'error' },
    cancelled: { text: '已取消', color: 'default' },
  },
  groupon: {
    not_started: { text: '未开始', color: 'default' },
    ongoing: { text: '进行中', color: 'processing' },
    ended: { text: '已结束', color: 'default' },
    cancelled: { text: '已取消', color: 'default' },
  },
  group: {
    pending: { text: '待成团', color: 'processing' },
    success: { text: '已成团', color: 'success' },
    failed: { text: '拼团失败', color: 'error' },
  },
  'flash-sale': {
    not_started: { text: '未开始', color: 'default' },
    ongoing: { text: '进行中', color: 'processing' },
    ended: { text: '已结束', color: 'default' },
    cancelled: { text: '已取消', color: 'default' },
  },
  exam: {
    draft: { text: '草稿', color: 'default' },
    published: { text: '已发布', color: 'success' },
    ended: { text: '已结束', color: 'default' },
  },
  coupon: {
    unused: { text: '未使用', color: 'processing' },
    used: { text: '已使用', color: 'default' },
    restored: { text: '未使用', color: 'processing' },
    expired: { text: '已过期', color: 'default' },
    invalid: { text: '已失效', color: 'default' },
    enabled: { text: '已启用', color: 'success' },
    disabled: { text: '已停用', color: 'default' },
  },
  question: {
    single: { text: '单选', color: 'blue' },
    multiple: { text: '多选', color: 'purple' },
    enabled: { text: '已启用', color: 'success' },
    disabled: { text: '已停用', color: 'default' },
  },
  user: {
    user: { text: '普通用户', color: 'blue' },
    admin: { text: '管理员', color: 'gold' },
  },
  gender: {
    male: { text: '男', color: 'blue' },
    female: { text: '女', color: 'magenta' },
    secret: { text: '保密', color: 'default' },
  },
};

// 状态标签：未知状态回退原文
export function StatusTag({ domain, status }: { domain: StatusDomain; status: string }) {
  const meta = STATUS_MAPS[domain][status];
  return <Tag color={meta?.color}>{meta?.text ?? status}</Tag>;
}
```

`src/components/common/EmptyState.tsx`：

```tsx
import { Empty } from 'antd';
import type { ReactNode } from 'react';

// 空态：文案 + 可选操作
export function EmptyState({ description, action }: { description: string; action?: ReactNode }) {
  return <Empty description={description}>{action}</Empty>;
}
```

`src/components/common/PageHeader.tsx`：

```tsx
import { Typography } from 'antd';
import type { ReactNode } from 'react';

// 页头：标题 + 右侧操作区
export function PageHeader({ title, extra }: { title: ReactNode; extra?: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
      }}
    >
      <Typography.Title level={4} style={{ margin: 0 }}>
        {title}
      </Typography.Title>
      {extra}
    </div>
  );
}
```

- [ ] **1.4 运行确认通过** — Expected: PASS。

## 任务 2：分页、倒计时与权限 Hooks（TDD）

- [ ] **2.1 写失败测试**

`tests/hooks/usePagination.test.tsx`：

```tsx
import { act, renderHook } from '@testing-library/react';
import { usePagination } from '@/hooks/usePagination';

describe('usePagination', () => {
  it('切页与越界回退', () => {
    const { result, rerender } = renderHook(
      ({ total }: { total: number }) => usePagination(total, 20),
      { initialProps: { total: 45 } },
    );
    act(() => result.current.onChange(3, 20));
    expect(result.current.page).toBe(3);
    rerender({ total: 21 });
    expect(result.current.page).toBe(2);
  });
  it('修改页大小回到第 1 页', () => {
    const { result } = renderHook(() => usePagination(100, 20));
    act(() => result.current.onChange(3, 20));
    act(() => result.current.onChange(3, 50));
    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(50);
  });
});
```

`tests/components/countdown.test.tsx`：

```tsx
import { act, render, screen } from '@testing-library/react';
import { Countdown } from '@/components/common/Countdown';

describe('Countdown', () => {
  it('使用服务端时间并在到期时只回调一次', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const onExpire = vi.fn();
    render(<Countdown deadlineAt="2026-01-01T00:00:10Z" onExpire={onExpire} />);
    expect(screen.getByText('00:00:10')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(10_000));
    expect(onExpire).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(5_000));
    expect(onExpire).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
```

- [ ] **2.2 运行确认失败** — Expected: FAIL。

- [ ] **2.3 实现**

`src/hooks/usePagination.ts`：

```ts
import { useEffect, useState } from 'react';

// 分页状态：total 变化导致当前页越界时自动回退到最后一页
export function usePagination(total: number, initialPageSize = 20) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(total / pageSize));
    if (page > maxPage) setPage(maxPage);
  }, [page, pageSize, total]);

  // 表格分页变化：改变页大小时回到第 1 页
  function onChange(nextPage: number, nextPageSize: number) {
    if (nextPageSize !== pageSize) {
      setPageSize(nextPageSize);
      setPage(1);
      return;
    }
    setPage(nextPage);
  }

  // 重置到第 1 页
  function reset() {
    setPage(1);
  }

  return { page, pageSize, onChange, reset };
}
```

`src/hooks/useCountdown.ts`：

```ts
import { useEffect, useRef, useState } from 'react';
import { serverNow } from '@/lib/server-clock';

// 基于服务端时间的倒计时：返回剩余毫秒，到期只触发一次回调
export function useCountdown(
  deadlineAt: string | null | undefined,
  onExpire?: () => void,
): number {
  const [remainingMs, setRemainingMs] = useState(0);
  const expiredRef = useRef(false);
  const onExpireRef = useRef(onExpire);

  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    expiredRef.current = false;
    if (!deadlineAt) {
      setRemainingMs(0);
      return;
    }
    const deadlineMs = new Date(deadlineAt).getTime();
    const tick = () => {
      const next = Math.max(0, deadlineMs - serverNow());
      setRemainingMs(next);
      if (next === 0 && !expiredRef.current) {
        expiredRef.current = true;
        onExpireRef.current?.();
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [deadlineAt]);

  return remainingMs;
}
```

`src/components/common/Countdown.tsx`：

```tsx
import { useCountdown } from '@/hooks/useCountdown';
import { formatCountdown } from '@/lib/datetime';

// 倒计时展示：HH:mm:ss
export function Countdown({
  deadlineAt,
  onExpire,
  prefix,
}: {
  deadlineAt: string;
  onExpire?: () => void;
  prefix?: string;
}) {
  const remainingMs = useCountdown(deadlineAt, onExpire);
  return (
    <span>
      {prefix}
      {formatCountdown(remainingMs)}
    </span>
  );
}
```

`src/hooks/usePermission.ts`：

```ts
import { useSessionStore } from '@/stores/session';

// 角色判断：仅用于展示，不作为安全边界
export function usePermission() {
  const user = useSessionStore((state) => state.user);
  const isAdmin = user?.role === 'admin';
  const isUser = user?.role === 'user';
  const can = (roles?: Array<'user' | 'admin'>) =>
    !!user && (!roles || roles.includes(user.role));
  return { user, isAdmin, isUser, can };
}
```

- [ ] **2.4 运行确认通过** — Expected: PASS。

## 任务 3：表格、确认与错误边界（TDD）

- [ ] **3.1 写失败测试**

`tests/components/app-table.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react';
import type { ColumnsType } from 'antd/es/table';
import { AppTable } from '@/components/common/AppTable';

interface Row { id: number; name: string }
const columns: ColumnsType<Row> = [{ title: '名称', dataIndex: 'name' }];
const data: Row[] = [{ id: 1, name: '课程A' }];

describe('AppTable', () => {
  it('渲染数据与总数', () => {
    render(
      <AppTable columns={columns} dataSource={data} rowKey="id" total={21} page={1} pageSize={20} onPageChange={vi.fn()} />,
    );
    expect(screen.getByText('课程A')).toBeInTheDocument();
    expect(screen.getByText('共 21 条')).toBeInTheDocument();
  });
  it('错误时显示重试', () => {
    const onRetry = vi.fn();
    render(
      <AppTable columns={columns} dataSource={[]} rowKey="id" total={0} page={1} pageSize={20} onPageChange={vi.fn()} error={new Error('boom')} onRetry={onRetry} />,
    );
    expect(screen.getByText('加载失败')).toBeInTheDocument();
    screen.getByRole('button', { name: '重试' }).click();
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
```

`tests/components/confirm-action.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp, Button } from 'antd';
import { ConfirmAction } from '@/components/common/ConfirmAction';

// 包一层 AntD App 以使用 modal
function renderConfirm(onConfirm: () => Promise<void>) {
  render(
    <AntdApp>
      <ConfirmAction title="确认删除？" onConfirm={onConfirm}>
        <Button>删除</Button>
      </ConfirmAction>
    </AntdApp>,
  );
}

describe('ConfirmAction', () => {
  it('取消不触发，确认触发一次', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    renderConfirm(onConfirm);
    await userEvent.click(screen.getByRole('button', { name: '删除' }));
    await userEvent.click(await screen.findByRole('button', { name: '取消' }));
    expect(onConfirm).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '删除' }));
    await userEvent.click(await screen.findByRole('button', { name: '确定' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
```

`tests/components/error-boundary.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';

// 抛错组件
function Boom(): never {
  throw new Error('boom');
}

describe('ErrorBoundary', () => {
  it('兜底展示并保留 requestId', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('页面出错了')).toBeInTheDocument();
  });
});
```

- [ ] **3.2 运行确认失败** — Expected: FAIL。

- [ ] **3.3 实现**

`src/components/common/AppTable.tsx`：

```tsx
import { Button, Table, type TableProps } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { Key } from 'react';
import { EmptyState } from './EmptyState';

// 通用表格：分页、加载、空态、错误重试
export function AppTable<T extends object>({
  columns,
  dataSource,
  rowKey,
  total,
  page,
  pageSize,
  loading,
  error,
  onRetry,
  onPageChange,
  emptyText = '暂无数据',
}: {
  columns: ColumnsType<T>;
  dataSource: T[];
  rowKey: keyof T | ((row: T) => Key);
  total: number;
  page: number;
  pageSize: number;
  loading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  onPageChange: (page: number, pageSize: number) => void;
  emptyText?: string;
}) {
  if (error) {
    return (
      <EmptyState
        description="加载失败"
        action={
          <Button onClick={onRetry} disabled={!onRetry}>
            重试
          </Button>
        }
      />
    );
  }

  // AntD rowKey 类型与联合类型对齐
  const tableRowKey = rowKey as TableProps<T>['rowKey'];

  return (
    <Table<T>
      rowKey={tableRowKey}
      columns={columns}
      dataSource={dataSource}
      loading={loading}
      locale={{ emptyText: <EmptyState description={emptyText} /> }}
      pagination={{
        current: page,
        pageSize,
        total,
        showSizeChanger: true,
        pageSizeOptions: [10, 20, 50, 100],
        showTotal: (count) => `共 ${count} 条`,
        onChange: onPageChange,
      }}
    />
  );
}
```

`src/components/common/ConfirmAction.tsx`：

```tsx
import { App as AntdApp } from 'antd';
import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react';

// 触发器可接受的属性
interface TriggerProps {
  onClick?: () => void;
  disabled?: boolean;
}

// 二次确认：取消不回调；确认期间由 Modal 自动 loading
export function ConfirmAction({
  title,
  content,
  okText = '确定',
  cancelText = '取消',
  danger,
  disabled,
  onConfirm,
  children,
}: {
  title: string;
  content?: ReactNode;
  okText?: string;
  cancelText?: string;
  danger?: boolean;
  disabled?: boolean;
  onConfirm: () => Promise<void> | void;
  children: ReactElement<TriggerProps>;
}) {
  const { modal, message } = AntdApp.useApp();

  // 打开确认框
  function open() {
    modal.confirm({
      title,
      content,
      okText,
      cancelText,
      okButtonProps: { danger },
      onOk: async () => {
        try {
          await onConfirm();
        } catch (error) {
          message.error(error instanceof Error ? error.message : '操作失败');
          throw error;
        }
      },
    });
  }

  if (!isValidElement(children)) return null;
  return cloneElement(children, {
    onClick: open,
    disabled: disabled || children.props.disabled,
  });
}
```

`src/components/common/ErrorBoundary.tsx`：

```tsx
import { Button, Result } from 'antd';
import { Component, type PropsWithChildren } from 'react';
import { ApiError } from '@/api/errors';

// 路由级错误边界：展示错误摘要、requestId 与重试
export class ErrorBoundary extends Component<PropsWithChildren, { error: Error | null }> {
  state = { error: null as Error | null };

  // 捕获子组件渲染错误
  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      const requestId =
        this.state.error instanceof ApiError ? this.state.error.requestId : undefined;
      return (
        <Result
          status="error"
          title="页面出错了"
          subTitle={requestId ? `请求编号：${requestId}` : '请稍后重试'}
          extra={
            <Button type="primary" onClick={() => window.location.reload()}>
              重试
            </Button>
          }
        />
      );
    }
    return this.props.children;
  }
}
```

- [ ] **3.4 运行确认通过** — Expected: PASS。

## 任务 4：富文本展示、图片 key 回写与表格截断（TDD）

- [ ] **4.1 写失败测试** `tests/components/rich-text.test.tsx`

```tsx
import { render, screen } from '@testing-library/react';
import { RichTextViewer } from '@/components/common/RichTextViewer';
import { serializeRichHtmlForSave, truncateRichTables } from '@/lib/sanitize';

describe('rich text', () => {
  it('展示端再次净化', () => {
    render(<RichTextViewer html={'<p onclick="x()">正文</p><script>alert(1)</script>'} />);
    expect(screen.getByText('正文')).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
  });
  it('保存前图片 src 回写为 data-key', () => {
    const html = '<img src="https://signed/a" data-key="covers/a.png" alt="a">';
    const output = serializeRichHtmlForSave(html);
    expect(output).toContain('src="covers/a.png"');
    expect(output).toContain('data-key="covers/a.png"');
  });
  it('表格超过 20×20 截断', () => {
    const cell = '<td>x</td>';
    const row = `<tr>${cell.repeat(25)}</tr>`;
    const output = truncateRichTables(`<table>${row.repeat(25)}</table>`);
    const parsed = new DOMParser().parseFromString(output, 'text/html');
    expect(parsed.querySelectorAll('tr')).toHaveLength(20);
    expect(parsed.querySelectorAll('tr')[0].children).toHaveLength(20);
  });
});
```

- [ ] **4.2 运行确认失败** — Expected: FAIL。

- [ ] **4.3 实现 `src/components/common/RichTextViewer.tsx` 并扩展 `src/lib/sanitize.ts`**

`src/components/common/RichTextViewer.tsx`：

```tsx
import { useMemo } from 'react';
import { sanitizeRichHtml } from '@/lib/sanitize';

// 富文本展示：后端已净化，前端再用白名单过滤一次
export function RichTextViewer({ html, className }: { html: string; className?: string }) {
  const cleanHtml = useMemo(() => sanitizeRichHtml(html), [html]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: cleanHtml }} />;
}
```

`src/lib/sanitize.ts` 追加：

```ts
// 表格截断：最多 maxRows 行、maxCols 列（与设计框架 §11 一致）
export function truncateRichTables(html: string, maxRows = 20, maxCols = 20): string {
  const documentNode = new DOMParser().parseFromString(html, 'text/html');
  documentNode.querySelectorAll('table').forEach((table) => {
    Array.from(table.querySelectorAll('tr'))
      .slice(maxRows)
      .forEach((row) => row.remove());
    Array.from(table.querySelectorAll('tr')).forEach((row) => {
      Array.from(row.children)
        .slice(maxCols)
        .forEach((cell) => cell.remove());
    });
  });
  return documentNode.body.innerHTML;
}
```

把 `serializeRichHtmlForSave` 改为先截断表格再回写图片：

```ts
// 保存前序列化：表格截断 + 图片 src 回写为 key
export function serializeRichHtmlForSave(html: string): string {
  const documentNode = new DOMParser().parseFromString(truncateRichTables(html), 'text/html');
  documentNode.querySelectorAll('img[data-key]').forEach((image) => {
    const key = image.getAttribute('data-key');
    if (key) image.setAttribute('src', key);
  });
  return document.body.innerHTML;
}
```

- [ ] **4.4 实现 `src/components/common/RichTextEditor.tsx` 与 `src/api/files.ts`**

`src/api/files.ts`：

```ts
import { request } from './client';

// 上传返回：key 持久化，url 仅用于即时预览
export interface UploadResult {
  key: string;
  url: string;
}

// 图片上传：PNG/JPEG/WebP，单张 ≤2MB 由前端预检 + 后端复核
export function uploadImage(file: File): Promise<UploadResult> {
  const formData = new FormData();
  formData.append('file', file);
  return request<UploadResult>({ url: '/files/upload', method: 'POST', data: formData });
}
```

`src/components/common/RichTextEditor.tsx`：

```tsx
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Table from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { App as AntdApp, Button, Space } from 'antd';
import { useEffect, useRef } from 'react';
import { uploadImage, type UploadResult } from '@/api/files';
import { isAllowedImage } from '@/lib/validators';
import { sanitizeRichHtml, serializeRichHtmlForSave } from '@/lib/sanitize';

// 带 data-key 的图片扩展：保存 key，展示签名 URL
const KeyedImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      'data-key': {
        default: null,
        parseHTML: (element) => element.getAttribute('data-key'),
        renderHTML: (attributes) =>
          attributes['data-key'] ? { 'data-key': attributes['data-key'] } : {},
      },
    };
  },
});

// 富文本编辑器：标题/加粗/斜体/列表/链接/图片/表格
export function RichTextEditor({
  value,
  onChange,
  placeholder = '请输入内容',
  disabled,
  onUploadImage = uploadImage,
}: {
  value?: string;
  onChange?: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
  onUploadImage?: (file: File) => Promise<UploadResult>;
}) {
  const { message } = AntdApp.useApp();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
      KeyedImage,
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      Placeholder.configure({ placeholder }),
    ],
    content: value ?? '',
    editable: !disabled,
    editorProps: {
      // Word 粘贴：保留语义结构并清理 Office 标记/不安全内容
      transformPastedHTML: (html) => sanitizeRichHtml(html),
    },
    onUpdate: ({ editor: instance }) => {
      onChange?.(serializeRichHtmlForSave(instance.getHTML()));
    },
  });

  useEffect(() => {
    if (editor && value !== undefined && editor.getHTML() !== value) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [editor, value]);

  // 选择图片：预检类型/大小后上传，插入带 key 的图片
  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!isAllowedImage(file)) {
      message.error('图片仅支持 PNG/JPEG/WebP，且不超过 2MB');
      return;
    }
    try {
      const result = await onUploadImage(file);
      editor?.chain().focus().insertContent({
        type: 'image',
        attrs: { src: result.url, 'data-key': result.key, alt: file.name },
      }).run();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '图片上传失败');
    }
  }

  if (!editor) return null;

  return (
    <div style={{ border: '1px solid #ebedf0', borderRadius: 6 }}>
      <Space wrap style={{ padding: 8, borderBottom: '1px solid #ebedf0' }}>
        <Button size="small" type={editor.isActive('bold') ? 'primary' : 'default'} onClick={() => editor.chain().focus().toggleBold().run()}>加粗</Button>
        <Button size="small" type={editor.isActive('italic') ? 'primary' : 'default'} onClick={() => editor.chain().focus().toggleItalic().run()}>斜体</Button>
        <Button size="small" type={editor.isActive('bulletList') ? 'primary' : 'default'} onClick={() => editor.chain().focus().toggleBulletList().run()}>列表</Button>
        <Button size="small" type={editor.isActive('orderedList') ? 'primary' : 'default'} onClick={() => editor.chain().focus().toggleOrderedList().run()}>编号</Button>
        <Button size="small" onClick={() => { const href = window.prompt('请输入链接地址'); if (href) editor.chain().focus().setLink({ href }).run(); }}>链接</Button>
        <Button size="small" onClick={() => fileInputRef.current?.click()}>图片</Button>
        <Button size="small" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>表格</Button>
      </Space>
      <div style={{ padding: 12, minHeight: 160 }}>
        <EditorContent editor={editor} />
      </div>
      <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={handleFileChange} />
    </div>
  );
}
```

- [ ] **4.5 运行确认通过** — Expected: PASS。

## 任务 5：图片上传组件

- [ ] **5.1 实现 `src/components/common/ImageUploader.tsx`**

```tsx
import { App as AntdApp, Avatar, Button, Space, Upload } from 'antd';
import type { UploadProps } from 'antd';
import { uploadImage } from '@/api/files';
import { isAllowedImage } from '@/lib/validators';
import { resolveImageUrl } from '@/lib/image-url';

// 表单中的图片值：key 用于提交，url 仅用于预览
export interface ImageValue {
  key: string;
  url?: string | null;
}

// 图片上传：预检类型/大小；表单只提交 key
export function ImageUploader({
  value,
  onChange,
  disabled,
}: {
  value?: ImageValue | null;
  onChange?: (value: ImageValue | null) => void;
  disabled?: boolean;
}) {
  const { message } = AntdApp.useApp();
  const previewUrl = value?.url ?? resolveImageUrl(value?.key, null);

  // 上传前预检并立刻上传；返回 false 阻止 AntD 默认上传
  const beforeUpload: UploadProps['beforeUpload'] = async (file) => {
    if (!isAllowedImage(file)) {
      message.error('图片仅支持 PNG/JPEG/WebP，且不超过 2MB');
      return Upload.LIST_IGNORE;
    }
    try {
      const result = await uploadImage(file);
      onChange?.({ key: result.key, url: result.url });
    } catch (error) {
      message.error(error instanceof Error ? error.message : '图片上传失败');
    }
    return false;
  };

  return (
    <Space align="start">
      <Avatar shape="square" size={96} src={previewUrl} />
      <Space direction="vertical">
        <Upload
          accept="image/png,image/jpeg,image/webp"
          showUploadList={false}
          beforeUpload={beforeUpload}
          disabled={disabled}
        >
          <Button disabled={disabled}>{value?.key ? '更换图片' : '上传图片'}</Button>
        </Upload>
        {value?.key && (
          <Button type="link" danger disabled={disabled} onClick={() => onChange?.(null)}>
            清除
          </Button>
        )}
      </Space>
    </Space>
  );
}
```

- [ ] **5.2 类型检查与提交**

Run: `cd frontend && npm run typecheck && npm test`
Expected: PASS。

```bash
git add frontend/src/components/common frontend/src/hooks/usePagination.ts frontend/src/hooks/usePermission.ts frontend/src/hooks/useCountdown.ts frontend/src/api/files.ts frontend/src/lib/sanitize.ts frontend/tests/components frontend/tests/hooks
git commit -m "feat(frontend): common components and shared hooks"
```

## 完成标准复核

- [ ] 本机：`npm run lint`、`npm run typecheck`、`npm test` 全通过。
- [ ] 单测覆盖：金额输入分转换、原价删除线、状态领域映射、倒计时只回调一次、分页越界回退、表格分页与错误重试、确认取消不回调、错误边界、富文本净化/图片 key 回写/表格 20×20 截断。
- [ ] 富文本编辑器完整交互（输入、加粗、插入图片/表格）需在浏览器手工验证；单测只覆盖纯逻辑，未覆盖部分在交付记录注明。
