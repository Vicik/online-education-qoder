import { Alert, App as AntdApp, Button, Card } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { getCourseDetail } from '@/api/catalog';
import { ApiError } from '@/api/errors';
import { listMyCoupons } from '@/api/promotion';
import { createOrder, getCheckoutPreview, getOrder } from '@/api/trade';
import { queryKeys } from '@/api/query-keys';
import type { Order, OrderCreateRequest } from '@/api/types';
import { EmptyState } from '@/components/common/EmptyState';
import { courseTypeLabel } from '@/lib/course';
import { formatCents } from '@/lib/money';
import { useIdempotentMutation } from '@/hooks/useIdempotentMutation';
import { CheckoutFooter, CheckoutPayMethod, CheckoutProductRow } from './checkout-blocks';
import './CheckoutPage.css';

// 结算页：服务端计价；确认后创建订单并进入支付页
export default function CheckoutPage() {
  // 路由课程 id
  const { courseId: rawCourseId } = useParams();
  // 解析后的课程 id
  const courseId = Number(rawCourseId);
  // 查询参数
  const [searchParams] = useSearchParams();
  // 既有待支付订单 id（拼团/秒杀预创建）
  const existingOrderId = Number(searchParams.get('orderId')) || null;
  // 选中的券领取记录 id：从我的优惠券「立即使用」进入时由 query 预选
  const [couponId, setCouponId] = useState<number | undefined>(() => {
    // query 中的券记录 id
    const initial = Number(searchParams.get('couponId'));
    return Number.isInteger(initial) && initial > 0 ? initial : undefined;
  });
  // 提交后的业务错误（库存/限购等内联提示）
  const [submitError, setSubmitError] = useState<string | null>(null);
  // 已购买标记：展示去学习入口
  const [duplicatePurchase, setDuplicatePurchase] = useState(false);
  // 跳转
  const navigate = useNavigate();
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
  // 产品课程 id：既有订单模式以订单课程为准
  const productCourseId =
    existingOrderId !== null ? (orderQuery.data?.courseId ?? courseId) : courseId;
  // 课程详情：仅用于封面与类型展示，失败不影响下单
  const courseQuery = useQuery({
    queryKey: queryKeys.course(productCourseId),
    queryFn: () => getCourseDetail(productCourseId),
    enabled: Number.isInteger(productCourseId) && productCourseId > 0,
    retry: false,
  });

  // 创建订单（幂等）
  const createMutation = useIdempotentMutation(
    (payload: OrderCreateRequest, idempotencyKey: string) => createOrder(payload, idempotencyKey),
  );

  // 当前展示的金额来源
  const amountSource = existingOrderId !== null ? orderQuery.data : previewQuery.data;
  // 是否可提交
  const payable =
    amountSource !== undefined &&
    (existingOrderId !== null ? orderQuery.data?.status === 'pending' : true);
  // 实付金额
  const paidCents = amountSource?.paidCents ?? 0;
  // 当前价（活动价）
  const currentCents = amountSource?.currentCents ?? 0;
  // 原价
  const originalCents = amountSource?.originalCents ?? 0;
  // 优惠金额
  const discountCents = amountSource?.discountCents ?? 0;
  // 课程名称：详情优先，订单兜底
  const courseName = courseQuery.data?.name ?? orderQuery.data?.courseName ?? '课程订单';
  // 课程类型中文名
  const typeLabel = courseTypeLabel(courseQuery.data?.type);
  // 课程封面
  const coverUrl = courseQuery.data?.coverUrl;
  // 按钮文案：0 元为确认报名
  const submitLabel = paidCents === 0 ? '确认报名' : '确认支付';

  // 适用的券：仅未使用且适用于本课程
  const applicableCoupons =
    couponsQuery.data?.items.filter(
      (coupon) => coupon.id !== undefined && coupon.courseIds?.includes(courseId),
    ) ?? [];

  // 提交：创建（或取既有）订单后进入支付页
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

      // 订单 id 用于支付页路由
      const orderId = order.id;
      if (orderId === undefined) {
        setSubmitError('订单信息异常，请稍后重试');
        return;
      }

      navigate(`/order/${orderId}/pay`, { replace: true });
    } catch (error) {
      if (!(error instanceof ApiError)) {
        setSubmitError('提交失败，请稍后重试');
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
    <div className="checkout-page">
      <section className="checkout-card">
        <h2 className="checkout-section-title">产品信息</h2>
        <CheckoutProductRow
          coverUrl={coverUrl}
          name={courseName}
          typeLabel={typeLabel}
          priceLabel={currentCents === 0 ? '免费' : formatCents(currentCents)}
        />

        {existingOrderId === null && (
          <>
            <h2 className="checkout-section-title">优惠券</h2>
            {applicableCoupons.length > 0 ? (
              <div className="checkout-coupons">
                {applicableCoupons.map((coupon) => {
                  // 当前券是否已选中
                  const active = coupon.id === couponId;
                  return (
                    <button
                      key={coupon.id}
                      type="button"
                      className={
                        active ? 'checkout-coupon checkout-coupon-active' : 'checkout-coupon'
                      }
                      aria-pressed={active}
                      onClick={() => setCouponId(active ? undefined : coupon.id)}
                    >
                      {formatCents(coupon.discountCents ?? 0)} 优惠券
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="checkout-empty">暂无优惠券</p>
            )}
          </>
        )}

        <CheckoutPayMethod />

        {submitError && <Alert type="error" showIcon message={submitError} className="checkout-error" />}

        <CheckoutFooter
          originalCents={originalCents}
          currentCents={currentCents}
          discountCents={discountCents}
          paidCents={paidCents}
          submitLabel={submitLabel}
          disabled={!payable || createMutation.isPending}
          loading={createMutation.isPending}
          onSubmit={handleSubmit}
        />
      </section>
    </div>
  );
}
