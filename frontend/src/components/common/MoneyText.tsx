import { formatCents } from '@/lib/money';

// 金额展示：整数分；可选原价删除线
export function MoneyText({
  cents,
  originalCents,
  size = 'default',
}: {
  cents: number;
  originalCents?: number;
  size?: 'default' | 'large';
}) {
  return (
    <span className="money-text">
      <span
        className="money-text-value"
        style={{
          color: 'var(--color-price)',
          fontWeight: 600,
          fontSize: size === 'large' ? 24 : 14,
        }}
      >
        {formatCents(cents)}
      </span>
      {originalCents !== undefined && originalCents > cents && (
        <span
          className="money-text-original"
          style={{
            marginLeft: 8,
            color: 'var(--color-price-origin)',
            fontSize: size === 'large' ? 24 : 14,
            textDecoration: 'line-through',
          }}
        >
          {formatCents(originalCents)}
        </span>
      )}
    </span>
  );
}
