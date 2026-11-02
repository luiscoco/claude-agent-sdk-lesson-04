export const VERSION = '0.3.310';
export const RECIPES = {
  review: {
    title: 'Read-only project brief',
    description: 'Set task context, provide a bounded custom tool, and observe a concise answer.',
    prompt:
      'Use read_project_note to read README.md. Explain the project purpose and one useful next step in three short sentences.',
  },
  structured: {
    title: 'Structured project brief',
    description: 'Ask for a typed result, then validate structured_output in the host.',
    prompt:
      'Use read_project_note to read README.md and architecture.json. Produce a concise project brief matching the requested output schema.',
  },
  continuity: {
    title: 'Persist and resume',
    description: 'Save a session locally and continue the host-owned session in a second query.',
    prompt:
      'Use read_project_note to read README.md. Remember the project name and recommend one next step in two short sentences.',
  },
} as const;
export type Recipe = keyof typeof RECIPES;
export type Workspace = 'atlas' | 'beacon';
export interface Config {
  recipe: Recipe;
  workspace: Workspace;
  environment: 'development' | 'production';
  prompt: string;
  maxTurns: number;
  budgetUsd: number;
  timeoutSeconds: number;
  includeHookEvents: boolean;
  requireSandbox: boolean;
  continuation: 'new' | 'resume';
}
export const DEFAULT_CONFIG: Config = {
  recipe: 'review',
  workspace: 'atlas',
  environment: 'development',
  prompt: RECIPES.review.prompt,
  maxTurns: 6,
  budgetUsd: 0.25,
  timeoutSeconds: 90,
  includeHookEvents: true,
  requireSandbox: false,
  continuation: 'new',
};
export interface Preview {
  config: Config;
  code: string;
  options: Record<string, unknown>;
  notes: string[];
  schema: Record<string, unknown> | null;
}
export interface RunEvent {
  kind: 'host' | 'tool' | 'message' | 'hook' | 'permission' | 'result' | 'error' | 'done';
  title: string;
  detail: string;
  data?: unknown;
}
export interface RunResult {
  ok: boolean;
  mode: 'inspect' | 'live';
  text: string;
  structured?: unknown;
  costUsd?: number;
  sessionId?: string;
  resumed?: boolean;
  validated?: boolean;
}
export interface Metadata {
  version: string;
  liveAvailable: boolean;
  model: string;
  platform: string;
  recipes: typeof RECIPES;
  resumable: Workspace[];
}
export const GUIDE = [
  {
    group: 'Task & context',
    name: 'prompt / options.cwd',
    text: 'The prompt describes the goal. cwd selects project context and relative paths; it is not a filesystem sandbox.',
  },
  {
    group: 'Task & context',
    name: 'options.env',
    text: 'An explicit env replaces the child environment. Preserve the platform values and authentication the subprocess needs. Environment variables are not automatically prompt text.',
  },
  {
    group: 'Capabilities',
    name: 'tools / mcpServers / agents / skills',
    text: 'tools controls built-in availability. MCP adds application tools. agents configures specialists; skills filters skill context. These are distinct configuration surfaces.',
  },
  {
    group: 'Permissions',
    name: 'allowedTools / canUseTool',
    text: 'allowedTools auto-approves named tools; it does not restrict availability. canUseTool handles permission requests that reach the host; it is not an unconditional interceptor for every tool.',
  },
  {
    group: 'Permissions',
    name: 'permissionMode / sandbox',
    text: 'Permission mode shapes approval behavior. An OS sandbox is a separate execution boundary with platform/dependency requirements. This app’s tools-only mode does not claim OS isolation.',
  },
  {
    group: 'Observability',
    name: 'hooks / includeHookEvents',
    text: 'Callbacks observe selected lifecycle events. includeHookEvents adds hook lifecycle messages to the SDK stream; it does not enable the callbacks themselves.',
  },
  {
    group: 'Output & limits',
    name: 'outputFormat / maxTurns / maxBudgetUsd',
    text: 'Use outputFormat: {type: "json_schema", schema} for structured output in 0.3.310, then validate structured_output. Turn, cost and host wall-clock limits are different controls.',
  },
  {
    group: 'Continuity',
    name: 'persistSession / sessionId / resume',
    text: 'Ephemeral runs cannot be resumed. New persistent runs may choose a UUID; later queries use resume with the saved ID and matching workspace. Do not combine sessionId and resume for ordinary continuation.',
  },
  {
    group: 'Version context',
    name: 'sessionStore / initializeTimeoutMs',
    text: 'sessionStore is an alpha transcript mirror and requires persistence. initializeTimeoutMs belongs to startup/prewarm preparation, not ordinary query Options in this pinned version.',
  },
] as const;
export const QUIZ = [
  {
    question: 'What does cwd establish?',
    answers: ['The workspace context for a query', 'An OS filesystem sandbox', 'The user task'],
    correct: 0,
  },
  {
    question: 'Which option restricts available built-in tools?',
    answers: ['allowedTools', 'tools', 'includeHookEvents'],
    correct: 1,
  },
  {
    question: 'Which structure requests JSON-schema output in SDK 0.3.310?',
    answers: ['outputSchema at the top level', 'env.output', 'options.outputFormat'],
    correct: 2,
  },
  {
    question: 'How do you continue a saved session in this app?',
    answers: [
      'Use resume with its saved ID and matching workspace',
      'Set persistSession:false',
      'Combine a new sessionId with resume',
    ],
    correct: 0,
  },
] as const;
