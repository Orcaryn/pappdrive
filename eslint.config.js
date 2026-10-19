import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import noLongDashes from './eslint-rules/no-long-dashes.js';
import requireElseIf from './eslint-rules/require-else-if.js';

const typescriptFiles = ['packages/**/*.ts', 'examples/**/*.ts'];
const projectFiles = ['packages/*/src/**/*.ts', 'packages/*/test/**/*.ts', 'examples/*/src/**/*.ts'];
const domainFiles = ['packages/protocol/src/**/*.ts', 'packages/pappdrive/src/{papp,shared}/**/*.ts', 'packages/server/src/**/*.ts'];
const proseFiles = ['**/*.{ts,js,mjs,cjs}'];
const constFunctionDeclaration = {
  selector: "VariableDeclaration[kind='const']:has(VariableDeclarator[init.type=/^(ArrowFunctionExpression|FunctionExpression)$/][init.body.type='BlockStatement'])",
};
const avoidOrDefaultMessage = 'Avoid || defaults because they collapse distinct falsy values. Handle the expected state explicitly.';
const workspaceRestrictedSyntax = [
  { selector: "UnaryExpression[operator='typeof']", message: 'Avoid ad-hoc runtime type branching. Parse unknown input at the boundary and operate on concrete types.' },
  {
    selector: "CatchClause ReturnStatement[argument.type='Literal'][argument.value=true]",
    message: 'Never convert an exception into success. Translate it to the boundary contract or let it propagate.',
  },
  {
    selector: 'TSUnionType:has(TSNullKeyword):has(TSUndefinedKeyword)',
    message: 'Do not model absence as both null and undefined. Use the concrete domain type, or an optional value when absence is part of the interface.',
  },
  { selector: "LogicalExpression[operator='||'][right.type='ArrayExpression'][right.elements.length=0]", message: avoidOrDefaultMessage },
  { selector: "LogicalExpression[operator='||'][right.type='ObjectExpression'][right.properties.length=0]", message: avoidOrDefaultMessage },
  { selector: "LogicalExpression[operator='||'][right.type='Literal']", message: avoidOrDefaultMessage },
  { selector: "LogicalExpression[operator='||'][right.type='TemplateLiteral'][right.expressions.length=0]", message: avoidOrDefaultMessage },
];
const noAbsenceSubstitute = {
  selector: "LogicalExpression[operator='??']:not([right.type='ArrayExpression'][right.elements.length=0]):not([right.type='ObjectExpression'][right.properties.length=0])",
  message:
    'Domain and data code should not replace absence with a substitute value. Make the value required or handle the missing state explicitly. Only ?? [] and ?? {} are allowed, because an empty collection is absence.',
};
const packageImport = (packages, message) => ({
  'no-restricted-imports': ['error', { patterns: [{ group: packages.flatMap(name => [name, `${name}/**`, `**/${name.replace(/^@pappdrive\//, '')}/**`]), message }] }],
});

export default defineConfig([
  { name: 'workspace/ignores', ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/.wrangler/**', '**/.astro/**', 'packages/pappdrive/docs/**'] },
  {
    name: 'workspace/prose',
    files: proseFiles,
    plugins: { dashes: { rules: { 'no-long-dashes': noLongDashes } }, personal: { rules: { 'require-else-if': requireElseIf } } },
    rules: { 'dashes/no-long-dashes': 'error' },
  },
  {
    name: 'workspace/config',
    files: ['.dependency-cruiser.js', 'eslint.config.js', 'eslint-rules/**/*.js', 'scripts/**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    name: 'workspace/typescript',
    files: typescriptFiles,
    extends: [js.configs.recommended, tseslint.configs.recommended],
    plugins: { '@stylistic': stylistic },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      curly: ['error', 'all'],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'init-declarations': ['error', 'always'],
      'arrow-body-style': ['error', 'as-needed'],
      'no-unneeded-ternary': 'error',
      'object-shorthand': 'error',
      'prefer-const': 'error',
      'prefer-object-spread': 'error',
      '@stylistic/padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: 'import', next: '*' },
        { blankLine: 'never', prev: 'import', next: 'import' },
        { blankLine: 'never', prev: ['const', 'let', 'var'], next: ['const', 'let', 'var'] },
        { blankLine: 'always', prev: '*', next: constFunctionDeclaration },
        { blankLine: 'always', prev: constFunctionDeclaration, next: '*' },
        { blankLine: 'always', prev: '*', next: ['for', 'if', 'switch', 'function'] },
        { blankLine: 'always', prev: 'block-like', next: '*' },
        { blankLine: 'always', prev: '*', next: ['return', 'throw'] },
      ],
      '@stylistic/lines-between-class-members': ['error', 'always', { exceptAfterSingleLine: true, exceptAfterOverload: true }],
      'no-restricted-syntax': ['error', ...workspaceRestrictedSyntax],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true, varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],
      '@typescript-eslint/no-unused-expressions': 'error',
      '@typescript-eslint/array-type': ['error', { default: 'array' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'separate-type-imports', prefer: 'type-imports' }],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      'personal/require-else-if': 'error',
    },
  },
  { name: 'workspace/domain-data', files: domainFiles, rules: { 'no-restricted-syntax': ['error', ...workspaceRestrictedSyntax, noAbsenceSubstitute] } },
  {
    name: 'server/boundary-parser',
    files: ['packages/server/src/shared/validate.ts'],
    rules: { 'no-restricted-syntax': ['error', ...workspaceRestrictedSyntax.filter(rule => !rule.selector.includes("'typeof'")), noAbsenceSubstitute] },
  },
  {
    name: 'workspace/type-aware-typescript',
    files: projectFiles,
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-for-in-array': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/prefer-promise-reject-errors': 'error',
      '@typescript-eslint/restrict-template-expressions': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },
  { name: 'protocol/shared', files: ['packages/protocol/src/**/*.ts'], rules: packageImport(['pappdrive', '@pappdrive/server'], 'The protocol cannot import other packages.') },
  {
    name: 'server/worker',
    files: ['packages/server/src/**/*.ts'],
    languageOptions: { globals: globals.serviceworker },
    rules: packageImport(['pappdrive'], 'The server cannot import client code.'),
  },
  { name: 'pappdrive/library', files: ['packages/pappdrive/src/**/*.ts'], rules: packageImport(['@pappdrive/server'], 'The library cannot import the server.') },
  { name: 'pappdrive/node', files: ['packages/pappdrive/src/{node,cli}/**/*.ts', 'packages/*/test/**/*.ts', 'packages/*/*.config.ts'], languageOptions: { globals: globals.node } },
  {
    name: 'pappdrive/browser',
    files: ['packages/pappdrive/src/browser/**/*.ts', 'examples/journal-web/src/**/*.ts'],
    languageOptions: { globals: globals.browser },
    rules: { 'no-console': ['error', { allow: ['error', 'warn'] }] },
  },
  {
    name: 'examples/node',
    files: ['examples/journal-electron/{main,keystore}.js', 'examples/notes-cli/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    name: 'examples/electron-preload',
    files: ['examples/journal-electron/preload.cjs'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node, sourceType: 'commonjs' },
  },
  { name: 'examples/browser', files: ['examples/journal-electron/renderer.js'], extends: [js.configs.recommended], languageOptions: { globals: globals.browser } },
]);
