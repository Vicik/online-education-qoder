import { trimDeep } from '@/api/trim';

describe('trimDeep', () => {
  it('递归 trim 对象与数组中的字符串', () => {
    expect(
      trimDeep({
        name: '  张三  ',
        list: ['  a  ', { text: '  b  ' }],
        count: 1,
        flag: true,
        empty: null,
      }),
    ).toEqual({
      name: '张三',
      list: ['a', { text: 'b' }],
      count: 1,
      flag: true,
      empty: null,
    });
  });

  it('Date 与 FormData 原样保留', () => {
    // 保持引用的日期
    const date = new Date('2026-01-01T00:00:00Z');
    // 带空格的表单对象
    const form = new FormData();
    form.append('name', '  x  ');
    const result = trimDeep({ date, form });
    expect(result.date).toBe(date);
    expect(result.form).toBe(form);
    expect(form.get('name')).toBe('  x  ');
  });
});
