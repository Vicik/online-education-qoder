import { useNavigate, useParams } from 'react-router';
import { App as AntdApp, Button, Card, List, Space, Typography } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiError } from '@/api/errors';
import {
  createGrouponGroup,
  getGroupon,
  joinGrouponGroup,
} from '@/api/promotion';
import { queryKeys } from '@/api/query-keys';
import type { GrouponGroup, Order } from '@/api/types';
import { ConfirmAction } from '@/components/common/ConfirmAction';
import { Countdown } from '@/components/common/Countdown';
import { EmptyState } from '@/components/common/EmptyState';
import { MoneyText } from '@/components/common/MoneyText';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusTag } from '@/components/common/StatusTag';
import { useIdempotentMutation } from '@/hooks/useIdempotentMutation';
import { usePermission } from '@/hooks/usePermission';
import { formatCents } from '@/lib/money';

// 开团/参团的返回结构
interface GrouponOrderResult {
  order: Order; // 待支付订单
  group: GrouponGroup; // 团组信息
}

// 拼团详情：活动信息、待成团团组、开团/参团
export default function GrouponDetailPage() {
  // 路由参数
  const params = useParams();
  // 活动 id
  const activityId = Number(params.id);
  // 路由跳转
  const navigate = useNavigate();
  // 查询缓存
  const queryClient = useQueryClient();
  // 当前用户
  const { user } = usePermission();
  // AntD 消息提示（静态 message 无法消费 App 上下文）
  const { message } = AntdApp.useApp();

  // 活动详情（含待成团团组）
  const query = useQuery({
    queryKey: queryKeys.groupon(activityId),
    queryFn: () => getGroupon(activityId),
    enabled: Number.isInteger(activityId) && activityId > 0,
  });

  // 失败提示并按错误码刷新详情
  const handleError = (error: ApiError) => {
    // 已参与（409 + 5001）
    if (error.status === 409 && error.code === 5001) {
      message.warning('您已参与过该拼团活动');
    } else if (error.code === 5002) {
      // 活动未开始或已结束
      message.warning('拼团活动未开始或已结束');
    } else if (error.code === 5001) {
      // 团满（422 + 5001）
      message.warning('该团已满或已结束');
    } else if (error.code === 4004) {
      // 幂等冲突：上一次请求仍在处理
      message.warning('请求正在处理中，请稍后重试');
    } else {
      message.error(error.message);
    }
    void query.refetch();
  };

  // 开团/参团共用幂等提交；groupId 为 null 表示开团
  const mutation = useIdempotentMutation<
    GrouponOrderResult,
    { groupId: number | null }
  >(
    (vars, key) =>
      vars.groupId === null
        ? createGrouponGroup(activityId, key)
        : joinGrouponGroup(activityId, vars.groupId, key),
    {
      onSuccess: ({ order }) => {
        // 团组与活动数据已变化，失效详情与列表
        void queryClient.invalidateQueries({ queryKey: queryKeys.groupon(activityId) });
        void queryClient.invalidateQueries({ queryKey: ['groupons'] });
        // 进入既有订单支付模式
        navigate(`/checkout/${order.courseId}?orderId=${order.id}`);
      },
      onError: handleError,
    },
  );

  // 游客：跳登录并回跳详情
  const gotoLogin = () => {
    navigate(`/login?redirect=${encodeURIComponent(`/groupons/${activityId}`)}`);
  };

  if (query.isLoading) return <Card loading />;
  if (query.error || !query.data) {
    return (
      <EmptyState
        description="拼团活动不存在"
        action={<Button onClick={() => navigate('/groupons')}>返回拼团列表</Button>}
      />
    );
  }

  // 活动详情
  const detail = query.data;
  // 是否可参与（后端只返回进行中活动；此处用状态兜底）
  const joinable = detail.status === 'ongoing';
  // 待成团团组
  const groups = detail.groups;
  // 拼团价（分）
  const priceCents = detail.priceCents ?? 0;
  // 成团人数
  const targetSize = detail.targetSize ?? 0;

  return (
    <div>
      <PageHeader
        title={detail.name ?? ''}
        extra={<StatusTag domain="groupon" status={detail.status ?? ''} />}
      />
      <Card style={{ marginBottom: 16 }}>
        <Space direction="vertical" size={8}>
          <Typography.Text type="secondary">{detail.courseName ?? ''}</Typography.Text>
          <MoneyText cents={priceCents} size="large" />
          <Typography.Text type="secondary">{targetSize} 人成团</Typography.Text>
          <Countdown
            deadlineAt={detail.endAt ?? ''}
            prefix="距活动结束"
            onExpire={() => void query.refetch()}
          />
          {user ? (
            <ConfirmAction
              title="发起拼团"
              content={`确认以 ${formatCents(priceCents)} 发起新团？支付成功后计入成团人数。`}
              onConfirm={async () => {
                try {
                  await mutation.mutateAsync({ groupId: null });
                } catch {
                  // 错误已由 onError 提示
                }
              }}
            >
              <Button type="primary" disabled={!joinable} loading={mutation.isPending}>
                发起新团
              </Button>
            </ConfirmAction>
          ) : (
            <Button type="primary" onClick={gotoLogin}>发起新团</Button>
          )}
        </Space>
      </Card>

      <Card title="待成团团组">
        {groups.length === 0 ? (
          <EmptyState description="暂无可加入的团，发起新团吧" />
        ) : (
          <List
            dataSource={groups}
            renderItem={(group) => {
              // 已支付成员数
              const memberCount = group.memberCount ?? 0;
              // 团组成团人数
              const groupTargetSize = group.targetSize ?? 0;
              // 团是否已满
              const full = memberCount >= groupTargetSize;
              // 参团按钮是否禁用
              const disabled = !joinable || full || group.status !== 'pending';
              return (
                <List.Item
                  actions={[
                    user ? (
                      <ConfirmAction
                        key="join"
                        title="参与拼团"
                        content={`确认加入该团？还差 ${groupTargetSize - memberCount} 人成团。`}
                        onConfirm={async () => {
                          try {
                            await mutation.mutateAsync({ groupId: group.id ?? 0 });
                          } catch {
                            // 错误已由 onError 提示
                          }
                        }}
                      >
                        <Button
                          disabled={disabled}
                          loading={mutation.isPending}
                          autoInsertSpace={false}
                        >
                          参团
                        </Button>
                      </ConfirmAction>
                    ) : (
                      <Button key="login" onClick={gotoLogin} autoInsertSpace={false}>参团</Button>
                    ),
                  ]}
                >
                  <Space direction="vertical" size={2}>
                    <Typography.Text>
                      已支付 {memberCount}/{groupTargetSize} 人
                      {full ? '（已满）' : ''}
                    </Typography.Text>
                    <Countdown
                      deadlineAt={group.expiresAt ?? ''}
                      prefix="距结束"
                      onExpire={() => void query.refetch()}
                    />
                  </Space>
                </List.Item>
              );
            }}
          />
        )}
      </Card>
    </div>
  );
}
