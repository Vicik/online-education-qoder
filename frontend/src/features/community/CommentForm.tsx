import { useState } from 'react';
import { Button, Input } from 'antd';
import './CommentForm.css';

// 评论输入框：内容必填，提交成功后由父组件清空
export function CommentForm(props: {
  placeholder: string;
  submitting: boolean;
  submitText?: string;
  onSubmit: (content: string) => Promise<boolean>;
}) {
  // 当前输入内容
  const [content, setContent] = useState('');

  // 提交：父组件返回 true 时清空输入
  async function handleSubmit() {
    const text = content.trim();
    if (text.length === 0) return;
    const ok = await props.onSubmit(text);
    if (ok) setContent('');
  }

  return (
    <div className="comment-form">
      <Input.TextArea
        autoSize={{ minRows: 3, maxRows: 8 }}
        maxLength={1000}
        showCount
        placeholder={props.placeholder}
        value={content}
        onChange={(event) => setContent(event.target.value)}
      />
      <Button
        type="primary"
        className="comment-form-submit"
        autoInsertSpace={false}
        loading={props.submitting}
        onClick={handleSubmit}
      >
        {props.submitText ?? '发表评论'}
      </Button>
    </div>
  );
}
