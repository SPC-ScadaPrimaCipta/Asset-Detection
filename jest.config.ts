import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    // uuid v14 ships pure ESM (unparseable by Jest CJS mode).
    // Accuracy tests are pure-function (never call uuidv4 at runtime) → stub.
    '^uuid$': '<rootDir>/__tests__/uuid-stub.cjs',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: [
    'lib/**/*.ts',
    'workers/**/*.ts',
    '!lib/env.ts',
  ],
};

export default config;
