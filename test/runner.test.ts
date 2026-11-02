import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { SDKMessage, query } from '@anthropic-ai/claude-agent-sdk';
import { ScenarioRunner, buildRequest, type QueryFactory } from '../src/server/runner.js';
import { createProjectServer, TOOL_NAME } from '../src/server/project-tool.js';
import { DEFAULT_CONFIG, type RunEvent } from '../src/shared/lesson.js';
const brief = {
  projectName: 'Atlas Tasks',
  purpose: 'Track tasks',
  keyComponents: ['Domain'],
  recommendation: 'Add tests',
};
function success(extra: Record<string, unknown> = {}): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'Test answer',
    structured_output: brief,
    total_cost_usd: 0.001,
    usage: { input_tokens: 10, output_tokens: 5 },
    modelUsage: {},
    session_id: randomUUID(),
    ...extra,
  } as SDKMessage;
}
test('local inspection performs a real MCP round trip against the selected workspace', async () => {
  for (const workspace of ['atlas', 'beacon'] as const) {
    const events: RunEvent[] = [];
    let queries = 0;
    const result = await new ScenarioRunner().run(
      { ...DEFAULT_CONFIG, workspace },
      'inspect',
      new AbortController().signal,
      (e) => events.push(e),
      () => {
        queries++;
        throw new Error('A local inspection must not query a model.');
      },
    );
    assert.equal(result.ok, true);
    assert.equal(result.mode, 'inspect');
    assert.equal(queries, 0);
    const tool = events.find((e) => e.title === 'Real MCP tool result');
    assert.ok(tool);
    assert.match(JSON.stringify(tool.data), workspace === 'atlas' ? /Atlas Tasks/ : /Beacon Notes/);
    assert.ok(events.some((e) => e.title === 'Cleanup'));
  }
});
test('live request binds tools, env, hooks, limits, output and cleanup at the host boundary', async () => {
  let request!: Parameters<typeof query>[0];
  let closed = 0;
  const factory: QueryFactory = (input) => {
    request = input;
    return {
      async *[Symbol.asyncIterator]() {
        yield success();
      },
      close() {
        closed++;
      },
    };
  };
  const result = await new ScenarioRunner().run(
    { ...DEFAULT_CONFIG, recipe: 'structured' },
    'live',
    new AbortController().signal,
    () => {},
    factory,
  );
  assert.equal(result.validated, true);
  assert.equal(closed, 1);
  assert.deepEqual(request.options?.tools, []);
  assert.deepEqual(request.options?.allowedTools, []);
  assert.equal(request.options?.env?.LESSON_ENV, 'development');
  assert.equal(request.options?.maxTurns, 6);
  assert.equal(request.options?.maxBudgetUsd, 0.25);
  assert.equal(request.options?.persistSession, false);
  assert.equal(request.options?.outputFormat?.type, 'json_schema');
  assert.ok(request.options?.hooks?.PreToolUse);
  assert.deepEqual(request.options?.skills, []);
});
test('host permission callback accepts only bounded registered tool input', async () => {
  const hosted = createProjectServer('atlas');
  try {
    const request = buildRequest(DEFAULT_CONFIG, hosted, new AbortController(), () => {});
    const approve = request.options!.canUseTool!;
    const context = {
      signal: new AbortController().signal,
      mcpServer: { name: 'project', source: 'sdk' },
    };
    assert.equal(
      (await approve(TOOL_NAME, { file: 'README.md' }, context as never))?.behavior,
      'allow',
    );
    assert.equal(
      (await approve(TOOL_NAME, { file: '../../.env' }, context as never))?.behavior,
      'deny',
    );
    assert.equal(
      (await approve('Bash', { command: 'echo unsafe' }, context as never))?.behavior,
      'deny',
    );
    assert.equal(
      (
        await approve(TOOL_NAME, { file: 'README.md' }, {
          ...context,
          mcpServer: { name: 'project', source: 'project' },
        } as never)
      )?.behavior,
      'deny',
    );
  } finally {
    await hosted.instance.close();
  }
});
test('resume uses only a successful server-owned session for the same workspace', async () => {
  const runner = new ScenarioRunner();
  const id = randomUUID();
  const requests: Parameters<typeof query>[0][] = [];
  const factory: QueryFactory = (input) => {
    requests.push(input);
    return {
      async *[Symbol.asyncIterator]() {
        yield success({ session_id: id });
      },
      close() {},
    };
  };
  await assert.rejects(
    runner.run(
      { ...DEFAULT_CONFIG, recipe: 'continuity', continuation: 'resume' },
      'live',
      new AbortController().signal,
      () => {},
      factory,
    ),
    /successful persistent/,
  );
  await runner.run(
    { ...DEFAULT_CONFIG, recipe: 'continuity' },
    'live',
    new AbortController().signal,
    () => {},
    factory,
  );
  await runner.run(
    { ...DEFAULT_CONFIG, recipe: 'continuity', continuation: 'resume' },
    'live',
    new AbortController().signal,
    () => {},
    factory,
  );
  assert.ok(requests[0]!.options?.sessionId);
  assert.equal(requests[1]!.options?.resume, id);
  assert.equal(requests[1]!.options?.sessionId, undefined);
  assert.deepEqual(runner.resumable(), ['atlas']);
  await assert.rejects(
    runner.run(
      { ...DEFAULT_CONFIG, workspace: 'beacon', recipe: 'continuity', continuation: 'resume' },
      'live',
      new AbortController().signal,
      () => {},
      factory,
    ),
    /successful persistent/,
  );
});
test('invalid structured output is rejected and still closes the query', async () => {
  let closed = 0;
  await assert.rejects(
    new ScenarioRunner().run(
      { ...DEFAULT_CONFIG, recipe: 'structured' },
      'live',
      new AbortController().signal,
      () => {},
      () => ({
        async *[Symbol.asyncIterator]() {
          yield success({ structured_output: { wrong: true } });
        },
        close() {
          closed++;
        },
      }),
    ),
    /host structured-output validation/,
  );
  assert.equal(closed, 1);
});
test('an SDK error result is not successful or saved as resumable', async () => {
  const runner = new ScenarioRunner();
  const result = await runner.run(
    { ...DEFAULT_CONFIG, recipe: 'continuity' },
    'live',
    new AbortController().signal,
    () => {},
    () => ({
      async *[Symbol.asyncIterator]() {
        yield {
          ...success(),
          subtype: 'error_max_turns',
          is_error: true,
          errors: ['Turn limit reached'],
        } as SDKMessage;
      },
      close() {},
    }),
  );
  assert.equal(result.ok, false);
  assert.match(result.text, /Turn limit/);
  assert.deepEqual(runner.resumable(), []);
});
test('a stream failure and missing result both close their query handle', async () => {
  for (const fail of [false, true]) {
    let closed = 0;
    await assert.rejects(
      new ScenarioRunner().run(
        DEFAULT_CONFIG,
        'live',
        new AbortController().signal,
        () => {},
        () => ({
          async *[Symbol.asyncIterator]() {
            if (fail) throw new Error('Stream failed');
          },
          close() {
            closed++;
          },
        }),
      ),
      fail ? /Stream failed/ : /without a result/,
    );
    assert.equal(closed, 1);
  }
});
test('pre-aborted requests never create a model query', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(
    new ScenarioRunner().run(
      DEFAULT_CONFIG,
      'live',
      controller.signal,
      () => {},
      () => {
        calls++;
        throw new Error('Unexpected');
      },
    ),
    /abort/i,
  );
  assert.equal(calls, 0);
});
test('MCP schema rejects path traversal before reading any file', async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  let reads = 0;
  const hosted = createProjectServer('atlas', () => reads++);
  const client = new Client({ name: 'test', version: '1.0.0' });
  try {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await hosted.instance.connect(b);
    await client.connect(a);
    const result = await client.callTool({
      name: 'read_project_note',
      arguments: { file: '../../.env' },
    });
    assert.equal(result.isError, true);
    assert.equal(reads, 0);
  } finally {
    await client.close();
    await hosted.instance.close();
  }
});
