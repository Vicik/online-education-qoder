import { centsToYuanInput, formatCents, isSalePriceValid, yuanInputToCents } from '@/lib/money';

describe('money', () => {
  it('formatCents 保留两位小数', () => {
    expect(formatCents(1234)).toBe('¥12.34');
    expect(formatCents(0)).toBe('¥0.00');
  });
  it('yuanInputToCents 元转分', () => {
    expect(yuanInputToCents('12.34')).toBe(1234);
    expect(yuanInputToCents('12.3')).toBe(1230);
    expect(yuanInputToCents('12')).toBe(1200);
  });
  it('拒绝负值、超两位小数与非数字', () => {
    expect(yuanInputToCents('-1')).toBeNull();
    expect(yuanInputToCents('12.345')).toBeNull();
    expect(yuanInputToCents('abc')).toBeNull();
    expect(yuanInputToCents('')).toBeNull();
  });
  it('售价不得高于原价', () => {
    expect(isSalePriceValid(1000, 1000)).toBe(true);
    expect(isSalePriceValid(1000, 1001)).toBe(false);
  });
  it('centsToYuanInput 回显', () => {
    expect(centsToYuanInput(1234)).toBe('12.34');
  });
});
