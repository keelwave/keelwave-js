import { tanstackConfig } from '@tanstack/eslint-config'
import prettierConfig from 'eslint-config-prettier'

export default [
  ...tanstackConfig,
  // test and example stubs must satisfy async interfaces without real await
  {
    files: ['tests/**/*.ts', 'examples/**/*.ts'],
    rules: {
      '@typescript-eslint/require-await': 'off',
    },
  },
  prettierConfig,
]
