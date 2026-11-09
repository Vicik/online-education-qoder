// 分页结果接口：定义分页查询返回的数据结构
export interface PageResult<T> {
  items: T[]; // 当前页的数据列表
  total: number; // 总记录数
  page: number; // 当前页码
  pageSize: number; // 每页记录数
}
