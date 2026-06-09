import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // `dist` = build output. `_parked` dirs hold defined-but-never-rendered
  // orphan components (see CLAUDE.md) — intentionally dead, so their stale
  // identifier references should not pollute the `no-undef` signal.
  globalIgnores(['dist', '**/_parked/**']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // no-undef is the guard against the recurring "X is not defined" runtime
      // errors (e.g. `mono is not defined`) that Vite ships silently because
      // they only fault at render time. Keep it ON as an error.
      'no-undef': 'error',
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  {
    // Node-context harnesses + runners legitimately use `process`, `Buffer`,
    // `require`, etc. Give them node globals so they don't false-positive on
    // no-undef and drown out genuine browser-side undefined-identifier bugs.
    files: ['**/__validation__/**', '**/*.runner.js'],
    languageOptions: { globals: { ...globals.node } },
  },
])
