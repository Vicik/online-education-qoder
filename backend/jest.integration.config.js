const tsconfig = require('./tsconfig.json');

/** 集成/并发测试配置：依赖真实 Postgres/Redis，本机无 DB 时只在 CI 执行（npm run test:all）。 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  roots: ['<rootDir>/test'],
  testMatch: ['<rootDir>/test/**/*.spec.ts'],
  transform: {
    '^.+\\.[tj]s$': [
      'ts-jest',
      { tsconfig: { ...tsconfig.compilerOptions, allowJs: true } },
    ],
  },
  transformIgnorePatterns: [
    'node_modules[\\\\/](?!(sanitize-html|htmlparser2|domhandler|domutils|dom-serializer|entities|domelementtype)[\\\\/])',
  ],
  testEnvironment: 'node',
  testTimeout: 30000,
  clearMocks: true,
  // 冒烟用例依赖种子初始状态，固定最先执行
  testSequencer: '<rootDir>/test/sequencer.js',
};
