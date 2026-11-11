import { useRef, useState } from 'react';
import { App as AntdApp, Button, Card, Space, Typography } from 'antd';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
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
import { PageHeader } from '@/components/common/PageHeader';
import { serverNow } from '@/lib/server-clock';
import { ExamResultView } from './ExamResultView';
import { QuestionCard } from './QuestionCard';

// 页面阶段：介绍 -> 答题 -> 成绩
type ExamStage = 'intro' | 'answering' | 'result';

// 考试详情：开始考试、作答、交卷与成绩
export default function ExamDetailPage() {
  // 路由参数
  const params = useParams<{ id: string }>();
  // 考试 id
  const examId = Number(params.id);
  // 路由跳转
  const navigate = useNavigate();
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

  // 考试详情查询
  const examQuery = useQuery({
    queryKey: queryKeys.exam(examId),
    queryFn: () => getExam(examId),
    enabled: Number.isInteger(examId) && examId > 0,
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

  // 点开始：确认后取题目并探测是否已交卷
  const handleStart = () => {
    modal.confirm({
      title: '开始考试',
      content: '开始后立即计时且不可暂停，确认开始？',
      okText: '确定',
      cancelText: '取消',
      // 两个汉字的按钮不自动插空格，保持参考图文案
      okButtonProps: { autoInsertSpace: false },
      cancelButtonProps: { autoInsertSpace: false },
      onOk: async () => {
        try {
          const data = await startMutation.mutateAsync();
          setAttempt(data);
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
      },
    });
  };

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
      okButtonProps: { autoInsertSpace: false },
      cancelButtonProps: { autoInsertSpace: false },
      onOk: () => doSubmit(answers),
    });
  };

  if (examQuery.isLoading) return <Card loading />;
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
    return (
      <div>
        <PageHeader
          title={attempt.examTitle}
          extra={
            <Countdown
              deadlineAt={attempt.deadlineAt ?? ''}
              prefix="剩余 "
              onExpire={() => void doSubmit(answers)}
            />
          }
        />
        {(attempt.questions ?? []).map((question, index) => (
          <QuestionCard
            key={question.id}
            index={index + 1}
            question={question}
            value={answers[question.id ?? 0] ?? []}
            onChange={(keys) => setAnswer(question.id ?? 0, keys)}
          />
        ))}
        <Button
          type="primary"
          size="large"
          loading={submitMutation.isPending}
          onClick={handleManualSubmit}
          // 两个汉字的按钮不自动插空格，保持参考图文案
          autoInsertSpace={false}
        >
          交卷
        </Button>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={exam.title}
        extra={<Button onClick={() => navigate('/exams')}>返回列表</Button>}
      />
      <Card>
        <Space direction="vertical" size={12}>
          {exam.description && (
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              {exam.description}
            </Typography.Paragraph>
          )}
          <Typography.Text>时长：{exam.durationMin} 分钟</Typography.Text>
          <Typography.Text>题数：{exam.questionCount}</Typography.Text>
          <Typography.Text>
            及格分 {exam.passScore} / 总分 {exam.totalScore}
          </Typography.Text>
          <Button type="primary" size="large" onClick={handleStart}>
            开始考试
          </Button>
        </Space>
      </Card>
    </div>
  );
}
