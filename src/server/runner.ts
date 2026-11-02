import { query, type Query, type SDKMessage, type Options } from '@anthropic-ai/claude-agent-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { BriefSchema, ConfigSchema, OUTPUT_SCHEMA, createChildEnvironment } from './config.js';
import { createProjectServer, TOOL_NAME } from './project-tool.js';
import { workspacePath, CONFIG_DIRECTORY } from './paths.js';
import type { Config, Workspace, RunEvent, RunResult } from '../shared/lesson.js';
export type QueryFactory = (
  input: Parameters<typeof query>[0],
) => AsyncIterable<SDKMessage> & Pick<Query, 'close'>;
export type Emit = (event: RunEvent) => void;
export const redact = (text: string) => text.replace(/sk-ant-[\w-]+/g, '[redacted]').slice(0, 5000);
export function createHooks(emit: Emit): NonNullable<Options['hooks']> {
  return {
    PreToolUse: [
      {
        matcher: TOOL_NAME,
        hooks: [
          async (input) => {
            emit({
              kind: 'hook',
              title: 'PreToolUse callback',
              detail: `Host observed ${'tool_name' in input ? String(input.tool_name) : 'tool'}.`,
            });
            return {};
          },
        ],
      },
    ],
    PostToolUse: [
      {
        matcher: TOOL_NAME,
        hooks: [
          async () => {
            emit({
              kind: 'hook',
              title: 'PostToolUse callback',
              detail: 'The bundled read-only tool completed.',
            });
            return {};
          },
        ],
      },
    ],
  };
}
export function buildRequest(
  config: Config,
  server: ReturnType<typeof createProjectServer>,
  controller: AbortController,
  emit: Emit,
  savedId?: string,
): Parameters<typeof query>[0] {
  const persistent = config.recipe === 'continuity';
  if (config.continuation === 'resume' && !savedId)
    throw new Error('Create a successful persistent session for this workspace before resuming.');
  const canUseTool: NonNullable<Options['canUseTool']> = async (name, input, context) => {
    const project =
      name === TOOL_NAME &&
      context.mcpServer?.source === 'sdk' &&
      ['README.md', 'architecture.json'].includes(String(input.file));
    const structured =
      name === 'StructuredOutput' &&
      config.recipe === 'structured' &&
      BriefSchema.safeParse(input).success;
    emit({
      kind: 'permission',
      title: 'canUseTool decision',
      detail: `${project || structured ? 'Allow' : 'Deny'} ${name}. This callback handles requests that reach the host.`,
    });
    return project || structured
      ? { behavior: 'allow', updatedInput: input }
      : {
          behavior: 'deny',
          message: 'Only the bounded course tool and requested structured output are supported.',
        };
  };
  return {
    prompt: config.prompt,
    options: {
      cwd: workspacePath(config.workspace),
      env: createChildEnvironment(process.env, config.environment),
      tools: [],
      allowedTools: [],
      permissionMode: 'default',
      canUseTool,
      mcpServers: { project: server },
      agents: {
        'context-reviewer': {
          description: 'Explain project context and configuration tradeoffs.',
          prompt: 'Explain context clearly without changing files.',
          tools: [],
        },
      },
      skills: [],
      hooks: createHooks(emit),
      includeHookEvents: config.includeHookEvents,
      settingSources: [],
      persistSession: persistent,
      maxTurns: config.maxTurns,
      maxBudgetUsd: config.budgetUsd,
      abortController: controller,
      ...(process.env.ANTHROPIC_MODEL ? { model: process.env.ANTHROPIC_MODEL } : {}),
      ...(config.recipe === 'structured'
        ? { outputFormat: { type: 'json_schema', schema: OUTPUT_SCHEMA } }
        : {}),
      ...(persistent
        ? config.continuation === 'resume'
          ? { resume: savedId }
          : { sessionId: randomUUID() }
        : {}),
      ...(config.requireSandbox ? { sandbox: { enabled: true, failIfUnavailable: true } } : {}),
      systemPrompt:
        'You are a concise TypeScript course tutor. Use only the bundled project note tool for source facts. Return a short answer grounded in those notes. Environment variables configure the child process; do not invent their contents. Never claim filesystem or OS isolation from cwd or the tool list.',
    },
  };
}
export class ScenarioRunner {
  private saved = new Map<Workspace, string>();
  resumable() {
    return [...this.saved.keys()];
  }
  async run(
    input: unknown,
    mode: 'inspect' | 'live',
    signal: AbortSignal,
    emit: Emit,
    queryFactory: QueryFactory = query,
  ): Promise<RunResult> {
    const config = ConfigSchema.parse(input);
    signal.throwIfAborted();
    if (mode === 'live' && config.requireSandbox && process.platform === 'win32')
      throw new Error(
        'The required OS sandbox is unavailable on Windows. Use tools-only mode here, or run the sandbox recipe on a supported OS with its dependencies.',
      );
    const hosted = createProjectServer(config.workspace, (file) =>
      emit({
        kind: 'tool',
        title: 'Bounded note read',
        detail: `${config.workspace}/${file} read from the fixed allowlist.`,
      }),
    );
    let handle: ReturnType<QueryFactory> | undefined;
    let client: Client | undefined;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(), config.timeoutSeconds * 1000);
    try {
      emit({
        kind: 'host',
        title: mode === 'live' ? 'Real SDK query' : 'Local configuration inspection',
        detail:
          mode === 'live'
            ? 'The host supplies a task and nested options to query().'
            : 'No model request or SDK query is made. The host calls a real SDK-hosted MCP tool directly.',
      });
      if (mode === 'inspect') {
        client = new Client({ name: 'lesson-4-inspector', version: '1.0.0' });
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await hosted.instance.connect(serverTransport);
        await client.connect(clientTransport);
        controller.signal.throwIfAborted();
        const response = await client.callTool({
          name: 'read_project_note',
          arguments: { file: 'README.md' },
        });
        if (response.isError) throw new Error('Local MCP inspection failed.');
        emit({
          kind: 'tool',
          title: 'Real MCP tool result',
          detail:
            'The local inspector selected the tool directly. The prompt, model, sandbox, hooks, and resume behavior were not executed.',
          data: response,
        });
        return {
          ok: true,
          mode,
          text: `Inspected the ${config.workspace} workspace through MCP. Configuration is ready to review; switch to live mode to execute the prompt.`,
        };
      }
      await mkdir(CONFIG_DIRECTORY, { recursive: true });
      controller.signal.throwIfAborted();
      const request = buildRequest(
        config,
        hosted,
        controller,
        emit,
        this.saved.get(config.workspace),
      );
      handle = queryFactory(request);
      let result: RunResult | undefined;
      for await (const message of handle) {
        controller.signal.throwIfAborted();
        if (message.type === 'result') {
          const ok = message.subtype === 'success' && !message.is_error;
          const text = redact(
            message.subtype === 'success' ? message.result : message.errors.join('\n'),
          );
          const structured = message.subtype === 'success' ? message.structured_output : undefined;
          let validated: boolean | undefined;
          if (config.recipe === 'structured' && ok) {
            validated = BriefSchema.safeParse(structured).success;
            if (!validated)
              throw new Error('The SDK result did not pass host structured-output validation.');
          }
          result = {
            ok,
            mode,
            text,
            ...(structured === undefined ? {} : { structured }),
            costUsd: message.total_cost_usd,
            sessionId: message.session_id,
            resumed: config.continuation === 'resume',
            ...(validated === undefined ? {} : { validated }),
          };
          if (ok && config.recipe === 'continuity')
            this.saved.set(config.workspace, message.session_id);
          emit({
            kind: 'message',
            title: `result · ${message.subtype}`,
            detail: ok
              ? 'SDK turn completed. Read the final result and usage.'
              : 'The SDK reported an unsuccessful result.',
            data: { type: message.type, subtype: message.subtype, is_error: message.is_error },
          });
          break;
        }
        const raw = message as unknown as Record<string, unknown>;
        const subtype = typeof raw.subtype === 'string' ? raw.subtype : '';
        emit({
          kind: 'message',
          title: `${message.type}${subtype ? ' · ' + subtype : ''}`,
          detail:
            'Observed a typed SDK event. Full message content and local configuration paths are omitted.',
        });
      }
      if (!result) throw new Error('The SDK stream ended without a result.');
      return result;
    } finally {
      clearTimeout(timer);
      controller.abort();
      signal.removeEventListener('abort', abort);
      try {
        handle?.close();
      } finally {
        await client?.close().catch(() => {});
        await hosted.instance.close().catch(() => {});
        emit({
          kind: 'host',
          title: 'Cleanup',
          detail:
            'Query handle, MCP connection, abort listener, and timeout released. Persisted continuity transcripts remain in ignored local storage.',
        });
      }
    }
  }
}
