import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../src/shared/lesson.js';
import {
  ConfigSchema,
  previewConfig,
  createChildEnvironment,
  BriefSchema,
} from '../src/server/config.js';
test('preview nests version-correct options and never includes the server key', () => {
  const preview = previewConfig(DEFAULT_CONFIG);
  assert.match(preview.code, /options: \{/);
  assert.match(preview.code, /tools: \[\]/);
  assert.equal(preview.options.persistSession, false);
  assert.equal((preview.options.env as Record<string, string>).ANTHROPIC_API_KEY, '[server-only]');
  assert.equal(preview.schema, null);
});
test('structured recipe requests outputFormat and has a host validation contract', () => {
  const preview = previewConfig({ ...DEFAULT_CONFIG, recipe: 'structured' });
  assert.equal((preview.options.outputFormat as { type: string }).type, 'json_schema');
  assert.ok(preview.schema);
  assert.ok(!preview.code.includes('outputSchema'));
  assert.equal(
    BriefSchema.safeParse({
      projectName: 'Atlas',
      purpose: 'Tasks',
      keyComponents: ['domain'],
      recommendation: 'Add tests',
    }).success,
    true,
  );
  assert.equal(BriefSchema.safeParse({ projectName: 'Atlas' }).success, false);
});
test('new and resumed configurations use distinct identity fields', () => {
  const fresh = previewConfig({ ...DEFAULT_CONFIG, recipe: 'continuity' });
  const resumed = previewConfig({
    ...DEFAULT_CONFIG,
    recipe: 'continuity',
    continuation: 'resume',
  });
  assert.equal(fresh.options.persistSession, true);
  assert.ok('sessionId' in fresh.options);
  assert.ok(!('resume' in fresh.options));
  assert.ok('resume' in resumed.options);
  assert.ok(!('sessionId' in resumed.options));
});
test('child environment preserves needed platform/auth values and drops unrelated secrets', () => {
  const result = createChildEnvironment(
    {
      PATH: 'platform-bin',
      ANTHROPIC_API_KEY: 'private-server-test-key',
      UNRELATED_SECRET: 'do-not-forward',
      CLAUDE_CONFIG_DIR: 'untrusted-existing',
      LESSON_ENV: 'old',
    },
    'production',
  );
  assert.equal(result.PATH, 'platform-bin');
  assert.equal(result.ANTHROPIC_API_KEY, 'private-server-test-key');
  assert.equal(result.LESSON_ENV, 'production');
  assert.equal(result.UNRELATED_SECRET, undefined);
  assert.notEqual(result.CLAUDE_CONFIG_DIR, 'untrusted-existing');
});
for (const [label, change] of Object.entries({
  path: { workspace: '../outside' },
  extra: { env: { EVIL: 'value' } },
  turns: { maxTurns: 100 },
  cost: { budgetUsd: 2 },
  timeout: { timeoutSeconds: 0 },
  resume: { continuation: 'resume' },
  prompt: { prompt: 'short' },
}))
  test(`configuration rejects ${label} outside the host contract`, () => {
    assert.equal(ConfigSchema.safeParse({ ...DEFAULT_CONFIG, ...change }).success, false);
  });
