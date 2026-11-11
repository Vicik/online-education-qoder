import { useState } from 'react';
import { Button, message, Space } from 'antd';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { createPost, extractBlockedWords } from '@/api/community';
import type { PostBrief } from '@/api/types';
import { PageHeader } from '@/components/common/PageHeader';
import { RichTextEditor } from '@/components/common/RichTextEditor';
import { useIdempotentMutation } from '@/hooks/useIdempotentMutation';

// 发帖页：富文本内容必填、幂等提交、屏蔽词命中列出全部词
export default function NewPostPage() {
  // 路由跳转
  const navigate = useNavigate();
  // 查询缓存
  const queryClient = useQueryClient();
  // 富文本内容（编辑器已回写 data-key）
  const [content, setContent] = useState('');

  // 发帖：一次意图一个幂等键
  const mutation = useIdempotentMutation<PostBrief, { content: string }>(
    (vars, key) => createPost(vars, key),
    {
      onSuccess: (created) => {
        message.success('发布成功');
        void queryClient.invalidateQueries({ queryKey: ['posts'] });
        navigate(`/community/${created.id}`);
      },
      onError: (error) => {
        const words = extractBlockedWords(error);
        message.error(words.length > 0 ? `内容包含屏蔽词：${words.join('、')}` : error.message);
      },
    },
  );

  // 提交：空内容不发送
  const handleSubmit = () => {
    if (content.trim().length === 0) {
      message.warning('请输入帖子内容');
      return;
    }
    mutation.mutate({ content });
  };

  return (
    <div>
      <PageHeader
        title="发布帖子"
        extra={
          <Button autoInsertSpace={false} onClick={() => navigate(-1)}>
            返回
          </Button>
        }
      />
      <Space direction="vertical" style={{ width: '100%' }}>
        <RichTextEditor value={content} onChange={setContent} placeholder="分享你的学习心得…" />
        <Button
          type="primary"
          autoInsertSpace={false}
          loading={mutation.isPending}
          onClick={handleSubmit}
        >
          发布
        </Button>
      </Space>
    </div>
  );
}
