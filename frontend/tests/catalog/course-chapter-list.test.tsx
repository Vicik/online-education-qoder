import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { CourseChapterList } from '@/features/catalog/CourseChapterList';

const CHAPTERS = [
  { id: 1, title: '第一章 类型系统', contentType: 'video' as const, sortOrder: 1, isFree: true },
  { id: 2, title: '第二章 泛型', contentType: 'video' as const, sortOrder: 2, isFree: false },
];

describe('CourseChapterList', () => {
  it('只读模式展示试看标记，不展示锁定态', () => {
    render(<CourseChapterList chapters={CHAPTERS} />);

    expect(screen.getByText('试看')).toBeInTheDocument();
    expect(screen.queryByText('购买后学习')).not.toBeInTheDocument();
  });

  it('可交互模式点击章节回调 id，锁定章节展示购买提示', async () => {
    const onSelect = vi.fn();
    render(
      <CourseChapterList
        chapters={CHAPTERS}
        courseId={1}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByText('购买后学习')).toBeInTheDocument();
    await userEvent.click(screen.getByText(/第二章 泛型/));
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it('已购用户不展示锁定态', () => {
    render(
      <CourseChapterList
        chapters={CHAPTERS}
        courseId={1}
        purchased
        onSelect={vi.fn()}
      />,
    );

    expect(screen.queryByText('购买后学习')).not.toBeInTheDocument();
  });

  it('免费课程所有章节展示试看且无锁定态', () => {
    render(
      <CourseChapterList
        chapters={CHAPTERS}
        courseId={1}
        courseFree
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getAllByText('试看')).toHaveLength(2);
    expect(screen.queryByText('购买后学习')).not.toBeInTheDocument();
  });

  it('访问判定未就绪时不显示锁定，也不触发跳转', async () => {
    const onSelect = vi.fn();
    render(
      <CourseChapterList
        chapters={CHAPTERS}
        courseId={1}
        accessReady={false}
        onSelect={onSelect}
      />,
    );

    expect(screen.queryByText('购买后学习')).not.toBeInTheDocument();
    await userEvent.click(screen.getByText(/第二章 泛型/));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
