const tsconfig = require('./tsconfig.json');

/** 本机只跑单元测试；test/ 下依赖真实 DB/Redis 的集成与并发测试在 CI 执行（步骤 14 扩展）。 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.[tj]s$': [
      'ts-jest',
      { tsconfig: { ...tsconfig.compilerOptions, allowJs: true } },
    ],
  },
  // sanitize-html 的嵌套依赖是纯 ESM，Jest 的 CJS 运行时无法直接 require
  transformIgnorePatterns: [
    'node_modules[\\\\/](?!(sanitize-html|htmlparser2|domhandler|domutils|dom-serializer|entities|domelementtype)[\\\\/])',
  ],
  testEnvironment: 'node',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/main.ts',
    '!src/worker.ts',
  ],
  coverageDirectory: 'coverage',
  clearMocks: true,
};