import { fireEvent, render, screen } from '@testing-library/react';
import { MoneyInput } from '@/components/common/MoneyInput';
import { MoneyText } from '@/components/common/MoneyText';

describe('MoneyInput', () => {
  it('输入元转换为分', () => {
    const onChange = vi.fn();
    render(<MoneyInput value={null} onChange={onChange} />);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '12.34' } });
    expect(onChange).toHaveBeenLastCalledWith(1234);
  });
  it('禁止负数', () => {
    const onChange = vi.fn();
    render(<MoneyInput value={null} onChange={onChange} />);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '-1' } });
    expect(onChange).not.toHaveBeenCalledWith(-100);
  });
});

describe('MoneyText', () => {
  it('展示售价与原价删除线', () => {
    render(<MoneyText cents={9900} originalCents={12900} />);
    expect(screen.getByText('¥99.00')).toBeInTheDocument();
    expect(screen.getByText('¥129.00')).toBeInTheDocument();
  });

  it.each(['default', 'medium', 'large'] as const)(
    '%s 档位原价字号小于售价',
    (size) => {
      render(<MoneyText cents={9900} originalCents={12900} size={size} />);
      const price = screen.getByText('¥99.00');
      const original = screen.getByText('¥129.00');
      expect(parseFloat(original.style.fontSize)).toBeLessThan(
        parseFloat(price.style.fontSize),
      );
    },
  );
});
