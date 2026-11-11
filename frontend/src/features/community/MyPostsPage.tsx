import { useEffect, useState } from 'react';
import { Button, message } from 'antd';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnsType } from 'antd/es/table';
import { deletePost, listMyPosts } from '@/api/community';
import { queryKeys } from '@/api/query-keys';
import type { ApiError } from '@/api/errors';
import type { PostBrief } from '@/api/types';
import { AppTable } from '@/components/common/AppTable';
import { ConfirmAction } from '@/components/common/ConfirmAction';
import { PageHeader } from '@/components/common/PageHeader';
import { RichTextViewer } from '@/components/common/RichTextViewer';
import { usePagination } from '@/hooks/usePagination';
import { formatShanghai } from '@/lib/datetime';

// 我的帖子每页数量
const PAGE_SIZE = 10;

// 我的帖子：仅本人发布，可查看与删除
export default function MyPostsPage() {
  // 查询缓存
  const queryClient = useQueryClient();
  // 当前总数（分页入参）
  const [total, setTotal] = useState(0);
  // 页码与页大小
  const { page, pageSize, onChange } = usePagination(total, PAGE_SIZE);

  // 我的帖子查询
  const query = useQuery({
    queryKey: queryKeys.myPosts(page),
    queryFn: () => listMyPosts(page, pageSize),
  });

  // 同步后端总数
  useEffect(() => {
    if (query.data) setTotal(query.data.total);
  }, [query.data]);

  // 删除帖子
  const handleDelete = async (postId: number) => {
    try {
      await deletePost(postId);
      message.success('已删除');
      void queryClient.invalidateQueries({ queryKey: ['user', 'posts'] });
      void queryClient.invalidateQueries({ queryKey: ['posts'] });
    } catch (error) {
      message.error((error as ApiError).message);
    }
  };

  // 表格列
  const columns: ColumnsType<PostBrief> = [
    {
      title: '内容',
      dataIndex: 'content',
      key: 'content',
      render: (_: string, record: PostBrief) => (
        <div style={{ maxHeight: 80, overflow: 'hidden' }}>
          <RichTextViewer html={record.content ?? ''} />
        </div>
      ),
    },
    { title: '点赞', dataIndex: 'likeCount', key: 'likeCount' },
    { title: '评论', dataIndex: 'commentCount', key: 'commentCount' },
    {
      title: '发布时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (value: string) => formatShanghai(value),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: PostBrief) => (
        <>
          <Link to={`/community/${record.id}`}>查看</Link>
          <ConfirmAction
            title="删除帖子"
            content="删除后帖子与全部评论不可恢复，确认删除？"
            danger
            onConfirm={() => handleDelete(record.id ?? 0)}
          >
            <Button type="link" danger>
              删除
            </Button>
          </ConfirmAction>
        </>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="我的帖子" />
      <AppTable
        columns={columns}
        dataSource={query.data?.items ?? []}
        rowKey="id"
        total={total}
        page={page}
        pageSize={pageSize}
        loading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        onPageChange={onChange}
        emptyText="还没有发布过帖子"
      />
    </div>
  );
}
