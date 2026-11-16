import { useCallback, useEffect, useRef, useState } from 'react';
import { App as AntdApp, Button } from 'antd';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getAttemptResult,
  getExam,
  startAttempt,
  submitAttempt,
  toAnswerPayload,
} from '@/api/exam';
import type { ApiError } from '@/api/errors';
import { queryKeys } from '@/api/query-keys';
import type { AttemptResultData, AttemptStartData } from '@/api/types';
import { Countdown } from '@/components/common/Countdown';
import { EmptyState } from '@/components/common/EmptyState';
import { PageLoading } from '@/components/common/PageLoading';
import { serverNow } from '@/lib/server-clock';
import { ExamResultView } from './ExamResultView';
import { QuestionCard } from './QuestionCard';
import './exam.css';
import './ExamDetailPage.css';

// 页面阶段：介绍 -> 答题 -> 成绩
type ExamStage = 'intro' | 'answering' | 'result';

// 路由 state：列表确认参加后进入时自动开始；我的考试进入时携带已交卷记录
interface ExamLocationState {
  autoStart?: boolean;
  attemptId?: number;
}

// 考试详情：介绍、答题（计时 + 题号导航）与成绩
export default function ExamDetailPage() {
  // 路由参数
  const params = useParams<{ id: string }>();
  // 考试 id
  const examId = Number(params.id);
  // 路由跳转
  const navigate = useNavigate();
  // 当前路由信息：读取是否从列表确认进入
  const location = useLocation();
  // 查询缓存：开始/交卷后刷新已参加标记
  const queryClient = useQueryClient();
  // AntD 消息与确认框
  const { modal, message } = AntdApp.useApp();
  // 当前阶段
  const [stage, setStage] = useState<ExamStage>('intro');
  // 开始考试返回（题目快照与截止时间）
  const [attempt, setAttempt] = useState<AttemptStartData | null>(null);
  // 成绩详情
  const [result, setResult] = useState<AttemptResultData | null>(null);
  // 本地作答：题 id -> 选项 key 数组
  const [answers, setAnswers] = useState<Record<number, string[]>>({});
  // 交卷守卫：手动与自动交卷只允许一次
  const submitStartedRef = useRef(false);
  // 自动开始守卫：路由 state 触发只生效一次
  const autoStartedRef = useRef(false);
  // 是否列表确认后进入：省去介绍页的二次确认
  const autoStart = Boolean((location.state as ExamLocationState | null)?.autoStart);
  // 我的考试点击标题进入时携带的考试记录 id：有值则直接查看题目解析
  const viewAttemptId =
    (location.state as ExamLocationState | null)?.attemptId ?? null;

  // 考试详情查询
  const examQuery = useQuery({
    queryKey: queryKeys.exam(examId),
    queryFn: () => getExam(examId),
    enabled: Number.isInteger(examId) && examId > 0,
  });

  // 成绩解析查询：按携带的记录 id 直接取，不触发开始考试
  const viewResultQuery = useQuery({
    queryKey: queryKeys.examResult(examId, viewAttemptId ?? 0),
    queryFn: () => getAttemptResult(examId, viewAttemptId as number),
    enabled: viewAttemptId !== null && Number.isInteger(examId) && examId > 0,
  });

  // 开始考试
  const startMutation = useMutation({ mutationFn: () => startAttempt(examId) });

  // 交卷：先提交答案，再取成绩详情
  const submitMutation = useMutation<
    AttemptResultData,
    ApiError,
    Record<number, string[]>
  >({
    mutationFn: async (payload) => {
      // 开始考试返回的 attemptId 是本页唯一的记录标识
      const attemptId = attempt?.attemptId;
      if (!attemptId) throw new Error('考试尚未开始');
      await submitAttempt(examId, attemptId, toAnswerPayload(payload));
      return getAttemptResult(examId, attemptId);
    },
    onSuccess: (data) => {
      setResult(data);
      setStage('result');
      // 列表与我的考试记录同步为已交卷
      queryClient.invalidateQueries({ queryKey: queryKeys.myExamsRoot });
      message.success('交卷成功');
    },
    onError: (error) => {
      // 允许在非 6002 错误后重试
      submitStartedRef.current = false;
      if (error.code === 6002) {
        message.warning('考试已结束');
        navigate('/exams');
        return;
      }
      message.error(error.message);
    },
  });

  // 交卷（手动与自动共用）
  const doSubmit = async (payload: Record<number, string[]>) => {
    if (submitStartedRef.current) return;
    submitStartedRef.current = true;
    try {
      await submitMutation.mutateAsync(payload);
    } catch {
      // 错误提示由 onError 处理
    }
  };

  // 开始考试：取题目快照；已交卷直接看成绩，超时则回列表，否则进入答题
  const beginAttempt = useCallback(async () => {
    try {
      const data = await startMutation.mutateAsync();
      setAttempt(data);
      // 列表显示「已参加」
      queryClient.invalidateQueries({ queryKey: queryKeys.myExamsRoot });
      try {
        const existing = await getAttemptResult(examId, data.attemptId ?? 0);
        setResult(existing);
        setStage('result');
        return;
      } catch (error) {
        // 422 表示未交卷，继续答题；其他错误提示后停在介绍页
        if ((error as ApiError).status !== 422) {
          message.error((error as ApiError).message);
          return;
        }
      }
      // 已过截止时间仍未交卷：交给 worker 兜底，前端不再发交卷请求
      if (data.deadlineAt && new Date(data.deadlineAt).getTime() <= serverNow()) {
        message.warning('考试已结束');
        navigate('/exams');
        return;
      }
      setStage('answering');
    } catch (error) {
      message.error((error as ApiError).message);
    }
  }, [examId, startMutation, queryClient, message, navigate]);

  // 介绍页点开始：确认后开始计时
  const handleStart = () => {
    modal.confirm({
      title: '开始考试',
      content: '开始后立即计时且不可暂停，确认开始？',
      okText: '确定',
      cancelText: '取消',
      // 两个汉字的按钮不自动插空格，保持参考图文案
      okButtonProps: { autoInsertSpace: false, className: 'exam-confirm-ok' },
      cancelButtonProps: { autoInsertSpace: false },
      onOk: beginAttempt,
    });
  };

  // 列表确认参加后进入：详情加载完成即自动开始
  useEffect(() => {
    if (!autoStart || autoStartedRef.current || !examQuery.data) return;
    autoStartedRef.current = true;
    void beginAttempt();
  }, [autoStart, examQuery.data, beginAttempt]);

  // 手动作答变更
  const setAnswer = (questionId: number, keys: string[]) => {
    setAnswers((prev) => ({ ...prev, [questionId]: keys }));
  };

  // 手动交卷：未答完需二次确认
  const handleManualSubmit = () => {
    // 当前题目：接口字段可选，缺省按空处理
    const questions = attempt?.questions ?? [];
    // 未作答题数
    const unanswered = questions.filter(
      (question) => (answers[question.id ?? 0] ?? []).length === 0,
    ).length;
    modal.confirm({
      title: '确认交卷',
      content:
        unanswered > 0
          ? `还有 ${unanswered} 题未作答，交卷后不可修改，确认交卷？`
          : '交卷后不可修改，确认交卷？',
      okText: '确定',
      cancelText: '取消',
      // 两个汉字的按钮不自动插空格，保持参考图文案
      okButtonProps: { autoInsertSpace: false, className: 'exam-confirm-ok' },
      cancelButtonProps: { autoInsertSpace: false },
      onOk: () => doSubmit(answers),
    });
  };

  // 题号跳转：滚动到对应题目
  const scrollToQuestion = (index: number) => {
    document
      .getElementById(`exam-question-${index}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // 我的考试查看解析：不依赖考试详情，直接展示成绩与逐题解析
  if (viewAttemptId !== null) {
    if (viewResultQuery.data) {
      return (
        <ExamResultView
          result={viewResultQuery.data}
          backText="返回我的考试"
          onBack={() => navigate('/user/exams')}
        />
      );
    }
    if (viewResultQuery.isLoading) return <PageLoading />;
    return (
      <EmptyState
        description="成绩加载失败"
        action={<Button onClick={() => void viewResultQuery.refetch()}>重试</Button>}
      />
    );
  }

  if (examQuery.isLoading) return <PageLoading />;
  if (examQuery.error || !examQuery.data) {
    return (
      <EmptyState
        description="考试不存在"
        action={<Button onClick={() => navigate('/exams')}>返回考试列表</Button>}
      />
    );
  }

  // 考试详情
  const exam = examQuery.data;

  if (stage === 'result' && result) {
    return <ExamResultView result={result} onBack={() => navigate('/exams')} />;
  }

  if (stage === 'answering' && attempt) {
    // 题目列表：接口字段可选，缺省按空处理
    const questions = attempt.questions ?? [];
    return (
      <div className="exam-answer">
        <div className="exam-answer-main">
          <h1 className="exam-answer-title">{attempt.examTitle}</h1>
          <div className="exam-answer-divider" />
          <div className="exam-answer-meta">
            <span>题目总数：{questions.length}</span>
            <span>总分数：{attempt.totalScore ?? 0}</span>
            <span>时间：{attempt.durationMin ?? 0}分钟</span>
          </div>
          <div className="exam-question-list">
            {questions.map((question, index) => (
              <QuestionCard
                key={question.id ?? index}
                index={index + 1}
                question={question}
                value={answers[question.id ?? 0] ?? []}
                onChange={(keys) => setAnswer(question.id ?? 0, keys)}
              />
            ))}
          </div>
        </div>
        <aside className="exam-answer-side" aria-label="答题卡">
          <div className="exam-side-panel">
            <p className="exam-side-caption">剩余时间</p>
            <div className="exam-timer">
              <Countdown
                deadlineAt={attempt.deadlineAt ?? ''}
                onExpire={() => void doSubmit(answers)}
              />
            </div>
            <div className="exam-number-grid" role="group" aria-label="题号">
              {questions.map((question, index) => {
                // 题号格子是否显示已作答
                const answered = (answers[question.id ?? 0] ?? []).length > 0;
                return (
                  <button
                    key={question.id ?? index}
                    type="button"
                    className={
                      answered ? 'exam-number exam-number-answered' : 'exam-number'
                    }
                    onClick={() => scrollToQuestion(index + 1)}
                  >
                    {index + 1}
                  </button>
                );
              })}
            </div>
            <div className="exam-side-divider" />
            <Button
              type="primary"
              size="large"
              className="exam-cta exam-submit"
              loading={submitMutation.isPending}
              onClick={handleManualSubmit}
              // 两个汉字的按钮不自动插空格，保持参考图文案
              autoInsertSpace={false}
            >
              交卷
            </Button>
          </div>
        </aside>
      </div>
    );
  }

  return (
    <div className="exam-intro">
      <div className="exam-intro-card">
        <h1 className="exam-intro-title">{exam.title}</h1>
        <div className="exam-answer-divider" />
        <div className="exam-answer-meta">
          <span>题目总数：{exam.questionCount ?? 0}</span>
          <span>总分数：{exam.totalScore ?? 0}</span>
          <span>及格分：{exam.passScore ?? 0}</span>
          <span>时间：{exam.durationMin ?? 0}分钟</span>
        </div>
        {exam.description && <p className="exam-intro-desc">{exam.description}</p>}
        <div className="exam-intro-actions">
          <Button
            type="primary"
            size="large"
            className="exam-cta exam-intro-start"
            loading={startMutation.isPending}
            onClick={handleStart}
          >
            开始考试
          </Button>
          <Button type="link" className="exam-intro-back" onClick={() => navigate('/exams')}>
            返回考试列表
          </Button>
        </div>
      </div>
    </div>
  );
}
