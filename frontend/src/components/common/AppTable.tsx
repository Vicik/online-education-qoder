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
