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
    '^@team9/database/schemas$':
      '<rootDir>/../../libs/database/src/schemas/index.ts',
    '^@team9/rabbitmq$': '<rootDir>/../../libs/rabbitmq/src/index.ts',
    '^@team9/auth$': '<rootDir>/../../libs/auth/src/index.ts',
    '^@team9/email$': '<rootDir>/../../libs/email/src/index.ts',
    '^@team9/ai-client$': '<rootDir>/../../libs/ai-client/src/index.ts',
    '^@team9/claw-hive$': '<rootDir>/../../libs/claw-hive/src/index.ts',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@team9)/)',
  ],
};
