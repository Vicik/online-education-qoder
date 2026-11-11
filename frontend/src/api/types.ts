import type { components } from './schema';

// OpenAPI 生成的全部 schema 别名，业务类型不手写重复 DTO
export type Schemas = components['schemas'];

// 分页响应：items 元素类型由调用方指定
export interface PageResult<T> {
  // 当前页数据
  items: T[];
  // 记录总数
  total: number;
  // 当前页码（从 1 开始）
  page: number;
  // 每页条数
  pageSize: number;
}

// 课程简要信息（首页卡片/列表/收藏）
export type CourseBrief = Schemas['CourseBrief'];

// 课程详情（含活动、可领券、章节目录）
export type CourseDetail = Schemas['CourseDetail'];

// 章节目录项（不含正文）
export type ChapterBrief = Schemas['ChapterBrief'];

// 章节正文（rich=净化 HTML；video/audio=签名地址）
export type ChapterContent = Schemas['ChapterContent'];

// 学习记录项
export type StudyRecord = Schemas['StudyRecord'];

// 进行中的拼团活动
export type GrouponActivityBrief = Schemas['GrouponActivityBrief'];

// 团组：状态、已支付成员数、成团人数与截止时间
export type GrouponGroup = Schemas['GrouponGroup'];

// 拼团详情：活动信息 + 待成团团组
export type GrouponDetail = GrouponActivityBrief & { groups: GrouponGroup[] };

// 进行中的秒杀活动
export type FlashSaleActivityBrief = Schemas['FlashSaleActivityBrief'];

// 可领取的优惠券模板
export type CouponTemplateBrief = Schemas['CouponTemplateBrief'];

// 价格预览：服务端计价结果
export type CheckoutPreviewData = Schemas['CheckoutPreviewData'];

// 创建订单请求体
export type OrderCreateRequest = Schemas['OrderCreateRequest'];

// 订单
export type Order = Schemas['Order'];

// 用户领取的优惠券
export type CouponClaim = Schemas['CouponClaim'];

// 个人资料
export type ProfileData = Schemas['ProfileData'];

// 学习概览统计
export type OverviewData = Schemas['OverviewData'];

// 帖子摘要：作者、内容、点赞/评论计数
export type PostBrief = Schemas['PostBrief'];

// 帖子详情：摘要 + 两层评论树
export type PostDetail = Schemas['PostDetail'];

// 一级评论：含回复列表
export type CommentView = Schemas['CommentView'];

// 回复：不产生第三层
export type ReplyView = Schemas['ReplyView'];

// 考试摘要：列表与详情共用
export type ExamBrief = Schemas['ExamBrief'];

// 用户视角题目：不含答案与解析
export type ExamQuestion = Schemas['QuestionUserView'];

// 开始考试返回：题目快照 + 服务端截止时间
export type AttemptStartData = Schemas['AttemptStartData'];

// 交卷判分结果
export type SubmitData = Schemas['SubmitData'];

// 成绩详情：含用户答案、正确答案与解析
export type AttemptResultData = Schemas['AttemptResultData'];

// 成绩详情中的单题
export type ExamResultQuestion = NonNullable<AttemptResultData['questions']>[number];

// 我的考试记录
export type MyExamRecord = Schemas['MyExamRecord'];

// 管理端课程列表项：课程摘要 + 章节数 + 报名人数
export type AdminCourseListItem = Schemas['CourseBrief'] & {
  chapterCount: number;
  enrollmentCount: number;
};

// 管理端课程详情：用户端详情 + version（步骤 14 契约修正）
export type AdminCourseDetail = Schemas['CourseDetail'];

// 章节目录项：id/标题/内容类型/序号（不含正文）；schema 字段可选，此处收敛为必有元素
export type AdminChapter = NonNullable<AdminCourseDetail['chapters']>[number];

// 课程状态：草稿/已发布/已下架（剔除 schema 可选性产生的 undefined）
export type CourseStatus = NonNullable<AdminCourseDetail['status']>;

// 创建课程请求
export type CourseCreateInput = Schemas['CourseCreateRequest'];

// 编辑课程请求：version 必填
export type CourseUpdateInput = Schemas['CourseUpdateRequest'];

// 新增章节请求
export type ChapterCreateInput = Schemas['ChapterCreateRequest'];

// 编辑章节请求：content 缺省表示保持原正文
export type ChapterUpdateInput = Schemas['ChapterUpdateRequest'];

// 课程写操作返回：id/status/version
export type CourseWriteResult = Schemas['CourseAdminWriteResult'];

