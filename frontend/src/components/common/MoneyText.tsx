import { formatCents } from '@/lib/money';

// 原价字号：始终小于同档位售价，避免原价抢视觉
const ORIGINAL_FONT_SIZES = { default: 12, medium: 13, large: 14 } as const;

// 金额展示：整数分；可选原价删除线
export function MoneyText({
  cents,
  originalCents,
  size = 'default',
}: {
  cents: number;
  originalCents?: number;
  size?: 'default' | 'medium' | 'large';
}) {
  // 字号：活动卡片用中号，详情页用大号
  const fontSize = size === 'large' ? 24 : size === 'medium' ? 18 : 14;
  // 原价字号：固定小于售价
  const originalFontSize = ORIGINAL_FONT_SIZES[size];

  return (
    // 售价与原价按基线对齐，字号差异只影响高度不影响底边
    <span className="money-text" style={{ display: 'inline-flex', alignItems: 'baseline' }}>
      <span
        className="money-text-value"
        style={{
          color: 'var(--color-price)',
          fontWeight: 600,
          fontSize,
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
            fontSize: originalFontSize,
            textDecoration: 'line-through',
          }}
        >
          {formatCents(originalCents)}
        </span>
      )}
    </span>
  );
}
