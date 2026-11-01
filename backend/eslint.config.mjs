// @ts-check
// Lint = correctness rules only (typescript-eslint, type-checked). Formatting is left to Prettier (.prettierrc):
// eslint-config-prettier turns off the rules that would fight it.
import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs', 'dist/**', 'coverage/**', 'public/**', 'scripts/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintConfigPrettier,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      // an empty catch = "failure ignored on purpose" (JSON that does not parse, best-effort Redis read)
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Phase (string union, Redis values) and the MatchPhase enum carry the same values on purpose
      '@typescript-eslint/no-unsafe-enum-comparison': 'off',
      // "_" prefix = unused on purpose (an interface's parameter, a caught error the code does not need)
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true, // const { steps, ...run } = x: drops steps on purpose
        },
      ],
    },
  },
  {
    // Legacy: match-engine files that still read event payloads and Redis values as `any` (GenericMatchEvent in
    // domain/events/match.event.ts). The "any" rules are off for them only; every other file must be typed.
    // Remove a file from this list once it is typed - never add one.
    files: [
      'src/adapters/ws/dto/events.mapper.ts',
      'src/application/match/backup/round-backup.service.ts',
      'src/application/match/rules/live.rule.ts',
      'src/application/match/sandbox/sandbox.service.ts',
      'src/application/match/state/snapshot.query.ts',
      'src/application/subscribers/database-events.handler.ts',
      'src/application/subscribers/kill-bomb-events.handler.ts',
      'src/application/subscribers/match-events.handler.ts',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    // Specs build partial mocks (jest.fn(), objects cast to the service they stand for): the "any" family and
    // expect(mock.method) would flag every one of them. The specs are still type-checked (npm run typecheck).
    files: ['**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
);
