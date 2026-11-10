import { useEffect, useState } from 'react';

// 分页状态：total 变化导致当前页越界时自动回退到最后一页
export function usePagination(total: number, initialPageSize = 20) {
  // 当前页码（从 1 开始）
  const [page, setPage] = useState(1);
  // 每页条数
  const [pageSize, setPageSize] = useState(initialPageSize);

  useEffect(() => {
    // 有效页数：至少 1 页，避免 total=0 时页码落到 0
    const maxPage = Math.max(1, Math.ceil(total / pageSize));
    if (page > maxPage) setPage(maxPage);
  }, [page, pageSize, total]);

  // 表格分页变化：改变页大小时回到第 1 页
  function onChange(nextPage: number, nextPageSize: number) {
    if (nextPageSize !== pageSize) {
      setPageSize(nextPageSize);
      setPage(1);
      return;
    }
    setPage(nextPage);
  }

  // 重置到第 1 页
  function reset() {
    setPage(1);
  }

  return { page, pageSize, onChange, reset };
}
