import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  coverageDirectory: '../coverage',
  collectCoverageFrom: [
    '**/*.ts',
    '!**/*.spec.ts',
    '!**/*.types.ts',
    '!**/index.ts',
    '!main.ts',
  ],
  coverageReporters: ['text', 'lcov', 'clover'],
  coverageThreshold: {
    // no global floor (most of the code is covered by the Golden Master and the DB specs, not by line counts)
    global: {},
    './src/domain/tournament/': {
      lines: 95,
      statements: 95,
    },
  },
  moduleNameMapper: {
    '^@domain/(.*)$': '<rootDir>/domain/$1',
    '^@app/(.*)$': '<rootDir>/application/$1',
    '^@adapters/(.*)$': '<rootDir>/adapters/$1',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: './tsconfig.json',
      },
    ],
  },
};

export default config;
