// 上海时区日期时间格式化器：使用中国标准时间，24 小时制
const formatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', // 上海时区
  hourCycle: 'h23', // 24 小时制（0-23）
  year: 'numeric', // 四位年份
  month: '2-digit', // 两位月份
  day: '2-digit', // 两位日期
  hour: '2-digit', // 两位小时
  minute: '2-digit', // 两位分钟
  second: '2-digit', // 两位秒数
});

// 将 Date 对象转换为上海时区的 ISO 格式字符串：格式为 YYYY-MM-DD HH:mm:ss
export function toShanghaiISO(d: Date): string {
  // 将日期格式化为各个部分
  const parts = formatter.formatToParts(d);
  // 根据类型获取对应部分的值
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  // 拼接为 ISO 格式字符串
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}
