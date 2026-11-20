import js from '@eslint/js'
import ts from 'typescript-eslint'
import hooks from 'eslint-plugin-react-hooks'

export default [
  { ignores: ['dist/**', 'coverage/**', 'playwright-report/**', 'test-results/**', '.codex/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  { files: ['**/*.tsx'], ...hooks.configs.flat.recommended },
]
