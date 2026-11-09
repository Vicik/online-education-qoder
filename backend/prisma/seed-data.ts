// 演示种子数据常量：seed.ts 与集成测试共享，保证写入值与断言值一致。
// 账号、课程 id 与业务约定固定，集成测试直接按这些常量断言。

// 演示管理员账号（prod 不注入）
export const DEMO_ADMIN = {
  email: 'admin@example.com', // 登录邮箱
  password: 'abc12345', // 明文密码，仅种子用于生成哈希
  nickname: '管理员', // 昵称
  role: 'admin' as const, // 角色：管理员
};

// 演示学员账号
export const DEMO_USER = {
  email: 'user@example.com', // 登录邮箱
  password: 'abc12345', // 明文密码，仅种子用于生成哈希
  nickname: '学员小明', // 昵称
  role: 'user' as const, // 角色：普通用户
};

// 已发布的 TypeScript 视频课（含 2 个章节）
export const COURSE_TYPESCRIPT = {
  id: 1, // 固定课程 id
  name: 'TypeScript 系统入门', // 课程名称
  type: 'video' as const, // 课程类型：视频
  instructor: '张老师', // 讲师
  originalCents: 19900, // 原价（分）
  saleCents: 9900, // 售价（分）
  status: 'published' as const, // 已发布
  intro: '从零掌握 TypeScript 类型系统与工程实践。', // 简介
  detailRich: '<p>课程详细介绍（净化后 HTML）</p>', // 详情富文本
  chapters: [
    // 章节列表：content 为对象存储 key（视频课）
    { title: '第一章 类型基础', content: 'videos/ch1.mp4' },
    { title: '第二章 泛型进阶', content: 'videos/ch2.mp4' },
  ],
};

// 草稿状态的图文课（不出现在用户端）
export const COURSE_WRITING = {
  id: 2, // 固定课程 id
  name: '结构化写作课', // 课程名称
  type: 'rich' as const, // 课程类型：图文
  status: 'draft' as const, // 草稿
  instructor: '李老师', // 讲师
  originalCents: 29900, // 原价（分）
  saleCents: 19900, // 售价（分）
  chapters: [], // 草稿课暂无章节
};

// 进行中的双人拼团活动
export const GROUPON_ACTIVITY = {
  id: 1, // 固定活动 id
  name: '双人成团特惠', // 活动名称
  priceCents: 6900, // 拼团价（分）
  targetSize: 2, // 成团人数
};

// 12 月开始的未开始秒杀活动
export const FLASH_SALE_ACTIVITY = {
  id: 1, // 固定活动 id
  name: '12 月秒杀', // 活动名称
  priceCents: 5900, // 秒杀价（分）
  stock: 50, // 库存
  sold: 0, // 已售
};

// 新学员立减券模板（面额 20 元）
export const COUPON_TEMPLATE = {
  id: 1, // 固定模板 id
  name: '新学员立减券', // 模板名称
  discountCents: 2000, // 面额（分）
};

// 仅差一人成团的演示团组（成员为 DEMO_USER）
export const GROUPON_GROUP_ONE_SHORT = {
  id: 1, // 固定团组 id
};
