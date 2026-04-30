/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testMatch: [
    '<rootDir>/src/**/*.spec.ts',
    // Layer 1 routine-folder migration script tests live under <rootDir>/scripts/.
    // The script itself ships outside the gateway runtime bundle (it's a
    // one-off CLI), but its unit tests run alongside the rest of the suite.
    '<rootDir>/scripts/**/*.spec.ts',
  ],
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: '<rootDir>/tsconfig.json',
      },
    ],
  },
  collectCoverageFrom: [
    'src/**/*.(t|j)s',
    '!src/**/*.spec.(t|j)s',
    '!src/scripts/**',
  ],
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
    '^@team9/storage$': '<rootDir>/../../libs/storage/src/index.ts',
    '^@team9/observability$':
      '<rootDir>/../../libs/observability/src/index.ts',
    '^@team9/claw-hive$': '<rootDir>/../../libs/claw-hive/src/index.ts',
    '^@team9/posthog$': '<rootDir>/../../libs/posthog/src/index.ts',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@team9)/)',
  ],
};
