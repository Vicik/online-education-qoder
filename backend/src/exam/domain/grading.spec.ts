import {
  gradeAttempt,
  gradeMultiple,
  gradeSingle,
  QuestionSnapshot,
} from './grading';

// 题目快照构造：单选默认 5 分、多选默认 10 分
const snapshot: QuestionSnapshot[] = [
  {
    questionId: 1,
    type: 'single',
    stem: '1+1=?',
    options: [
      { key: 'A', text: '2' },
      { key: 'B', text: '3' },
    ],
    score: 5,
    sortOrder: 1,
    answer: ['A'],
    analysis: '显然',
  },
  {
    questionId: 2,
    type: 'multiple',
    stem: '偶数?',
    options: [
      { key: 'A', text: '2' },
      { key: 'B', text: '4' },
      { key: 'C', text: '5' },
    ],
    score: 10,
    sortOrder: 2,
    answer: ['A', 'B'],
    analysis: '2 和 4',
  },
];

describe('判分规则', () => {
  it('单选完全匹配得分，错选/多选/未答 0 分', () => {
    expect(gradeSingle(['A'], ['A'])).toBe(1);
    expect(gradeSingle(['A'], ['B'])).toBe(0);
    expect(gradeSingle(['A'], ['A', 'B'])).toBe(0);
    expect(gradeSingle(['A'], [])).toBe(0);
  });

  it('多选完全匹配且无错选才得分，无部分分', () => {
    expect(gradeMultiple(['A', 'C'], ['A', 'C'])).toBe(1);
    expect(gradeMultiple(['A', 'C'], ['C', 'A'])).toBe(1);
    expect(gradeMultiple(['A', 'C'], ['A'])).toBe(0); // 漏选
    expect(gradeMultiple(['A', 'C'], ['A', 'B'])).toBe(0); // 错选
    expect(gradeMultiple(['A', 'C'], ['A', 'C', 'B'])).toBe(0); // 多选
    expect(gradeMultiple(['A', 'C'], [])).toBe(0); // 未答
  });

  it('gradeAttempt 汇总总分；未答题计 0 分；选项顺序不影响判分', () => {
    expect(gradeAttempt(snapshot, { '1': ['A'], '2': ['A', 'B'] })).toEqual({
      score: 15,
      total: 15,
    });
    expect(gradeAttempt(snapshot, { '1': ['A'], '2': ['B'] })).toEqual({
      score: 5,
      total: 15,
    });
    expect(gradeAttempt(snapshot, {})).toEqual({ score: 0, total: 15 });
  });

  it('gradeAttempt 忽略快照中不存在的题号', () => {
    expect(gradeAttempt(snapshot, { '999': ['A'] })).toEqual({
      score: 0,
      total: 15,
    });
  });
});
