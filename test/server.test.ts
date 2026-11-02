import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApiHandler, type AppOptions } from '../src/server/app.js';
import { ScenarioRunner } from '../src/server/runner.js';
import { DEFAULT_CONFIG } from '../src/shared/lesson.js';
async function host(options: AppOptions = {}) {
  const app = createApiHandler({ liveAvailable: false, ...options });
  const server = createServer((req, res) => {
    void app(req, res).then((handled) => {
      if (!handled) {
        res.writeHead(404);
        res.end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  return {
    base,
    dispose: () => app.dispose(),
    post: (url: string, value: unknown, headers: Record<string, string> = {}) =>
      fetch(base + url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(value),
      }),
    async close() {
      await app.dispose();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
test('HTTP preview exposes only sanitized server configuration', async () => {
  const h = await host();
  try {
    const response = await h.post('/api/preview', DEFAULT_CONFIG);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.options.env.ANTHROPIC_API_KEY, '[server-only]');
    assert.equal(data.options.cwd, 'fixtures/workspaces/atlas');
    assert.ok(!JSON.stringify(data).includes('sk-ant-'));
  } finally {
    await h.close();
  }
});

test('the host rejects a second active run and awaits cancellation cleanup on shutdown', async () => {
  const runner = new ScenarioRunner();
  let cleaned = false;
  runner.run = async (_input, _mode, signal, emit) => {
    emit({ kind: 'host', title: 'Started', detail: 'Injected cancellable run.' });
    await new Promise<void>((resolve) =>
      signal.addEventListener('abort', () => resolve(), { once: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 15));
    cleaned = true;
    throw new Error('Cancelled by shutdown.');
  };
  const h = await host({ runner });
  try {
    const first = await h.post('/api/run', { mode: 'inspect', config: DEFAULT_CONFIG });
    assert.equal(first.status, 200);
    const second = await h.post('/api/run', { mode: 'inspect', config: DEFAULT_CONFIG });
    assert.equal(second.status, 409);
    await h.dispose();
    assert.equal(cleaned, true);
    assert.match(await first.text(), /cancelled/);
  } finally {
    await h.close();
  }
});
test('HTTP local inspection emits real tool evidence and a completed result', async () => {
  const h = await host();
  try {
    const response = await h.post('/api/run', {
      mode: 'inspect',
      config: { ...DEFAULT_CONFIG, workspace: 'beacon' },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type')!, /event-stream/);
    const events = await response.text();
    assert.match(events, /Real MCP tool result/);
    assert.match(events, /Beacon Notes/);
    assert.match(events, /"mode":"inspect"/);
    assert.match(events, /"kind":"done"/);
  } finally {
    await h.close();
  }
});
test('missing key rejects live mode rather than returning an inspection answer', async () => {
  const h = await host();
  try {
    const response = await h.post('/api/run', { mode: 'live', config: DEFAULT_CONFIG });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /API_KEY/);
  } finally {
    await h.close();
  }
});
test('configuration and HTTP boundaries reject invalid, cross-origin and oversized requests', async () => {
  const h = await host();
  try {
    assert.equal(
      (await h.post('/api/preview', DEFAULT_CONFIG, { Origin: 'https://example.com' })).status,
      403,
    );
    assert.equal(
      (await h.post('/api/preview', DEFAULT_CONFIG, { 'Content-Type': 'text/plain' })).status,
      415,
    );
    assert.equal((await h.post('/api/preview', { ...DEFAULT_CONFIG, budgetUsd: 900 })).status, 400);
    assert.equal(
      (await h.post('/api/preview', { ...DEFAULT_CONFIG, extra: 'x'.repeat(9000) })).status,
      400,
    );
    assert.equal(
      (await h.post('/api/run', { mode: 'invented', config: DEFAULT_CONFIG })).status,
      400,
    );
    assert.equal((await fetch(h.base + '/api/unknown')).status, 404);
  } finally {
    await h.close();
  }
});
test('metadata reports recipe choices and an initially empty resumable registry', async () => {
  const h = await host();
  try {
    const data = await (await fetch(h.base + '/api/meta')).json();
    assert.equal(data.version, '0.3.310');
    assert.equal(data.liveAvailable, false);
    assert.deepEqual(data.resumable, []);
    assert.deepEqual(Object.keys(data.recipes), ['review', 'structured', 'continuity']);
  } finally {
    await h.close();
  }
});
