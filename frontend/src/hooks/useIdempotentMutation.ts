import {
  useMutation,
  type UseMutationOptions,
  type UseMutationResult,
} from '@tanstack/react-query';
import { useRef } from 'react';
import { newIdempotencyKey } from '@/api/idempotency';
import { ApiError } from '@/api/errors';

// 幂等 Mutation：一次用户意图一个 key，成功后重置
export function useIdempotentMutation<TData, TVariables>(
  mutationFn: (variables: TVariables, idempotencyKey: string) => Promise<TData>,
  options?: Omit<UseMutationOptions<TData, ApiError, TVariables>, 'mutationFn'>,
): UseMutationResult<TData, ApiError, TVariables> {
  // 当前用户意图的幂等键；失败保留，成功后清空
  const keyRef = useRef<string | null>(null);

  return useMutation<TData, ApiError, TVariables>({
    ...options,
    mutationFn: (variables) => {
      keyRef.current ??= newIdempotencyKey();
      return mutationFn(variables, keyRef.current);
    },
    onSuccess: async (data, variables, onMutateResult, context) => {
      keyRef.current = null;
      await options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}
