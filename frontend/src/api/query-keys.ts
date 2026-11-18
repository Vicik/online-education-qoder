// 全局 Query 键：与设计框架 §10 对齐，写操作后按领域精确失效
export const queryKeys = {
  // 会话
  authMe: ['auth', 'me'] as const,
  // 首页
  homeRecommendations: ['home', 'recommendations'] as const,
  // 首页宣传位 banner
  homeBanners: ['home', 'banners'] as const,
  // 首页最新课程（独立于课程列表分页缓存）
  homeLatest: ['home', 'latest'] as const,
  // 课程
  courses: (page: number) => ['courses', page] as const,
  course: (id: number) => ['course', id] as const,
  courseContent: (courseId: number, chapterId: number) =>
    ['course', courseId, 'content', chapterId] as const,
  courseCoupons: (id: number) => ['courses', id, 'coupons'] as const,
  // 学习
  studyRecords: (page = 1) => ['study-records', page] as const,
  // 学习记录域失效前缀
  studyRecordsRoot: ['study-records'] as const,
  favorites: (page = 1) => ['favorites', 'mine', page] as const,
  // 收藏 id 全集（详情页判断收藏态）
  favoriteIds: ['favorites', 'ids'] as const,
  // 收藏域失效前缀：覆盖 id 集与各页列表
  favoritesRoot: ['favorites'] as const,
  // 交易
  checkout: (courseId: number, params: string) => ['checkout', courseId, params] as const,
  order: (id: number) => ['order', id] as const,
  myOrders: (page: number) => ['orders', 'mine', page] as const,
  // 全部购买记录：详情页判断是否已购，独立于购买记录分页缓存
  myOrdersAll: ['orders', 'mine', 'all'] as const,
  // 活动
  groupons: (page: number) => ['groupons', page] as const,
  groupon: (id: number) => ['groupon', id] as const,
  flashSales: (page: number) => ['flash-sales', page] as const,
  flashSale: (id: number) => ['flash-sale', id] as const,
  // 券
  myCoupons: (status: string, page: number) => ['coupons', 'mine', status, page] as const,
  // 我的券域失效前缀：领券成功后失效所有状态页签
  myCouponsRoot: ['coupons', 'mine'] as const,
  // 考试
  exams: (page: number) => ['exams', page] as const,
  exam: (id: number) => ['exam', id] as const,
  examResult: (examId: number, attemptId: number) =>
    ['exam-attempt', attemptId, 'result', examId] as const,
  // 社区
  posts: (page: number) => ['posts', page] as const,
  post: (id: number) => ['post', id] as const,
  myPosts: (page: number) => ['user', 'posts', page] as const,
  // 用户中心
  myExams: (page: number) => ['user', 'exams', page] as const,
  // 我的考试域失效前缀：开始/交卷后刷新各分页与已参加标记
  myExamsRoot: ['user', 'exams'] as const,
  // 全部考试记录：列表页判断是否已参加，独立于我的考试分页缓存
  myExamsAll: ['user', 'exams', 'all'] as const,
  profile: ['user', 'profile'] as const,
  overview: ['user', 'overview'] as const,
  // 管理端
  adminCourses: (params: string) => ['admin', 'courses', params] as const,
  // 管理端宣传位列表（排序条数据源）
  adminCoursePromotion: ['admin', 'courses', 'promotion'] as const,
  adminCourse: (id: number) => ['admin', 'courses', id] as const,
  adminGroupons: (page: number) => ['admin', 'groupons', page] as const,
  adminFlashSales: (page: number) => ['admin', 'flash-sales', page] as const,
  adminCoupons: (page: number, status = 'all') => ['admin', 'coupons', page, status] as const,
  // 管理端优惠券详情：编辑页单条缓存
  adminCoupon: (id: number) => ['admin', 'coupons', 'detail', id] as const,
  // 题目/屏蔽词带筛选参数；考试仅分页（步骤 16 定稿）
  adminQuestions: (params: string) => ['admin', 'questions', params] as const,
  adminQuestion: (id: number) => ['admin', 'questions', 'detail', id] as const,
  adminExams: (page: number) => ['admin', 'exams', page] as const,
  adminExam: (id: number) => ['admin', 'exams', 'detail', id] as const,
  adminBlockedWords: (params: string) => ['admin', 'blocked-words', params] as const,
  dashboardStats: ['admin', 'dashboard', 'stats'] as const,
};
