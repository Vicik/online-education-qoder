import { App as AntdApp, Button } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { claimCoupon } from '@/api/promotion';
import { queryKeys } from '@/api/query-keys';
import type { CouponClaim, CouponTemplateBrief } from '@/api/types';
import { ConfirmAction } from '@/components/common/ConfirmAction';
import { useIdempotentMutation } from '@/hooks/useIdempotentMutation';
import { usePermission } from '@/hooks/usePermission';
import './ClaimCouponButton.css';

// 课程详情领券按钮：游客登录回跳、登录幂等领取、限领/不可领取提示
export function ClaimCouponButton(props: {
  coupon: CouponTemplateBrief;
  courseId: number;
  claimed?: boolean;
}) {
  // 路由跳转（登录回跳）
  const navigate = useNavigate();
  // 查询缓存（领取成功后失效我的券）
  const queryClient = useQueryClient();
  // 当前用户（仅用于展示判断，权限边界在路由层）
  const { user } = usePermission();
  // AntD 消息提示
  const { message } = AntdApp.useApp();
  // 已领取标记：成功或后端 409 后置位
  const [claimed, setClaimed] = useState(false);
  // 券模板 id：缺省数据不渲染操作
  const couponId = props.coupon.id ?? 0;

  // 幂等领取：同一意图复用键，成功后自动重置
  const mutation = useIdempotentMutation<CouponClaim, void>(
    (_vars, key) => claimCoupon(couponId, key),
    {
      onSuccess: () => {
        setClaimed(true);
        message.success('领取成功');
        // 我的券所有页签失效（含课程详情页的领取记录查询）
        void queryClient.invalidateQueries({ queryKey: queryKeys.myCouponsRoot });
      },
      onError: (error) => {
        // 409：该模板已领取过（每人限领一张）
        if (error.status === 409) {
          setClaimed(true);
          message.info('该优惠券每人限领一张');
          return;
        }
        // 4002：停用/过期/已领完，展示后端文案
        message.error(error.message);
      },
    },
  );

  // 模板 id 缺失：不渲染操作
  if (couponId === 0) return null;

  // 游客：跳登录并回跳当前课程详情
  if (!user) {
    return (
      <Button
        className="claim-coupon-btn"
        onClick={() =>
          navigate(`/login?redirect=${encodeURIComponent(`/courses/${props.courseId}`)}`)
        }
      >
        登录领取
      </Button>
    );
  }

  // 已领取：仅展示文字，去掉禁用态底色与边框
  if (claimed || props.claimed) {
    return (
      <Button size="small" className="claim-coupon-btn-claimed" disabled>
        已领取
      </Button>
    );
  }

  return (
    <ConfirmAction
      title="领取优惠券"
      content={`确认领取「${props.coupon.name ?? ''}」？`}
      onConfirm={async () => {
        try {
          await mutation.mutateAsync();
        } catch {
          // 具体错误已由 onError 提示，这里只负责关闭确认框
        }
      }}
    >
      <Button
        size="small"
        className="claim-coupon-btn"
        autoInsertSpace={false}
        loading={mutation.isPending}
      >
        立即领取
      </Button>
    </ConfirmAction>
  );
}
