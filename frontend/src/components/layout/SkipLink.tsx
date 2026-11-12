import './layout.css';

// 键盘用户跳过导航直达主内容
export function SkipLink() {
  return (
    <a className="skip-link" href="#main-content">
      跳到主要内容
    </a>
  );
}
