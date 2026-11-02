import { z } from 'zod';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { DEFAULT_CONFIG, type Config, type Preview } from '../shared/lesson.js';
import { CONFIG_DIRECTORY } from './paths.js';
export const ConfigSchema = z
  .strictObject({
    recipe: z.enum(['review', 'structured', 'continuity']),
    workspace: z.enum(['atlas', 'beacon']),
    environment: z.enum(['development', 'production']),
    prompt: z.string().trim().min(10).max(2000),
    maxTurns: z.number().int().min(2).max(8),
    budgetUsd: z.number().min(0.03).max(0.5),
    timeoutSeconds: z.number().int().min(15).max(120),
    includeHookEvents: z.boolean(),
    requireSandbox: z.boolean(),
    continuation: z.enum(['new', 'resume']),
  })
  .superRefine((value, ctx) => {
    if (value.continuation === 'resume' && value.recipe !== 'continuity')
      ctx.addIssue({
        code: 'custom',
        path: ['continuation'],
        message: 'Resume requires the continuity recipe.',
      });
  });
export const BriefSchema = z.strictObject({
  projectName: z.string().min(1),
  purpose: z.string().min(1),
  keyComponents: z.array(z.string()).min(1),
  recommendation: z.string().min(1),
});
const { $schema: ignored, ...schema } = z.toJSONSchema(BriefSchema, { target: 'draft-7' });
export const OUTPUT_SCHEMA = schema;
/** Explicit env REPLACES the child's inherited environment. Keep only needed platform/auth/network values. */
export function createChildEnvironment(
  source: NodeJS.ProcessEnv,
  environment: Config['environment'],
): NonNullable<Options['env']> {
  const names = [
    'PATH',
    'Path',
    'PATHEXT',
    'HOME',
    'USERPROFILE',
    'SystemRoot',
    'SYSTEMROOT',
    'WINDIR',
    'COMSPEC',
    'TEMP',
    'TMP',
    'APPDATA',
    'LOCALAPPDATA',
    'ProgramFiles',
    'ProgramFiles(x86)',
    'OS',
    'SystemDrive',
    'CLAUDE_CODE_GIT_BASH_PATH',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'SSL_CERT_FILE',
    'NODE_EXTRA_CA_CERTS',
    'ANTHROPIC_API_KEY',
  ];
  const selected: Record<string, string> = {};
  for (const name of names) if (source[name]) selected[name] = source[name]!;
  return { ...selected, LESSON_ENV: environment, CLAUDE_CONFIG_DIR: CONFIG_DIRECTORY };
}
export function previewConfig(input: unknown): Preview {
  const config = ConfigSchema.parse(input);
  const persistent = config.recipe === 'continuity';
  const options: Record<string, unknown> = {
    cwd: `fixtures/workspaces/${config.workspace}`,
    env: {
      LESSON_ENV: config.environment,
      CLAUDE_CONFIG_DIR: '.local/sdk-state',
      ANTHROPIC_API_KEY: '[server-only]',
      platformEnvironment: '[filtered server values]',
    },
    tools: [],
    allowedTools: [],
    permissionMode: 'default',
    canUseTool: '[host approval callback]',
    mcpServers: { project: '[bundled read_project_note server]' },
    agents: { 'context-reviewer': '[configured, not invoked]' },
    skills: [],
    hooks: '[PreToolUse and PostToolUse callbacks]',
    settingSources: [],
    persistSession: persistent,
    maxTurns: config.maxTurns,
    maxBudgetUsd: config.budgetUsd,
    includeHookEvents: config.includeHookEvents,
    ...(config.requireSandbox ? { sandbox: { enabled: true, failIfUnavailable: true } } : {}),
    ...(config.recipe === 'structured'
      ? { outputFormat: { type: 'json_schema', schema: OUTPUT_SCHEMA } }
      : {}),
    ...(persistent
      ? {
          [config.continuation === 'resume' ? 'resume' : 'sessionId']:
            config.continuation === 'resume' ? '[host-owned saved ID]' : '[new UUID]',
        }
      : {}),
  };
  const code = `import { query } from '@anthropic-ai/claude-agent-sdk';\n\nconst q = query({\n  prompt: ${JSON.stringify(config.prompt)},\n  options: {\n    cwd: workspacePath(${JSON.stringify(config.workspace)}),\n    env: createChildEnvironment(process.env, ${JSON.stringify(config.environment)}),\n    tools: [],\n    mcpServers: { project: createProjectServer(${JSON.stringify(config.workspace)}) },\n    allowedTools: [],\n    permissionMode: 'default',\n    canUseTool: approveProjectTool,\n    settingSources: [],\n    skills: [],\n    persistSession: ${persistent},\n    maxTurns: ${config.maxTurns},\n    maxBudgetUsd: ${config.budgetUsd},\n    includeHookEvents: ${config.includeHookEvents},\n    hooks: createHooks(onEvent),${config.recipe === 'structured' ? "\n    outputFormat: { type: 'json_schema', schema: OUTPUT_SCHEMA }," : ''}${persistent ? `\n    ${config.continuation === 'resume' ? 'resume: savedSessionId' : 'sessionId: newSessionId'},` : ''}${config.requireSandbox ? '\n    sandbox: { enabled: true, failIfUnavailable: true },' : ''}\n    // See buildRequest() for model, agent, abort and system-prompt details.\n  },\n});\n\ntry {\n  for await (const msg of q) onMessage(msg);\n} finally {\n  q.close();\n}`;
  return {
    config,
    options,
    code,
    schema: config.recipe === 'structured' ? OUTPUT_SCHEMA : null,
    notes: [
      'Prompt is top-level; runtime settings belong under options. This preview contains placeholders, never server credentials.',
      'tools disables built-ins. allowedTools auto-approves; it does not restrict availability. The custom handler independently enforces a fixed file allowlist.',
      'cwd selects context; it does not isolate the filesystem. Tools-only mode is not an OS sandbox.',
      'env replaces the subprocess environment; the server preserves needed platform/auth values. LESSON_ENV is not automatically included in model context.',
      persistent
        ? 'The continuity recipe saves SDK transcripts under ignored .local/sdk-state. Resume uses only a successful session created by this host for the selected workspace.'
        : 'This recipe disables persistence and cannot be resumed.',
      'Host timeout is a wall-clock limit. initializeTimeoutMs belongs to startup/prewarm preparation in this version, not ordinary query options.',
    ],
  };
}
export const defaultPreview = () => previewConfig(DEFAULT_CONFIG);
