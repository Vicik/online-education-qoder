import type { ThemeConfig } from 'antd';

// 视觉令牌：与设计框架 §13 一一对应
export const APP_THEME_TOKEN: ThemeConfig['token'] = {
  colorPrimary: '#1677ff', // 链接、激活态、焦点
  colorBgLayout: '#f5f6f8', // 页面底色
  colorBgContainer: '#ffffff', // 卡片
  colorBorderSecondary: '#ebedf0', // 分割线/卡片边框
  colorError: '#f5222d', // 错误与价格色
  borderRadius: 6, // 卡片、按钮圆角
  fontFamily: "-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif",
  fontSize: 14, // 正文字号
};
