import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'CommonJS',
          moduleResolution: 'Node',
          verbatimModuleSyntax: false,
          isolatedModules: true,
          types: ['jest', 'node'],
          ignoreDeprecations: '6.0',
        },
      },
    ],
  },
  testMatch: ['**/*.integration.test.ts'],
  globalSetup: './src/test-utils/globalSetup.ts',
  globalTeardown: './src/test-utils/globalTeardown.ts',
  clearMocks: true,
};

export default config;
