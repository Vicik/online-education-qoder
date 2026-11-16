import { useState } from 'react';
import { Checkbox, Input, Spin, Tag, Typography, theme } from 'antd';
import type { AdminQuestion } from '@/api/types';

// 选题列表属性：值受 Form.Item 注入
export function QuestionPicker(props: {
  questions: AdminQuestion[];
  value?: number[];
  onChange?: (questionIds: number[]) => void;
  loading?: boolean;
  error?: boolean;
}) {
  // 主题 token：边框与圆角跟随设计系统
  const { token } = theme.useToken();
  // 题干搜索关键词
  const [keyword, setKeyword] = useState('');
  // 已选题目 id，按出题顺序
  const selected = props.value ?? [];
  // 归一化关键词，忽略大小写与首尾空格
  const normalized = keyword.trim().toLowerCase();
  // 过滤后的题目
  const visible = normalized
    ? props.questions.filter((question) =>
        (question.stem ?? '').toLowerCase().includes(normalized),
      )
    : props.questions;

  // 勾选追加到末尾，取消勾选移除，保持已选顺序
  function toggle(questionId: number, checked: boolean) {
    const next = checked
      ? [...selected, questionId]
      : selected.filter((id) => id !== questionId);
    props.onChange?.(next);
  }

  // 列表内容：加载、失败、空池、无匹配、题目行
  function renderList() {
    if (props.loading) return <Spin />;
    if (props.error) {
      return <Typography.Text type="danger">题目加载失败</Typography.Text>;
    }
    if (visible.length === 0) {
      return (
        <Typography.Text type="secondary">
          {props.questions.length === 0 ? '暂无可选题目' : '没有匹配的题目'}
        </Typography.Text>
      );
    }
    return visible.map((question) => {
      // 当前题目 id
      const questionId = question.id ?? 0;
      // 是否已选
      const checked = selected.includes(questionId);
      // 停用题目仅已选时可取消，未选不可加
      const disabled = question.status === 'disabled' && !checked;
      return (
        <div
          key={questionId}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
            padding: '4px 0',
          }}
        >
          <Checkbox
            checked={checked}
            disabled={disabled}
            onChange={(event) => toggle(questionId, event.target.checked)}
            style={{ minWidth: 0 }}
          >
            <span style={{ wordBreak: 'break-word' }}>
              {question.stem ?? `题目 ${questionId}`}
            </span>
          </Checkbox>
          <span
            style={{
              flex: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Typography.Text type="secondary">
              {question.score ?? 0} 分
            </Typography.Text>
            {question.status === 'disabled' && <Tag>已停用</Tag>}
          </span>
        </div>
      );
    });
  }

  return (
    <div
      style={{
        border: `1px solid ${token.colorBorder}`,
        borderRadius: token.borderRadiusLG,
        padding: 12,
      }}
    >
      <Input
        allowClear
        aria-label="搜索题干"
        placeholder="搜索题干"
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
        style={{ marginBottom: 8 }}
      />
      <div style={{ maxHeight: 280, overflowY: 'auto' }}>{renderList()}</div>
    </div>
  );
}
