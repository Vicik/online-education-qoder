import '@ant-design/v5-patch-for-react-19'; // AntD 5 在 React 19 下的兼容补丁
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import 'dayjs/locale/zh-cn';
import App from './App';
import './styles/tokens.css';
import './styles/global.css';

dayjs.extend(utc); // 支持 UTC 解析
dayjs.extend(timezone); // 支持 Asia/Shanghai 展示
dayjs.locale('zh-cn'); // 中文日期格式

// 应用挂载节点，index.html 中保证存在
const rootElement = document.getElementById('root')!;
createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);