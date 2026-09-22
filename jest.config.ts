import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    // uuid v9+ ships dist-node as ESM. Jest (CommonJS mode) needs the CJS build.
    '^uuid$': '<rootDir>/node_modules/uuid/dist/cjs/index.js',
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
