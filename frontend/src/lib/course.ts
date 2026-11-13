// 课程类型中文名：详情页、结算页共用
const COURSE_TYPE_LABELS: Record<string, string> = {
  video: '视频',
  audio: '音频',
};

// 取课程类型中文名：未知类型返回 undefined
export function courseTypeLabel(type: string | null | undefined): string | undefined {
  return type ? COURSE_TYPE_LABELS[type] : undefined;
}
