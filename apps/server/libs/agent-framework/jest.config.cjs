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
    '^@paralleldrive/cuid2$': '<rootDir>/__mocks__/cuid2.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
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