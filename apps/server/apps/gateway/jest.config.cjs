/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: '<rootDir>/tsconfig.json',
      },
    ],
  },
  collectCoverageFrom: ['src/**/*.(t|j)s'],
  coverageDirectory: 'coverage',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@team9/redis$': '<rootDir>/../../libs/redis/src/index.ts',
    '^@team9/shared$': '<rootDir>/../../libs/shared/src/index.ts',
    '^@team9/database$': '<rootDir>/../../libs/database/src/index.ts',
    '^@team9/rabbitmq$': '<rootDir>/../../libs/rabbitmq/src/index.ts',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@team9)/)',
  ],
};
