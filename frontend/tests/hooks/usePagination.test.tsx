import { act, renderHook } from '@testing-library/react';
import { usePagination } from '@/hooks/usePagination';

describe('usePagination', () => {
  it('切页与越界回退', () => {
    const { result, rerender } = renderHook(
      ({ total }: { total: number }) => usePagination(total, 20),
      { initialProps: { total: 45 } },
    );
    act(() => result.current.onChange(3, 20));
    expect(result.current.page).toBe(3);
    rerender({ total: 21 });
    expect(result.current.page).toBe(2);
  });
  it('修改页大小回到第 1 页', () => {
    const { result } = renderHook(() => usePagination(100, 20));
    act(() => result.current.onChange(3, 20));
    act(() => result.current.onChange(3, 50));
    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(50);
  });
});
