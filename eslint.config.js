import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
export default [{ ignores: ['dist','node_modules'] }, { files: ['**/*.ts'], languageOptions: { parser: tsParser, parserOptions: { ecmaVersion: 'latest', sourceType: 'module' } }, plugins: { '@typescript-eslint': tseslint }, rules: { ...tseslint.configs.recommended.rules, '@typescript-eslint/no-explicit-any': 'off' } }, ...svelte.configs['flat/recommended'], { files: ['**/*.svelte'], languageOptions: { parserOptions: { parser: tsParser, extraFileExtensions: ['.svelte'] } } }, prettier];
