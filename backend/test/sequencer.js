const Sequencer = require('@jest/test-sequencer').default;

// 集成测试自定义排序器：冒烟用例校验种子初始状态，必须最先执行
class SmokeFirstSequencer extends Sequencer {
  // 排序：smoke.spec.ts 置顶，其余沿用 Jest 默认规则（失败优先/耗时/文件大小）
  sort(tests) {
    // 先取默认排序结果
    const sorted = super.sort(tests);
    // 依赖未变动种子数据的冒烟套件
    const smoke = sorted.filter((test) => test.path.endsWith('smoke.spec.ts'));
    // 其余套件保持默认顺序
    const rest = sorted.filter((test) => !test.path.endsWith('smoke.spec.ts'));
    // 冒烟套件优先执行
    return [...smoke, ...rest];
  }
}

module.exports = SmokeFirstSequencer;
