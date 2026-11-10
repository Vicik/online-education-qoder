import { render, screen } from '@testing-library/react';
import type { ColumnsType } from 'antd/es/table';
import { AppTable } from '@/components/common/AppTable';

interface Row {
  id: number;
  name: string;
}
const columns: ColumnsType<Row> = [{ title: '名称', dataIndex: 'name' }];
const data: Row[] = [{ id: 1, name: '课程A' }];

describe('AppTable', () => {
  it('渲染数据与总数', () => {
    render(
      <AppTable
        columns={columns}
        dataSource={data}
        rowKey="id"
        total={21}
        page={1}
        pageSize={20}
        onPageChange={vi.fn()}
      />,
    );
    expect(screen.getByText('课程A')).toBeInTheDocument();
    expect(screen.getByText('共 21 条')).toBeInTheDocument();
  });
  it('错误时显示重试', () => {
    const onRetry = vi.fn();
    render(
      <AppTable
        columns={columns}
        dataSource={[]}
        rowKey="id"
        total={0}
        page={1}
        pageSize={20}
        onPageChange={vi.fn()}
        error={new Error('boom')}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText('加载失败')).toBeInTheDocument();
    screen.getByRole('button', { name: /重\s*试/ }).click();
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
