import { Tag } from 'antd';

// 状态领域：不同领域的同名字段文案不同
export type StatusDomain =
  | 'course'
  | 'order'
  | 'groupon'
  | 'group'
  | 'flash-sale'
  | 'exam'
  | 'coupon'
  | 'question'
  | 'user'
  | 'gender';

// 每个领域的状态 → 文案/颜色
const STATUS_MAPS: Record<StatusDomain, Record<string, { text: string; color: string }>> = {
  course: {
    draft: { text: '草稿', color: 'default' },
    published: { text: '已发布', color: 'success' },
    unpublished: { text: '已下架', color: 'warning' },
  },
  order: {
    pending: { text: '待支付', color: 'processing' },
    paid: { text: '已支付', color: 'success' },
    refunded: { text: '已退款', color: 'error' },
    cancelled: { text: '已取消', color: 'default' },
  },
  groupon: {
    not_started: { text: '未开始', color: 'default' },
    ongoing: { text: '进行中', color: 'processing' },
    ended: { text: '已结束', color: 'default' },
    cancelled: { text: '已取消', color: 'default' },
  },
  group: {
    pending: { text: '待成团', color: 'processing' },
    success: { text: '已成团', color: 'success' },
    failed: { text: '拼团失败', color: 'error' },
  },
  'flash-sale': {
    not_started: { text: '未开始', color: 'default' },
    ongoing: { text: '进行中', color: 'processing' },
    ended: { text: '已结束', color: 'default' },
    cancelled: { text: '已取消', color: 'default' },
  },
  exam: {
    draft: { text: '草稿', color: 'default' },
    published: { text: '已发布', color: 'success' },
    ended: { text: '已结束', color: 'default' },
  },
  coupon: {
    unused: { text: '未使用', color: 'processing' },
    used: { text: '已使用', color: 'default' },
    restored: { text: '未使用', color: 'processing' },
    expired: { text: '已过期', color: 'default' },
    invalid: { text: '已失效', color: 'default' },
    enabled: { text: '已启用', color: 'success' },
    disabled: { text: '已停用', color: 'default' },
  },
  question: {
    single: { text: '单选', color: 'blue' },
    multiple: { text: '多选', color: 'purple' },
    enabled: { text: '已启用', color: 'success' },
    disabled: { text: '已停用', color: 'default' },
  },
  user: {
    user: { text: '普通用户', color: 'blue' },
    admin: { text: '管理员', color: 'gold' },
  },
  gender: {
    male: { text: '男', color: 'blue' },
    female: { text: '女', color: 'magenta' },
    secret: { text: '保密', color: 'default' },
  },
};

// 状态标签：未知状态回退原文
export function StatusTag({ domain, status }: { domain: StatusDomain; status: string }) {
  // 命中当前领域的状态映射，未命中时使用原文
  const meta = STATUS_MAPS[domain][status];
  return <Tag color={meta?.color}>{meta?.text ?? status}</Tag>;
}
