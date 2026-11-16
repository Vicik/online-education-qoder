import type { ExamQuestion } from '@/api/types';
import './QuestionCard.css';

// 单题作答：整行选项框，单选覆盖、多选增删；作答阶段不展示答案
export function QuestionCard(props: {
  index: number;
  question: ExamQuestion;
  value: string[];
  onChange: (answers: string[]) => void;
}) {
  // 当前题目
  const { question } = props;
  // 选项列表：接口字段可选，缺省按空处理
  const options = question.options ?? [];
  // 是否单选：决定控件类型与点击语义
  const single = question.type !== 'multiple';
  // 题型文案
  const typeLabel = single ? '单选题' : '多选题';

  // 点击选项：单选覆盖为该项，多选在已选集合中增删
  const toggle = (key: string) => {
    if (single) {
      props.onChange([key]);
      return;
    }
    props.onChange(
      props.value.includes(key)
        ? props.value.filter((item) => item !== key)
        : [...props.value, key],
    );
  };

  return (
    <section className="exam-question" id={`exam-question-${props.index}`}>
      <div className="exam-question-head">
        第{props.index}题 {typeLabel}
      </div>
      <div className="exam-question-body">
        <p className="exam-question-stem">{question.stem}</p>
        <p className="exam-question-label">答案：</p>
        <div className="exam-option-list">
          {options.map((option) => {
            // 选项 key：接口字段可选，缺省按空串处理
            const key = option.key ?? '';
            // 当前选项是否已选中
            const checked = props.value.includes(key);
            return (
              <label
                key={key}
                className={checked ? 'exam-option exam-option-checked' : 'exam-option'}
              >
                {/* 原生控件铺满选项框并隐藏，键盘与读屏仍可用 */}
                <input
                  type={single ? 'radio' : 'checkbox'}
                  className="exam-option-input"
                  name={`exam-question-${props.index}`}
                  value={key}
                  checked={checked}
                  aria-label={`${key} ${option.text ?? ''}`}
                  onChange={() => toggle(key)}
                />
                <span className="exam-option-key">{key}</span>
                <span className="exam-option-text">{option.text}</span>
              </label>
            );
          })}
        </div>
      </div>
    </section>
  );
}
