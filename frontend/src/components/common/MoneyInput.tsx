import { InputNumber } from 'antd';

// 金额输入：表单值为整数分，界面以元展示，最多两位小数
export function MoneyInput({
  value,
  onChange,
  disabled,
  maxCents,
  placeholder,
}: {
  value?: number | null;
  onChange?: (cents: number | null) => void;
  disabled?: boolean;
  maxCents?: number;
  placeholder?: string;
}) {
  // 分 → 元展示
  const displayValue = value === null || value === undefined ? null : value / 100;
  return (
    <InputNumber
      style={{ width: '100%' }}
      value={displayValue}
      min={0}
      max={maxCents === undefined ? undefined : maxCents / 100}
      precision={2}
      step={0.01}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(next) => onChange?.(next === null ? null : Math.round(Number(next) * 100))}
    />
  );
}
