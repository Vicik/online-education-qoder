import { App as AntdApp } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import type { ApiError } from '@/api/errors';
import {
  createGrouponGroup,
  getGroupon,
  joinGrouponGroup,
  purchaseFlashSale,
} from '@/api/promotion';
import { queryKeys } from '@/api/query-keys';
import type {
  FlashSaleActivityBrief,
  GrouponActivityBrief,
  GrouponGroup,
  Order,
} from '@/api/types';
import { useIdempotentMutation } from '@/hooks/useIdempotentMutation';

// 活动横幅：左侧活动信息，右侧倒计时
export interface CoursePromotionBanner {
  kind: 'flash' | 'groupon'; // 活动类型
  text: string; // 左侧活动信息（已抢/剩余、成团人数）
  deadlineAt: string; // 倒计时截止时间
}

// 下单动作：秒杀抢购 / 拼团开团 / 拼团参团
type PromotionAction =
  | { type: 'flash' }
  | { type: 'create' }
  | { type: 'join'; groupId: number };

// 课程详情页秒杀/拼团：横幅、主按钮文案与开团/参团/抢购
export function useCoursePromotion({
  courseId,
  groupon,
  flashSale,
}: {
  courseId: number; // 课程 id：成功后跳结算
  groupon: GrouponActivityBrief | null; // 进行中的拼团（详情接口返回）
  flashSale: FlashSaleActivityBrief | null; // 进行中的秒杀（详情接口返回）
}) {
  // 路由跳转：活动下单成功后进入既有订单支付
  const navigate = useNavigate();
  // 查询缓存：成功后失效课程详情与活动数据
  const queryClient = useQueryClient();
  // AntD 消息提示
  const { message } = AntdApp.useApp();

  // 拼团活动 id（0 表示无活动）
  const grouponId = groupon?.id ?? 0;
  // 秒杀活动 id（0 表示无活动）
  const flashSaleId = flashSale?.id ?? 0;
  // 秒杀剩余库存
  const flashRemaining = flashSale?.remaining ?? 0;
  // 秒杀是否售罄
  const flashSoldOut = flashRemaining <= 0;
  // 秒杀是否未开始
  const flashNotStarted = flashSale?.status === 'not_started';
  // 秒杀是否可抢购：进行中且未售罄
  const flashPurchasable = flashSale?.status === 'ongoing' && !flashSoldOut;
  // 拼团是否可参与：进行中
  const grouponJoinable = groupon?.status === 'ongoing';

  // 待成团团组：详情页需要团长昵称与还差人数，取拼团详情
  const groupsQuery = useQuery({
    queryKey: queryKeys.groupon(grouponId),
    queryFn: () => getGroupon(grouponId),
    enabled: grouponId > 0,
  });

  // 活动统一的失败提示：按业务错误码给出可操作文案
  const handleError = (error: ApiError) => {
    // 秒杀售罄
    if (error.code === 4001) {
      message.warning('已售罄');
    } else if (error.code === 5003) {
      // 秒杀同一活动限购一次
      message.warning('同一活动限购一次');
    } else if (error.code === 5002) {
      // 活动未开始或已结束
      message.warning('活动未开始或已结束');
    } else if (error.status === 409 && error.code === 5001) {
      // 拼团同一活动已参与
      message.warning('您已参与过该拼团活动');
    } else if (error.code === 5001) {
      // 团已满或已结束
      message.warning('该团已满或已结束');
    } else if (error.code === 4004) {
      // 幂等冲突：上一次请求仍在处理
      message.warning('请求正在处理中，请稍后重试');
    } else {
      message.error(error.message);
    }
    // 状态、库存或团组可能已变化，刷新课程详情与团组
    void queryClient.invalidateQueries({ queryKey: queryKeys.course(courseId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.groupon(grouponId) });
  };

  // 抢购/开团/参团共用幂等提交：成功后进入既有订单支付
  const mutation = useIdempotentMutation<
    { order: Order; group?: GrouponGroup },
    PromotionAction
  >(
    (vars, key) => {
      if (vars.type === 'flash') return purchaseFlashSale(flashSaleId, key);
      if (vars.type === 'create') return createGrouponGroup(grouponId, key);
      return joinGrouponGroup(grouponId, vars.groupId, key);
    },
    {
      onSuccess: ({ order }) => {
        // 课程详情、团组与活动列表均已变化，刷新缓存
        void queryClient.invalidateQueries({ queryKey: queryKeys.course(courseId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.groupon(grouponId) });
        void queryClient.invalidateQueries({ queryKey: ['groupons'] });
        void queryClient.invalidateQueries({ queryKey: ['flash-sales'] });
        // 进入既有订单支付模式，后续流程与课程购买一致
        navigate(`/checkout/${order.courseId}?orderId=${order.id}`);
      },
      onError: handleError,
    },
  );

  // 横幅：秒杀优先（同课程同一时间只会存在一个有效活动）
  const banner: CoursePromotionBanner | null = flashSale
    ? {
        kind: 'flash',
        text: `${flashSale.sold ?? 0}人已抢/剩${flashRemaining}名`,
        deadlineAt: (flashNotStarted ? flashSale.startAt : flashSale.endAt) ?? '',
      }
    : groupon
      ? {
          kind: 'groupon',
          text: `${groupon.targetSize ?? 0}人拼团`,
          deadlineAt: groupon.endAt ?? '',
        }
      : null;

  // 主按钮文案：活动状态下按可购性降级
  const ctaLabel = flashSale
    ? flashSoldOut
      ? '已售罄'
      : flashNotStarted
        ? '未开始'
        : flashSale.status !== 'ongoing'
          ? '已结束'
          : '立即秒杀'
    : groupon
      ? grouponJoinable
        ? '立即拼团'
        : '已结束'
      : '立即购买';
  // 主按钮是否禁用：活动不可购时禁用
  const ctaDisabled = flashSale ? !flashPurchasable : groupon ? !grouponJoinable : false;

  // 抢购或发起新团：按当前活动类型选择接口
  const run = async () => {
    try {
      await mutation.mutateAsync(
        flashSale ? { type: 'flash' } : { type: 'create' },
      );
    } catch {
      // 错误已由 onError 提示
    }
  };

  // 加入指定团组
  const join = async (groupId: number) => {
    try {
      await mutation.mutateAsync({ type: 'join', groupId });
    } catch {
      // 错误已由 onError 提示
    }
  };

  return {
    banner,
    activeKind: flashSale ? 'flash' : groupon ? 'groupon' : null,
    ctaLabel,
    ctaDisabled,
    pending: mutation.isPending,
    run,
    join,
    // 待成团团组（仅拼团详情可见）
    groups: groupsQuery.data?.groups ?? [],
    groupsLoading: groupsQuery.isLoading,
  };
}
