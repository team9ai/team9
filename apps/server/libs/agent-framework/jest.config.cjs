/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testMatch: ['**/__tests__/**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  moduleNameMapper: {
    '^@paralleldrive/cuid2$': '<rootDir>/__mocks__/cuid2.ts',
  },
  modulePathIgnorePatterns: ['<rootDir>/storage/postgres/'],
  collectCoverageFrom: [
    '**/*.ts',
    '!**/__tests__/**',
    '!**/__mocks__/**',
    '!**/index.ts',
    '!**/storage/postgres/**',
  ],
  coverageDirectory: '../coverage',
  verbose: true,
};
