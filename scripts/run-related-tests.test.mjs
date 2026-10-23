import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  companionCandidates,
  expandWithCompanions,
  isTestablePath,
  main,
  planRelatedRuns,
  withKeepIndexIsolation,
  workingTreeHasUnstagedContent,
} from './run-related-tests.mjs';

test('treats source, template and script files as testable', () => {
  assert.equal(isTestablePath('apps/backend/src/lib/rateLimit.ts'), true);
  assert.equal(isTestablePath('apps/frontend/src/app/home.component.html'), true);
  assert.equal(isTestablePath('scripts/run-related-tests.mjs'), true);
  assert.equal(isTestablePath('docs/TESTING.md'), false);
});

test('adds sibling specs for sources but not for existing tests', () => {
  assert.deepEqual(companionCandidates('apps/frontend/src/app/home.component.html'), [
    'apps/frontend/src/app/home.component.spec.ts',
    'apps/frontend/src/app/home.component.test.ts',
    'apps/frontend/src/app/home.component.spec.mjs',
    'apps/frontend/src/app/home.component.test.mjs',
  ]);
  assert.deepEqual(companionCandidates('scripts/run-related-tests.test.mjs'), []);
});

test('plans vitest runs per workspace and node tests for scripts', () => {
  const exists = (path) =>
    path === 'apps/frontend/src/app/home.component.spec.ts' ||
    path === 'scripts/run-related-tests.test.mjs' ||
    path === 'apps/backend/src/lib/rateLimit.ts';

  const runs = planRelatedRuns(
    [
      'docs/TESTING.md',
      'apps/frontend/src/app/home.component.html',
      'apps/backend/src/lib/rateLimit.ts',
      'scripts/run-related-tests.mjs',
    ],
    exists,
  );

  assert.deepEqual(
    runs.map((run) => ({ kind: run.kind, id: run.id, files: run.files })),
    [
      {
        kind: 'vitest',
        id: 'backend',
        files: ['src/lib/rateLimit.ts'],
      },
      {
        kind: 'vitest',
        id: 'frontend',
        files: ['src/app/home.component.html', 'src/app/home.component.spec.ts'],
      },
      {
        kind: 'node-test',
        id: 'scripts',
        files: ['scripts/run-related-tests.test.mjs'],
      },
    ],
  );
});

test('expands only companions that exist', () => {
  assert.deepEqual(
    expandWithCompanions(['apps/backend/src/lib/missing.ts'], () => false),
    ['apps/backend/src/lib/missing.ts'],
  );
});

test('skips docs-only staged sets without running commands', () => {
  const executed = [];
  const status = main(['--files', 'docs/TESTING.md', 'README.md'], {
    execute: (run) => {
      executed.push(run);
      return 0;
    },
    log() {},
  });
  assert.equal(status, 0);
  assert.deepEqual(executed, []);
});

test('fails when any planned run fails', () => {
  const status = main(['--files', 'apps/backend/src/lib/rateLimit.ts'], {
    exists: () => false,
    execute: () => 2,
    log() {},
  });
  assert.equal(status, 1);
});

test('plans full dependent workspace runs when a shared library changes', () => {
  const runs = planRelatedRuns(['libs/shared-types/src/schemas.ts'], () => false);
  assert.deepEqual(
    runs.map((run) => ({ kind: run.kind, id: run.id })),
    [
      { kind: 'vitest', id: 'shared-types' },
      { kind: 'vitest-full', id: 'session-export-report' },
      { kind: 'vitest-full', id: 'backend' },
      { kind: 'vitest-full', id: 'frontend' },
    ],
  );
});

test('detects unstaged or untracked porcelain rows', () => {
  assert.equal(workingTreeHasUnstagedContent('M  staged-only.ts\n'), false);
  assert.equal(workingTreeHasUnstagedContent('MM both.ts\n'), true);
  assert.equal(workingTreeHasUnstagedContent(' M unstaged.ts\n'), true);
  assert.equal(workingTreeHasUnstagedContent('?? new-file.ts\n'), true);
});

test('keep-index isolation reads staged content instead of an unstaged fix', () => {
  const dir = mkdtempSync(join(tmpdir(), 'related-keep-index-'));
  const git = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  try {
    git(['init', '-b', 'main']);
    git(['config', 'user.email', 'related-tests@example.test']);
    git(['config', 'user.name', 'Related Tests']);
    writeFileSync(join(dir, 'value.mjs'), 'export const value = 1;\n');
    git(['add', 'value.mjs']);
    git(['commit', '-m', 'init']);
    writeFileSync(join(dir, 'value.mjs'), 'export const value = 2;\n');
    git(['add', 'value.mjs']);
    writeFileSync(join(dir, 'value.mjs'), 'export const value = 1;\n');

    let isolated = '';
    withKeepIndexIsolation(() => {
      isolated = readFileSync(join(dir, 'value.mjs'), 'utf8');
      return 0;
    }, git);

    assert.match(isolated, /value = 2/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
