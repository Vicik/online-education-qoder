import { Button } from 'antd';
import { WechatOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { formatCents } from '@/lib/money';

// 产品行：封面 + 名称/类型 + 右侧价格，封面失败降级为占位块
export function CheckoutProductRow(props: {
  coverUrl?: string | null;
  name: string;
  typeLabel?: string;
  priceLabel: string;
}) {
  // 封面是否加载失败
  const [coverFailed, setCoverFailed] = useState(false);

  return (
    <div className="checkout-product">
      <div className="checkout-product-cover">
        {props.coverUrl && !coverFailed ? (
          <img
            src={props.coverUrl}
            alt={props.name}
            onError={() => setCoverFailed(true)}
          />
        ) : (
          <div className="checkout-product-cover-placeholder" />
        )}
      </div>
      <div className="checkout-product-info">
        <h3 className="checkout-product-name">{props.name}</h3>
        {props.typeLabel && <span className="checkout-product-type">{props.typeLabel}</span>}
      </div>
      <span className="checkout-product-price">{props.priceLabel}</span>
    </div>
  );
}

// 支付方式：微信支付与限时提示，结算页两处共用
export function CheckoutPayMethod() {
  return (
    <>
      <h2 className="checkout-section-title">支付方式</h2>
      <div className="checkout-pay-method">
        <WechatOutlined />
        <span>微信支付</span>
      </div>
      <p className="checkout-pay-hint">请在30分钟内完成支付</p>
    </>
  );
}

// 底部结算栏：金额行在右上方，确认按钮居右下方
export function CheckoutFooter(props: {
  originalCents: number;
  currentCents: number;
  discountCents: number;
  paidCents: number;
  submitLabel: string;
  disabled: boolean;
  loading: boolean;
  onSubmit: () => void;
}) {
  return (
    <div className="checkout-footer">
      <div className="checkout-summary">
        {props.originalCents > props.currentCents && (
          <span className="checkout-summary-origin">
            原价 {formatCents(props.originalCents)}
          </span>
        )}
        <span className="checkout-summary-paid">
          {props.discountCents > 0 && (
            <>
              优惠券已抵扣
              <span className="checkout-summary-discount">
                {formatCents(props.discountCents).slice(1)}
              </span>
              元，
            </>
          )}
          需支付 <strong>{props.paidCents === 0 ? '免费' : formatCents(props.paidCents)}</strong>
        </span>
      </div>
      <Button
        type="primary"
        size="large"
        className="checkout-submit"
        disabled={props.disabled}
        loading={props.loading}
        onClick={props.onSubmit}
      >
        {props.submitLabel}
      </Button>
    </div>
  );
}
