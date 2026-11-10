import { Spin } from 'antd';
import { useEffect, useState } from 'react';
import { useRequestActivityStore } from '@/stores/request-activity';
import './RequestOverlay.css';

// 遮罩显示延迟：避免快请求造成闪烁
const SHOW_DELAY_MS = 120;

// 全局请求加载遮罩：延迟出现、淡入淡出，显示期间阻断页面点击
export function RequestOverlay() {
  const pendingCount = useRequestActivityStore((state) => state.pendingCount);
  // 是否已过延迟阈值并展示遮罩
  const [visible, setVisible] = useState(false);

  // 有待处理请求时延迟显示；归零立即隐藏并淡出
  useEffect(() => {
    if (pendingCount === 0) {
      setVisible(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [pendingCount]);

  return (
    <div
      className={`request-overlay${visible ? ' is-visible' : ''}`}
      role="status"
      aria-live="polite"
      aria-hidden={!visible}
    >
      <Spin size="large" />
      <span className="request-overlay__text">加载中…</span>
    </div>
  );
}
