import { useCountdown } from '@/hooks/useCountdown';
import { formatCountdown } from '@/lib/datetime';

// 倒计时展示：HH:mm:ss
export function Countdown({
  deadlineAt,
  onExpire,
  prefix,
}: {
  deadlineAt: string;
  onExpire?: () => void;
  prefix?: string;
}) {
  // 剩余毫秒：基于服务端校准时间
  const remainingMs = useCountdown(deadlineAt, onExpire);
  return (
    <span>
      {prefix}
      {formatCountdown(remainingMs)}
    </span>
  );
}
