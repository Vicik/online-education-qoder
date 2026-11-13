import { WechatOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Result } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { getOrder, payOrder } from '@/api/trade';
import { queryKeys } from '@/api/query-keys';
import { useCountdown } from '@/hooks/useCountdown';
import { formatCountdown } from '@/lib/datetime';
import { formatCents } from '@/lib/money';
import { serverNow } from '@/lib/server-clock';
import './OrderPayPage.css';

// 演示环境：二维码展示后自动模拟扫码支付
const SIMULATED_SCAN_DELAY_MS = 1500;
// 支付成功后停留展示的毫秒数
const SUCCESS_REDIRECT_DELAY_MS = 1200;
// 二维码有效期（毫秒）
const QR_TTL_MS = 5 * 60 * 1000;

// 支付页：微信扫码样式；演示环境自动完成支付后跳结果页
export default function OrderPayPage() {
  // 路由订单 id
  const { id: rawId } = useParams();
  // 解析后的订单 id
  const orderId = Number(rawId);
  // id 合法才发起请求
  const validId = Number.isInteger(orderId) && orderId > 0;
  // 跳转
  const navigate = useNavigate();
  // QueryClient：支付后失效订单相关缓存
  const queryClient = useQueryClient();
  // 二维码 SVG 字符串
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  // 本次是否支付成功（控制成功提示与跳转）
  const [paid, setPaid] = useState(false);
  // 二维码过期时间：打开页面时重新计时
  const [qrDeadline] = useState(() => new Date(serverNow() + QR_TTL_MS).toISOString());

  // 订单详情（支付金额与状态）
  const query = useQuery({
    queryKey: queryKeys.order(orderId),
    queryFn: () => getOrder(orderId),
    enabled: validId,
  });

  // 模拟支付：成功后更新订单缓存并失效订单、学习概览与券缓存
  const payMutation = useMutation({
    mutationFn: () => payOrder(orderId),
    onSuccess: (paidOrder) => {
      // 结果页复用同一订单缓存，直接写入已支付状态
      queryClient.setQueryData(queryKeys.order(orderId), paidOrder);
      queryClient.invalidateQueries({ queryKey: queryKeys.myOrders(1) });
      // 详情页据此切换「去学习」
      queryClient.invalidateQueries({ queryKey: queryKeys.myOrdersAll });
      queryClient.invalidateQueries({ queryKey: queryKeys.overview });
      // 学习记录包含已购课程：支付成功后立即出现
      queryClient.invalidateQueries({ queryKey: queryKeys.studyRecordsRoot });
      queryClient.invalidateQueries({ queryKey: queryKeys.myCoupons('unused', 1) });
      setPaid(true);
    },
  });
  // mutate 引用稳定，便于作为定时器依赖
  const { mutate: submitPay } = payMutation;

  // 当前订单
  const order = query.data;
  // 已支付：本次支付成功或订单本就已支付
  const orderPaid = paid || order?.status === 'paid';

  // 生成二维码图案：SVG 输出，避免依赖 canvas
  useEffect(() => {
    let cancelled = false;
    QRCode.toString(`weixin://wxpay/bizpayurl?pr=zhixu${orderId}`, {
      type: 'svg',
      margin: 1,
      width: 240,
    })
      .then((svg) => {
        if (!cancelled) setQrSvg(svg);
      })
      .catch(() => {
        if (!cancelled) setQrSvg(null);
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  // 待支付订单：展示二维码片刻后自动模拟扫码支付
  useEffect(() => {
    if (paid || !order || order.status !== 'pending') return undefined;
    const timer = window.setTimeout(submitPay, SIMULATED_SCAN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [paid, order, submitPay]);

  // 支付成功：短暂停留展示后进入结果页
  useEffect(() => {
    if (!orderPaid) return undefined;
    const timer = window.setTimeout(() => {
      navigate(`/order/${orderId}/result`, { replace: true });
    }, SUCCESS_REDIRECT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [orderPaid, navigate, orderId]);

  // 二维码剩余毫秒
  const remainingMs = useCountdown(qrDeadline);

  if (query.isLoading) return <Card loading />;
  if (query.error || !order) {
    return (
      <Result
        status="404"
        title="订单不存在"
        extra={<Link to="/user/orders">返回购买记录</Link>}
      />
    );
  }

  return (
    <div className="pay-page">
      <section className="pay-card">
        {orderPaid && (
          <Alert
            type="success"
            showIcon
            className="pay-success"
            message="支付成功"
            description="正在跳转..."
          />
        )}
        <h1 className="pay-title">微信支付</h1>
        <p className="pay-expire">
          距离二维码过期还剩
          <span className="pay-countdown">{formatCountdown(remainingMs)}</span>
          ，过期后请刷新页面重新获取
        </p>
        <p className="pay-amount">
          支付总额：<span>{formatCents(order.paidCents ?? 0)}</span>
        </p>
        <div className="pay-qr">
          {qrSvg ? (
            <div role="img" aria-label="支付二维码" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          ) : (
            <div className="pay-qr-placeholder" />
          )}
        </div>
        <div className="pay-scan-hint">
          <WechatOutlined className="pay-scan-icon" />
          <div>
            <span>请使用微信扫一扫</span>
            <span>扫描二维码支付</span>
          </div>
        </div>
        {payMutation.error && (
          <Alert
            type="error"
            showIcon
            className="pay-error"
            message={payMutation.error.message}
            action={
              <Button size="small" loading={payMutation.isPending} onClick={() => submitPay()}>
                重新支付
              </Button>
            }
          />
        )}
      </section>
    </div>
  );
}
