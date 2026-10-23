export default {
  '*.{ts,js}': 'eslint --no-warn-ignored --fix',
  'apps/frontend/src/**/*.html': 'eslint --no-warn-ignored --fix',
  '*.{ts,js,mjs,cjs,json,html,css,scss,md}': 'prettier --write',
  '*': () => 'npm run test:related',
};
