import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addFavorite, listFavoriteIds, removeFavorite } from '@/api/catalog';
import { queryKeys } from '@/api/query-keys';
import { useIdempotentMutation } from '@/hooks/useIdempotentMutation';
import { useSessionStore } from '@/stores/session';

// 收藏失效：一次覆盖 id 集与各页列表
function invalidateFavorites(client: ReturnType<typeof useQueryClient>): Promise<void> {
  return client.invalidateQueries({ queryKey: queryKeys.favoritesRoot });
}

// 收藏 id 全集：仅登录用户请求
export function useFavoriteIds() {
  // 当前会话用户
  const user = useSessionStore((state) => state.user);
  return useQuery({
    queryKey: queryKeys.favoriteIds,
    queryFn: listFavoriteIds,
    enabled: Boolean(user),
  });
}

// 收藏切换：POST 走幂等，DELETE 幂等；成功后失效收藏缓存
export function useFavoriteToggle(courseId: number) {
  // QueryClient：驱动缓存失效
  const queryClient = useQueryClient();
  // 收藏 id 集
  const { data: ids } = useFavoriteIds();
  // 当前课程是否已收藏（未拿到 id 集时按未收藏展示）
  const favorited = ids?.has(courseId) ?? false;

  // 收藏突变
  const addMutation = useIdempotentMutation(
    (id: number, idempotencyKey: string) => addFavorite(id, idempotencyKey),
    { onSuccess: () => invalidateFavorites(queryClient) },
  );
  // 取消收藏突变
  const removeMutation = useMutation({
    mutationFn: removeFavorite,
    onSuccess: () => invalidateFavorites(queryClient),
  });

  // 请求进行中：禁用按钮防重复提交
  const pending = addMutation.isPending || removeMutation.isPending;

  // 切换收藏态
  async function toggle(): Promise<void> {
    if (favorited) {
      await removeMutation.mutateAsync(courseId);
    } else {
      await addMutation.mutateAsync(courseId);
    }
  }

  return { favorited, pending, toggle };
}
