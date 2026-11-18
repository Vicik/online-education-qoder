import { useEffect, useState } from 'react';
import { App, Button, Select, Space, Tooltip } from 'antd';
import { Link, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listAdminCourses,
  listPromotionCourses,
  promoteCourse,
  publishCourse,
  recommendCourse,
  reorderPromotion,
  unpublishCourse,
  unrecommendCourse,
  unpromoteCourse,
} from '@/api/admin/courses';
import { queryKeys } from '@/api/query-keys';
import type { AdminCourseListItem, CourseStatus } from '@/api/types';
import { AppTable } from '@/components/common/AppTable';
import { ConfirmAction } from '@/components/common/ConfirmAction';
import { MoneyText } from '@/components/common/MoneyText';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusTag } from '@/components/common/StatusTag';
import { usePagination } from '@/hooks/usePagination';
import {
  PROMOTION_LIMIT,
  PromotionOrderBar,
} from './PromotionOrderBar';

// 列表每页数量
const PAGE_SIZE = 10;

// 状态筛选项：all 表示不传 status
const STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'draft', label: '草稿' },
  { value: 'published', label: '已发布' },
  { value: 'unpublished', label: '已下架' },
];

// 课程列表：状态筛选、分页与工作区入口
export default function CourseListPage() {
  // 路由跳转
  const navigate = useNavigate();
  // AntD 消息提示
  const { message } = App.useApp();
  // 缓存客户端：写操作成功后失效课程相关查询
  const queryClient = useQueryClient();
  // 当前状态筛选
  const [status, setStatus] = useState<CourseStatus | 'all'>('all');
  // 当前总数（分页入参）
  const [total, setTotal] = useState(0);
  // 页码与页大小
  const { page, pageSize, onChange } = usePagination(total, PAGE_SIZE);

  // 课程列表查询：状态与分页共同决定缓存键
  const query = useQuery({
    queryKey: queryKeys.adminCourses(`${page}:${pageSize}:${status}`),
    queryFn: () =>
      listAdminCourses(page, pageSize, status === 'all' ? undefined : status),
  });

  // 执行发布/下架/推荐/宣传操作：成功后提示并刷新受影响的缓存
  async function runCourseAction(
    courseId: number,
    action: () => Promise<unknown>,
    successText: string,
  ) {
    await action();
    message.success(successText);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin', 'courses'] }),
      queryClient.invalidateQueries({ queryKey: ['courses'] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.course(courseId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.homeLatest }),
      queryClient.invalidateQueries({ queryKey: queryKeys.homeRecommendations }),
      queryClient.invalidateQueries({ queryKey: queryKeys.homeBanners }),
    ]);
  }

  // 宣传位列表查询：排序条数据源，同时用于判断宣传位是否已满
  const promotion = useQuery({
    queryKey: queryKeys.adminCoursePromotion,
    queryFn: listPromotionCourses,
  });
  // 当前宣传课程（按序号升序）：契约字段可选，仅保留 id 与名称齐全的行
  const promotionItems = (promotion.data ?? []).flatMap((item) =>
    item.id === undefined || item.name === undefined
      ? []
      : [{ id: item.id, name: item.name }],
  );
  // 宣传位是否已满：满员时未宣传的课程不可再加入
  const isPromotionFull = promotionItems.length >= PROMOTION_LIMIT;

  // 移动宣传位：本地换序后整序提交
  async function movePromotion(from: number, to: number) {
    // 当前顺序的课程 id 列表
    const orderedIds = promotionItems.map((item) => item.id);
    // 交换后的新顺序
    const nextIds = [...orderedIds];
    // 被移动的课程 id
    const [movedId] = nextIds.splice(from, 1);
    nextIds.splice(to, 0, movedId);

    await reorderPromotion(nextIds);
    message.success('宣传位顺序已更新');
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.adminCoursePromotion }),
      queryClient.invalidateQueries({ queryKey: queryKeys.homeBanners }),
    ]);
  }

  // 预览：新标签页打开独立的管理端预览页
  function openPreview(courseId: number) {
    window.open(`/admin/courses/${courseId}/preview`, '_blank', 'noopener,noreferrer');
  }

  // 同步后端总数
  useEffect(() => {
    if (query.data) setTotal(query.data.total);
  }, [query.data]);

  // 表格列
  const columns = [
    {
      title: '课程名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: AdminCourseListItem) => (
        <Link to={`/admin/courses/${record.id}`}>{name}</Link>
      ),
    },
    {
      title: '讲师',
      dataIndex: 'instructor',
      key: 'instructor',
      render: (value: string | null) => value ?? '—',
    },
    {
      title: '售价',
      dataIndex: 'saleCents',
      key: 'saleCents',
      render: (value: number) => <MoneyText cents={value} />,
    },
    { title: '报名人数', dataIndex: 'enrollmentCount', key: 'enrollmentCount' },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (value: CourseStatus) => <StatusTag domain="course" status={value} />,
    },
    { title: '章节数', dataIndex: 'chapterCount', key: 'chapterCount' },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: AdminCourseListItem) => {
        // 列表项必有 id，缺省时不渲染操作
        const courseId = record.id;
        if (!courseId) return null;
        return (
        <Space size={4} wrap>
          <Link to={`/admin/courses/${courseId}`}>管理</Link>
          <Button
            type="link"
            size="small"
            autoInsertSpace={false}
            onClick={() => openPreview(courseId)}
          >
            预览
          </Button>
          {record.status === 'published' ? (
            <ConfirmAction
              title="下架课程"
              content={`下架后学员将无法购买《${record.name}》，同时移出首页推荐位与宣传位，确定下架？`}
              danger
              onConfirm={() =>
                runCourseAction(courseId, () => unpublishCourse(courseId), '课程已下架')
              }
            >
              <Button type="link" size="small" autoInsertSpace={false} danger>
                下架
              </Button>
            </ConfirmAction>
          ) : record.chapterCount === 0 ? (
            // 无章节不可发布：禁用按钮并在悬浮时说明原因
            <Tooltip title="请先添加至少一个章节，再发布课程">
              <span style={{ cursor: 'not-allowed' }}>
                <Button type="link" size="small" autoInsertSpace={false} disabled>
                  发布
                </Button>
              </span>
            </Tooltip>
          ) : (
            <ConfirmAction
              title="发布课程"
              content={`发布后学员即可浏览与购买《${record.name}》，确定发布？`}
              onConfirm={() =>
                runCourseAction(courseId, () => publishCourse(courseId), '课程已发布')
              }
            >
              <Button type="link" size="small" autoInsertSpace={false}>
                发布
              </Button>
            </ConfirmAction>
          )}
          {record.status === 'published' &&
            (record.isRecommended ? (
              <ConfirmAction
                title="取消推荐"
                content={`取消后《${record.name}》将不再出现在首页推荐位，确定取消？`}
                onConfirm={() =>
                  runCourseAction(courseId, () => unrecommendCourse(courseId), '已取消推荐')
                }
              >
                <Button type="link" size="small" autoInsertSpace={false}>
                  取消推荐
                </Button>
              </ConfirmAction>
            ) : (
              <ConfirmAction
                title="设为推荐"
                content={`推荐后《${record.name}》会出现在首页推荐位，确定推荐？`}
                onConfirm={() =>
                  runCourseAction(courseId, () => recommendCourse(courseId), '已设为推荐')
                }
              >
                <Button type="link" size="small" autoInsertSpace={false}>
                  推荐
                </Button>
              </ConfirmAction>
            ))}
          {record.status === 'published' &&
            (record.isPromoted ? (
              <ConfirmAction
                title="取消宣传"
                content={`取消后《${record.name}》的封面将不再出现在首页 banner，确定取消？`}
                onConfirm={() =>
                  runCourseAction(courseId, () => unpromoteCourse(courseId), '已取消宣传')
                }
              >
                <Button type="link" size="small" autoInsertSpace={false}>
                  取消宣传
                </Button>
              </ConfirmAction>
            ) : isPromotionFull ? (
              // 宣传位已满：禁用按钮并在悬浮时说明原因
              <Tooltip title="首页宣传位最多 5 门课程，请先取消其他课程的宣传">
                <span style={{ cursor: 'not-allowed' }}>
                  <Button type="link" size="small" autoInsertSpace={false} disabled>
                    宣传
                  </Button>
                </span>
              </Tooltip>
            ) : (
              <ConfirmAction
                title="设为宣传"
                content={`宣传后《${record.name}》的封面会进入首页 banner，确定宣传？`}
                onConfirm={() =>
                  runCourseAction(courseId, () => promoteCourse(courseId), '已设为宣传')
                }
              >
                <Button type="link" size="small" autoInsertSpace={false}>
                  宣传
                </Button>
              </ConfirmAction>
            ))}
        </Space>
        );
      },
    },
  ];

  // 切换状态并回到第一页
  function handleStatusChange(next: CourseStatus | 'all') {
    setStatus(next);
    onChange(1, pageSize);
  }

  return (
    <div>
      <PageHeader
        title="课程管理"
        extra={
          <Space>
            <Select
              aria-label="状态筛选"
              value={status}
              options={STATUS_OPTIONS}
              style={{ width: 140 }}
              onChange={handleStatusChange}
            />
            <Button type="primary" onClick={() => navigate('/admin/courses/create')}>
              创建课程
            </Button>
          </Space>
        }
      />
      <PromotionOrderBar
        items={promotionItems}
        onMove={(from, to) => void movePromotion(from, to)}
      />
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
        emptyText="还没有课程"
      />
    </div>
  );
}
