import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  moduleNameMapper: {
    '^@domain/(.*)$': '<rootDir>/domain/$1',
    '^@app/(.*)$': '<rootDir>/application/$1',
    '^@adapters/(.*)$': '<rootDir>/adapters/$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: './tsconfig.json',
    }],
  },
};

export default config;
