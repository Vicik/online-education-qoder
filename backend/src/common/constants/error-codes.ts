// 业务错误码枚举：定义系统中所有可能的错误类型及其对应的错误码
export enum ErrorCode {
  PARAM_INVALID = 1001, // 参数无效：请求参数不符合预期
  RESOURCE_NOT_FOUND = 1002, // 资源未找到：请求的资源不存在
  METHOD_NOT_ALLOWED = 1003, // 方法不允许：HTTP 方法不被支持
  PAYLOAD_TOO_LARGE = 1004, // 请求体过大：上传的数据超过限制
  RATE_LIMITED = 1005, // 请求限流：访问频率超过限制
  INTERNAL_ERROR = 1006, // 内部错误：服务器内部异常
  UNAUTHORIZED = 2001, // 未授权：用户未登录或登录已过期
  FORBIDDEN = 2002, // 禁止访问：用户无权限访问该资源
  BAD_CREDENTIALS = 2003, // 凭证错误：用户名或密码错误
  COURSE_NOT_FOUND = 3001, // 课程未找到：指定的课程不存在
  NOT_PURCHASED = 3002, // 未购买：用户未购买该课程
  STOCK_INSUFFICIENT = 4001, // 库存不足：商品库存数量不够
  COUPON_UNAVAILABLE = 4002, // 优惠券不可用：优惠券已过期或不符合使用条件
  DUPLICATE_PURCHASE = 4003, // 重复购买：用户已购买过该商品
  IDEMPOTENCY_CONFLICT = 4004, // 幂等性冲突：重复的请求被拦截
  GROUP_FULL = 5001, // 拼团已满：拼团人数已达到上限
  ACTIVITY_NOT_STARTED = 5002, // 活动未开始：活动还未到开始时间
  PURCHASE_LIMIT = 5003, // 购买限制：用户购买次数超过限制
  ALREADY_SUBMITTED = 6001, // 已提交：用户已提交过该操作
  EXAM_ENDED = 6002, // 考试已结束：考试已超过结束时间
  BLOCKED_WORD = 7001, // 违禁词：内容包含违禁词汇
}
