/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testMatch: ['**/__tests__/**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: false,
        tsconfig: {
          module: 'CommonJS',
          moduleResolution: 'node',
        },
      },
    ],
  },
  moduleNameMapper: {
    '^@team9/agent-framework$': '<rootDir>/../../agent-framework/src/index.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  collectCoverageFrom: [
    '**/*.ts',
    '!**/__tests__/**',
    '!**/index.ts',
  ],
  coverageDirectory: '../coverage',
  verbose: true,
};