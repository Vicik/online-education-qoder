import { useQuery } from '@tanstack/react-query';
import { listAdminQuestions } from '@/api/admin/questions';
import { queryKeys } from '@/api/query-keys';

// 组卷候选题池：后端无搜索接口，取前 100 道（pageSize 上限）
export function useQuestionPool() {
  return useQuery({
    queryKey: queryKeys.adminQuestions('picker:100'),
    queryFn: () => listAdminQuestions(1, 100),
  });
}
