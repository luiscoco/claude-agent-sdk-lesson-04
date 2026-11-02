import type { IncomingMessage, ServerResponse } from 'node:http';
import { VERSION, RECIPES } from '../shared/lesson.js';
import { previewConfig } from './config.js';
import { ScenarioRunner, redact } from './runner.js';
export function json(response: ServerResponse, status: number, data: unknown) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(data));
}
async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > 8192) throw new Error('Input too large.');
    chunks.push(Buffer.from(chunk));
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Expected an object.');
  return value as Record<string, unknown>;
}
export interface AppOptions {
  liveAvailable?: boolean;
  runner?: ScenarioRunner;
}
export function createApiHandler(options: AppOptions = {}) {
  const runner = options.runner ?? new ScenarioRunner();
  let active: AbortController | undefined;
  let runFinished: Promise<void> | undefined;
  const available = () => options.liveAvailable ?? Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  const api = async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (!pathname.startsWith('/api/')) return false;
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.host ?? '')) {
      json(response, 403, { error: 'Use the local application URL.' });
      return true;
    }
    if (request.method === 'GET' && pathname === '/api/meta') {
      json(response, 200, {
        version: VERSION,
        liveAvailable: available(),
        model: process.env.ANTHROPIC_MODEL || 'SDK default',
        platform: process.platform,
        recipes: RECIPES,
        resumable: runner.resumable(),
      });
      return true;
    }
    if (request.method !== 'POST' || !['/api/preview', '/api/run'].includes(pathname)) {
      json(response, 404, { error: 'Unknown API endpoint.' });
      return true;
    }
    if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) {
      json(response, 403, { error: 'Cross-origin requests are not allowed.' });
      return true;
    }
    if (!request.headers['content-type']?.startsWith('application/json')) {
      json(response, 415, { error: 'Send application/json.' });
      return true;
    }
    let input: Record<string, unknown>;
    try {
      input = await readBody(request);
    } catch {
      json(response, 400, { error: 'Provide a JSON object no larger than 8 KB.' });
      return true;
    }
    let preview;
    try {
      preview = previewConfig(pathname === '/api/preview' ? input : input.config);
    } catch {
      json(response, 400, {
        error:
          'Use valid recipe settings: prompt 10–2,000 characters, turns 2–8, budget $0.03–$0.50, timeout 15–120 seconds. Resume requires continuity.',
      });
      return true;
    }
    if (pathname === '/api/preview') {
      json(response, 200, preview);
      return true;
    }
    const mode = input.mode;
    if (mode !== 'inspect' && mode !== 'live') {
      json(response, 400, { error: 'Choose inspect or live mode.' });
      return true;
    }
    if (mode === 'live' && !available()) {
      json(response, 409, {
        error: 'Live mode requires ANTHROPIC_API_KEY in the server .env file.',
      });
      return true;
    }
    if (mode === 'live' && preview.config.requireSandbox && process.platform === 'win32') {
      json(response, 400, {
        error:
          'The required OS sandbox is unavailable on Windows. Choose tools-only mode or use a supported OS with its dependencies.',
      });
      return true;
    }
    if (
      mode === 'live' &&
      preview.config.continuation === 'resume' &&
      !runner.resumable().includes(preview.config.workspace)
    ) {
      json(response, 409, { error: 'First complete a new persistent session for this workspace.' });
      return true;
    }
    if (active) {
      json(response, 409, {
        error: 'A scenario is already running. Stop it before starting another.',
      });
      return true;
    }
    const controller = new AbortController();
    active = controller;
    let finishRun!: () => void;
    const completion = new Promise<void>((resolve) => {
      finishRun = resolve;
    });
    runFinished = completion;
    const disconnect = () => controller.abort();
    response.on('close', disconnect);
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    const send = (event: unknown) => {
      if (!response.destroyed) response.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const heartbeat = setInterval(() => {
      if (!response.destroyed) response.write(': waiting\n\n');
    }, 10000);
    try {
      const result = await runner.run(preview.config, mode, controller.signal, send);
      send({
        kind: 'result',
        title: mode === 'live' ? 'SDK result' : 'Inspection result',
        detail: result.text,
        data: result,
      });
      send({ kind: 'done', title: 'Finished', detail: result.ok ? 'success' : 'error' });
    } catch (error) {
      send({
        kind: 'error',
        title: controller.signal.aborted ? 'Cancelled' : 'Scenario failed',
        detail: controller.signal.aborted
          ? 'The host cancelled the scenario.'
          : redact(error instanceof Error ? error.message : 'Scenario failed.'),
      });
      send({
        kind: 'done',
        title: 'Finished',
        detail: controller.signal.aborted ? 'cancelled' : 'error',
      });
    } finally {
      clearInterval(heartbeat);
      response.removeListener('close', disconnect);
      controller.abort();
      active = undefined;
      response.end();
      finishRun();
      if (runFinished === completion) runFinished = undefined;
    }
    return true;
  };
  return Object.assign(api, {
    async dispose() {
      active?.abort();
      await runFinished;
    },
  });
}
