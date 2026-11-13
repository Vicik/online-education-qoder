import { useRef, useState } from 'react';
import { Button } from 'antd';
import { PauseCircleFilled, PlayCircleFilled } from '@ant-design/icons';
import './AudioPlayer.css';

// 秒数格式化为 mm:ss（未知时长返回 00:00）
function formatTime(seconds: number): string {
  // 非法值统一显示零
  if (!Number.isFinite(seconds) || seconds <= 0) return '00:00';
  // 总秒数向下取整
  const total = Math.floor(seconds);
  // 分钟部分
  const minutes = Math.floor(total / 60);
  // 秒部分
  const rest = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

// 音频窄条播放器：封面 + 标题 + 进度条 + 时间 + 播放按钮，播放结束回调
export function AudioPlayer({
  src,
  coverUrl,
  title,
  subtitle,
  onEnded,
}: {
  // 签名后的音频地址
  src: string;
  // 课程封面（可能为空）
  coverUrl?: string | null;
  // 主标题：课程名称
  title: string;
  // 副标题：当前章节名称
  subtitle?: string;
  // 播放到结尾时回调（用于标记已学）
  onEnded?: () => void;
}) {
  // 隐藏的 audio 元素，负责实际播放
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // 是否正在播放（由 audio 事件驱动）
  const [playing, setPlaying] = useState(false);
  // 当前播放位置（秒）
  const [currentTime, setCurrentTime] = useState(0);
  // 音频总时长（秒，元数据加载前为 0）
  const [duration, setDuration] = useState(0);

  // 播放/暂停切换：jsdom 等环境无播放实现时静默忽略
  function togglePlay() {
    // 隐藏播放器实例
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().catch(() => undefined);
    } else {
      audio.pause();
    }
  }

  // 拖动进度条：直接写入播放位置并同步显示
  function seek(seconds: number) {
    // 隐藏播放器实例
    const audio = audioRef.current;
    setCurrentTime(seconds);
    if (audio) audio.currentTime = seconds;
  }

  return (
    <div className="audio-player">
      <div className="audio-player-cover">
        {coverUrl ? <img src={coverUrl} alt="课程封面" /> : <div className="audio-player-cover-placeholder" />}
      </div>
      <div className="audio-player-main">
        <div className="audio-player-title">{title}</div>
        {subtitle && <div className="audio-player-subtitle">正在学习：{subtitle}</div>}
        <div className="audio-player-controls">
          <Button
            type="text"
            shape="circle"
            aria-label={playing ? '暂停' : '播放'}
            icon={playing ? <PauseCircleFilled /> : <PlayCircleFilled />}
            onClick={togglePlay}
          />
          <input
            className="audio-player-range"
            type="range"
            min={0}
            max={duration || 0}
            step={1}
            value={currentTime}
            aria-label="播放进度"
            onChange={(event) => seek(Number(event.target.value))}
          />
          <span className="audio-player-time">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>
      </div>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          onEnded?.();
        }}
      />
    </div>
  );
}
