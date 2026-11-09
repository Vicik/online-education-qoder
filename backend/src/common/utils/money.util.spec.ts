import { formatCents } from './money.util';

describe('formatCents', () => {
  it.each([
    [1234, '¥12.34'],
    [0, '¥0.00'],
    [1, '¥0.01'],
    [99, '¥0.99'],
    [100, '¥1.00'],
    [999999, '¥9999.99'],
    [-1234, '¥-12.34'],
  ])('formatCents(%i) === %s', (cents, expected) => {
    expect(formatCents(cents)).toBe(expected);
  });
});
