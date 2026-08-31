module.exports = {
  extends: '../../.eslintrc',
  parserOptions: {
    project: ['./tsconfig.lib.json', './tsconfig.spec.json'],
    tsconfigRootDir: __dirname
  },
  rules: {},
  ignorePatterns: ['!**/*', '**/*.test.ts']
}
