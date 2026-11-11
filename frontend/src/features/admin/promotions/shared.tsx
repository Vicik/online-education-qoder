import { Select } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { listAdminCourses } from '@/api/admin/courses';
import { queryKeys } from '@/api/query-keys';
import type { AdminCourseListItem } from '@/api/types';

// 下拉一次取满：后端 pageSize 上限 100
const COURSE_OPTION_PAGE_SIZE = 100;

// 已发布课程下拉数据：活动与优惠券只能关联已发布课程
export function usePublishedCourses() {
  // 已发布课程查询（复用管理端课程 API）
  const query = useQuery({
    queryKey: queryKeys.adminCourses('published-options'),
    queryFn: () => listAdminCourses(1, COURSE_OPTION_PAGE_SIZE, 'published'),
  });
  // 下拉选项：课程 id 作值，课程名作标签
  const options = (query.data?.items ?? []).map(
    (course: AdminCourseListItem) => ({
      value: course.id,
      label: course.name,
    }),
  );
  return { options, loading: query.isLoading };
}

// 单个已发布课程选择器（拼团/秒杀）
export function CourseSelect(props: {
  value?: number;
  onChange?: (value: number) => void;
  disabled?: boolean;
}) {
  // 下拉数据
  const { options, loading } = usePublishedCourses();
  return (
    <Select
      aria-label="关联课程"
      showSearch
      optionFilterProp="label"
      placeholder="选择已发布课程"
      options={options}
      loading={loading}
      value={props.value}
      onChange={props.onChange}
      disabled={props.disabled}
    />
  );
}

// 已发布课程多选（优惠券适用课程）
export function CourseMultiSelect(props: {
  value?: number[];
  onChange?: (value: number[]) => void;
  disabled?: boolean;
}) {
  // 下拉数据
  const { options, loading } = usePublishedCourses();
  return (
    <Select
      aria-label="适用课程"
      mode="multiple"
      showSearch
      optionFilterProp="label"
      placeholder="选择适用课程"
      options={options}
      loading={loading}
      value={props.value}
      onChange={props.onChange}
      disabled={props.disabled}
    />
  );
}
