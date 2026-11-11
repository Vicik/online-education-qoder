import { Alert, App as AntdApp, Button, Card, Descriptions, Select, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ApiError } from '@/api/errors';
import { listMyCoupons } from '@/api/promotion';
import { createOrder, getCheckoutPreview, getOrder, payOrder } from '@/api/trade';
import { queryKeys } from '@/api/query-keys';
import type { CheckoutPreviewData, Order, OrderCreateRequest } from '@/api/types';
import { ConfirmAction } from '@/components/common/ConfirmAction';
import { EmptyState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/common/PageHeader';
import { formatCents } from '@/lib/money';
import { useIdempotentMutation } from '@/hooks/useIdempotentMutation';

// 金额明细展示
function PriceBreakdown({ preview }: { preview: Order | CheckoutPreviewData }) {
  return (
    <Descriptions column={1} bordered size="small">
      <Descriptions.Item label="原价">{formatCents(preview.originalCents ?? 0)}</Descriptions.Item>
      <Descriptions.Item label="当前价">{formatCents(preview.currentCents ?? 0)}</Descriptions.Item>
      <Descriptions.Item label="优惠">-{formatCents(preview.discountCents ?? 0)}</Descriptions.Item>
      <Descriptions.Item label="实付">
        <Typography.Text strong type="danger">
          {formatCents(preview.paidCents ?? 0)}
        </Typography.Text>
      </Descriptions.Item>
    </Descriptions>
  );
}

// 结算页：服务端计价；拼团/秒杀传 orderId 时只支付既有订单
export default function CheckoutPage() {
  // 路由课程 id
  const { courseId: rawCourseId } = useParams();
  // 解析后的课程 id
  const courseId = Number(rawCourseId);
  // 查询参数
  const [searchParams] = useSearchParams();
  // 既有待支付订单 id（拼团/秒杀预创建）
  const existingOrderId = Number(searchParams.get('orderId')) || null;
  // 选中的券领取记录 id
  const [couponId, setCouponId] = useState<number | undefined>();
  // 提交后的业务错误（库存/限购等内联提示）
  const [submitError, setSubmitError] = useState<string | null>(null);
  // 已购买标记：展示去学习入口
  const [duplicatePurchase, setDuplicatePurchase] = useState(false);
  // 跳转
  const navigate = useNavigate();
  // QueryClient
  const queryClient = useQueryClient();
  // AntD message
  const { message } = AntdApp.useApp();

  // 价格预览（普通模式）
  const previewQuery = useQuery({
    queryKey: queryKeys.checkout(courseId, JSON.stringify({ couponId })),
    queryFn: () => getCheckoutPreview(courseId, { couponId }),
    enabled: !existingOrderId && Number.isInteger(courseId) && courseId > 0,
    retry: false,
  });
  // 既有订单（订单模式）
  const orderQuery = useQuery({
    queryKey: queryKeys.order(existingOrderId ?? 0),
    queryFn: () => getOrder(existingOrderId as number),
    enabled: existingOrderId !== null,
  });
  // 可用券：仅未使用且适用于本课程
  const couponsQuery = useQuery({
    queryKey: queryKeys.myCoupons('unused', 1),
    queryFn: () => listMyCoupons('unused', 1, 100),
    enabled: existingOrderId === null,
  });

  // 创建订单（幂等）
  const createMutation = useIdempotentMutation(
    (payload: OrderCreateRequest, idempotencyKey: string) => createOrder(payload, idempotencyKey),
  );
  // 模拟支付
  const payMutation = useMutation({ mutationFn: payOrder });

  // 当前展示的金额来源
  const amountSource = existingOrderId !== null ? orderQuery.data : previewQuery.data;
  // 是否可提交
  const payable =
    amountSource !== undefined &&
    (existingOrderId !== null ? orderQuery.data?.status === 'pending' : true);
  // 实付金额
  const paidCents = amountSource?.paidCents ?? 0;
  // 按钮文案：0 元为确认报名
  const submitLabel = paidCents === 0 ? '确认报名' : '确认支付';

  // 适用的券选项
  const couponOptions =
    couponsQuery.data?.items
      .filter((coupon) => coupon.id !== undefined && coupon.courseIds?.includes(courseId))
      .map((coupon) => ({
        value: coupon.id as number,
        label: `${coupon.templateName ?? ''}（立减 ${formatCents(coupon.discountCents ?? 0)}）`,
      })) ?? [];

  // 提交：创建（或取既有）订单后支付
  async function handleSubmit(): Promise<void> {
    setSubmitError(null);
    try {
      // 待支付订单
      let order: Order;
      if (existingOrderId !== null) {
        if (!orderQuery.data) {
          setSubmitError('订单加载失败，请刷新重试');
          return;
        }
        order = orderQuery.data;
      } else {
        order = await createMutation.mutateAsync({
          courseId,
          activityType: previewQuery.data?.activityType ?? 'normal',
          activityId: previewQuery.data?.activityId ?? null,
          couponClaimId: couponId ?? null,
        });
      }

      // 订单 id 用于支付与跳转
      const orderId = order.id;
      if (orderId === undefined) {
        setSubmitError('订单信息异常，请稍后重试');
        return;
      }

      await payMutation.mutateAsync(orderId);
      queryClient.invalidateQueries({ queryKey: queryKeys.myOrders(1) });
      queryClient.invalidateQueries({ queryKey: queryKeys.overview });
      queryClient.invalidateQueries({ queryKey: queryKeys.myCoupons('unused', 1) });
      navigate(`/order/${orderId}/result`, { replace: true });
    } catch (error) {
      if (!(error instanceof ApiError)) {
        setSubmitError('支付失败，请稍后重试');
        return;
      }
      if (error.code === 4003) {
        setDuplicatePurchase(true);
        message.error('您已购买该课程');
        return;
      }
      if (error.code === 4002) {
        message.warning('优惠券不可用，已刷新价格');
        setCouponId(undefined);
        return;
      }
      if (error.code === 4001 || error.code === 5003) {
        setSubmitError(error.message);
        return;
      }
      if (error.code === 4004) {
        message.info('请勿重复提交');
        return;
      }
      setSubmitError(error.message);
    }
  }

  if (previewQuery.error && !existingOrderId) {
    return <EmptyState description={previewQuery.error.message} />;
  }

  if (!amountSource) {
    return <Card loading />;
  }

  if (duplicatePurchase) {
    return (
      <EmptyState
        description="您已购买该课程"
        action={
          <Link to={`/learning/${courseId}`}>
            <Button type="primary">去学习</Button>
          </Link>
        }
      />
    );
  }

  if (existingOrderId !== null && orderQuery.data && orderQuery.data.status !== 'pending') {
    return (
      <EmptyState
        description="该订单已处理"
        action={<Link to={`/order/${existingOrderId}/result`}>查看支付结果</Link>}
      />
    );
  }

  return (
    <div>
      <PageHeader title="确认订单" />
      <Card style={{ maxWidth: 640 }}>
        <Typography.Title level={5}>{orderQuery.data?.courseName ?? '课程订单'}</Typography.Title>
        <PriceBreakdown preview={amountSource} />

        {existingOrderId === null && (
          <div style={{ marginTop: 16 }}>
            <Typography.Text>优惠券</Typography.Text>
            <Select
              allowClear
              style={{ width: '100%', marginTop: 8 }}
              placeholder="不使用优惠券"
              value={couponId}
              onChange={(value) => setCouponId(value)}
              options={couponOptions}
            />
          </div>
        )}

        {submitError && <Alert type="error" showIcon message={submitError} style={{ marginTop: 16 }} />}

        <div style={{ marginTop: 24, textAlign: 'right' }}>
          <ConfirmAction
            title={`${submitLabel} ${formatCents(paidCents)}？`}
            content="支付为模拟支付，确认后将立即完成订单。"
            okText="确定"
            onConfirm={handleSubmit}
            disabled={!payable || createMutation.isPending || payMutation.isPending}
          >
            <Button
              type="primary"
              size="large"
              disabled={!payable}
              loading={createMutation.isPending || payMutation.isPending}
            >
              {submitLabel}
            </Button>
          </ConfirmAction>
        </div>
      </Card>
    </div>
  );
}
