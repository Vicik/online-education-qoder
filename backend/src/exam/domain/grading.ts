// 题目选项：key 为 A/B/C…，text 为选项内容
export interface QuestionOption {
  key: string; // 选项标识
  text: string; // 选项内容
}

// 发布时冻结的题目快照：用户端接口必须剥离 answer/analysis 后再返回
export interface QuestionSnapshot {
  questionId: number; // 题库题目 id
  type: 'single' | 'multiple'; // 单选/多选
  stem: string; // 题干
  options: QuestionOption[]; // 选项（2~6 个）
  score: number; // 题目分值（仅创建时确定）
  sortOrder?: number; // 组卷顺序
  answer: string[]; // 正确答案（仅服务端判分使用）
  analysis?: string; // 答案解析（仅交卷后返回）
}

// 判分汇总结果：score 为得分，total 为试卷总分
export interface GradeResult {
  score: number; // 实得总分
  total: number; // 试卷总分
}

// 单选判分：恰好一个答案且完全一致得 1 分（调用方再乘以题目分值），否则 0
export function gradeSingle(correct: string[], user: string[]): number {
  // 长度均为 1 且选项 key 相同才算完全匹配
  return correct.length === 1 && user.length === 1 && correct[0] === user[0]
    ? 1
    : 0;
}

// 多选判分：答案数量一致且全部命中得 1 分（无部分分），否则 0
export function gradeMultiple(correct: string[], user: string[]): number {
  // 数量不同必然存在漏选或多选，直接 0 分
  if (correct.length !== user.length) return 0;
  // 数量相同且正确答案全部包含时，不可能存在错选
  return correct.every((key) => user.includes(key)) ? 1 : 0;
}

// 试卷判分：按快照顺序逐题判分并累加题目分值；未作答/未知题号计 0 分
export function gradeAttempt(
  snapshot: QuestionSnapshot[], // 发布时冻结的题目快照
  answers: Record<string, string[]>, // 用户答案：题 id -> 选项 key 数组
): GradeResult {
  // 试卷总分：全部题目分值之和
  const total = snapshot.reduce((sum, question) => sum + question.score, 0);
  // 已得分数
  let score = 0;

  for (const question of snapshot) {
    // 用户对该题的作答：非数组视为未作答，避免异常入参导致判分崩溃
    const raw = answers[String(question.questionId)];
    const userAnswers = Array.isArray(raw) ? raw : [];
    // 按题型选择判分规则；完全匹配才计入该题分值
    const hit =
      question.type === 'single'
        ? gradeSingle(question.answer, userAnswers)
        : gradeMultiple(question.answer, userAnswers);
    if (hit) score += question.score;
  }

  return { score, total };
}
