import { Alert, App as AntdApp, Button, Card } from 'antd';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { getCourseDetail } from '@/api/catalog';
import { ApiError } from '@/api/errors';
import { listMyCoupons } from '@/api/promotion';
import { createOrder, getCheckoutPreview } from '@/api/trade';
import { queryKeys } from '@/api/query-keys';
import type { Order, OrderCreateRequest } from '@/api/types';
import { EmptyState } from '@/components/common/EmptyState';
import { PageLoading } from '@/components/common/PageLoading';
import { useIdempotentMutation } from '@/hooks/useIdempotentMutation';
import { courseTypeLabel } from '@/lib/course';
import { formatCents } from '@/lib/money';
import { CheckoutFooter, CheckoutPayMethod, CheckoutProductRow } from './checkout-blocks';
import './CheckoutPage.css';

// 券结算页：券固定使用；多门适用课程先选课，价格由服务端按所选课程计算
export default function CouponCheckoutPage() {
  // 路由中的券领取记录 id
  const { couponId: rawCouponId } = useParams();
  // 券领取记录 id
  const couponId = Number(rawCouponId);
  // 提交后跳支付页
  const navigate = useNavigate();
  // AntD 消息
  const { message } = AntdApp.useApp();
  // 用户点选的课程 id：未选时默认第一门适用课程
  const [pickedCourseId, setPickedCourseId] = useState<number | null>(null);
  // 提交后的业务错误（库存/限购等内联提示）
  const [submitError, setSubmitError] = useState<string | null>(null);

  // 我的未使用券：据此取当前券的适用课程
  const couponsQuery = useQuery({
    queryKey: queryKeys.myCoupons('unused', 1),
    queryFn: () => listMyCoupons('unused', 1, 100),
    enabled: Number.isInteger(couponId) && couponId > 0,
  });
  // 当前券：不存在说明已使用/已失效或不属于本人
  const coupon = couponsQuery.data?.items.find((item) => item.id === couponId);
  // 适用课程 id 列表
  const courseIds = coupon?.courseIds ?? [];
  // 选中的课程 id（默认第一门）
  const courseId = pickedCourseId ?? courseIds[0] ?? 0;

  // 适用课程详情：仅用于展示封面、名称、类型与列表价
  const courseQueries = useQueries({
    queries: courseIds.map((id) => ({
      queryKey: queryKeys.course(id),
      queryFn: () => getCourseDetail(id),
      retry: false,
    })),
  });

  // 选中课程的价格预览：券固定参与计算
  const previewQuery = useQuery({
    queryKey: queryKeys.checkout(courseId, JSON.stringify({ couponId })),
    queryFn: () => getCheckoutPreview(courseId, { couponId }),
    enabled: coupon !== undefined && courseId > 0,
    retry: false,
  });

  // 创建订单（幂等）
  const createMutation = useIdempotentMutation(
    (payload: OrderCreateRequest, idempotencyKey: string) => createOrder(payload, idempotencyKey),
  );

  if (couponsQuery.isLoading) return <PageLoading />;

  if (couponsQuery.error) {
    return (
      <EmptyState
        description="优惠券加载失败"
        action={<Button onClick={() => void couponsQuery.refetch()}>重试</Button>}
      />
    );
  }

  if (!coupon) {
    return <EmptyState description="优惠券不可用或已失效" />;
  }

  if (courseIds.length === 0) {
    return <EmptyState description="该券暂无可使用的课程" />;
  }

  if (previewQuery.error) {
    return <EmptyState description={previewQuery.error.message} />;
  }

  if (courseQueries.some((query) => query.isLoading)) {
    return <Card loading />;
  }

  // 选中课程的详情：用于列表展示与预览返回前的兜底金额
  const selectedCourse = courseQueries[courseIds.indexOf(courseId)]?.data;
  // 价格数据：服务端预览未返回时用课程售价与券面额兜底展示
  const preview = previewQuery.data ?? {
    originalCents: selectedCourse?.originalCents ?? 0,
    currentCents: selectedCourse?.saleCents ?? 0,
    discountCents: coupon.discountCents ?? 0,
    paidCents: Math.max(0, (selectedCourse?.saleCents ?? 0) - (coupon.discountCents ?? 0)),
  };
  // 按钮文案：0 元为确认报名
  const submitLabel = (preview.paidCents ?? 0) === 0 ? '确认报名' : '确认支付';

  // 提交：携带所选课程与券创建订单后进入支付页
  async function handleSubmit(): Promise<void> {
    setSubmitError(null);
    try {
      const order: Order = await createMutation.mutateAsync({
        courseId,
        activityType: 'normal',
        activityId: null,
        couponClaimId: couponId,
      });
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
        message.error('您已购买该课程');
        return;
      }
      if (error.code === 4002) {
        message.warning('优惠券不可用，请返回我的优惠券重试');
        return;
      }
      if (error.code === 4004) {
        message.info('请勿重复提交');
        return;
      }
      setSubmitError(error.message);
    }
  }

  // 课程行价格：选中课程用服务端报价，其余用课程售价
  const priceLabelOf = (id: number, saleCents: number | undefined): string => {
    if (id === courseId) {
      const cents = preview.currentCents ?? saleCents ?? 0;
      return cents === 0 ? '免费' : formatCents(cents);
    }
    return (saleCents ?? 0) === 0 ? '免费' : formatCents(saleCents ?? 0);
  };

  return (
    <div className="checkout-page">
      <section className="checkout-card">
        <h2 className="checkout-section-title">产品信息</h2>
        {courseIds.length > 1 ? (
          <div className="checkout-course-options" role="group" aria-label="选择课程">
            {courseIds.map((id, index) => {
              // 当前行的课程详情
              const detail = courseQueries[index].data;
              // 该课程是否选中
              const selected = id === courseId;
              return (
                <button
                  key={id}
                  type="button"
                  className={
                    selected ? 'checkout-course checkout-course-active' : 'checkout-course'
                  }
                  aria-pressed={selected}
                  onClick={() => setPickedCourseId(id)}
                >
                  <CheckoutProductRow
                    coverUrl={detail?.coverUrl}
                    name={detail?.name ?? '课程'}
                    typeLabel={courseTypeLabel(detail?.type)}
                    priceLabel={priceLabelOf(id, detail?.saleCents)}
                  />
                </button>
              );
            })}
          </div>
        ) : (
          <CheckoutProductRow
            coverUrl={courseQueries[0].data?.coverUrl}
            name={courseQueries[0].data?.name ?? '课程'}
            typeLabel={courseTypeLabel(courseQueries[0].data?.type)}
            priceLabel={priceLabelOf(courseId, courseQueries[0].data?.saleCents)}
          />
        )}

        <h2 className="checkout-section-title">优惠券</h2>
        <div className="checkout-coupons">
          <span className="checkout-coupon checkout-coupon-active checkout-coupon-fixed">
            {formatCents(coupon.discountCents ?? 0)} 优惠券
          </span>
        </div>

        <CheckoutPayMethod />

        {submitError && <Alert type="error" showIcon message={submitError} className="checkout-error" />}

        <CheckoutFooter
          originalCents={preview.originalCents ?? 0}
          currentCents={preview.currentCents ?? 0}
          discountCents={preview.discountCents ?? 0}
          paidCents={preview.paidCents ?? 0}
          submitLabel={submitLabel}
          disabled={createMutation.isPending}
          loading={createMutation.isPending}
          onSubmit={() => void handleSubmit()}
        />
      </section>
    </div>
  );
}
