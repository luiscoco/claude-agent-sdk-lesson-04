import { startup, type Options, type SessionStore } from '@anthropic-ai/claude-agent-sdk';
/** Compile-checked preparation example. Not called by the lab. */
export function prepareSession(options: Options) {
  return startup({ options, initializeTimeoutMs: 15000 });
}
/** Alpha mirror example. Supply an actual SessionStore adapter; persistence is mandatory. */
export function mirroredSession(options: Options, sessionStore: SessionStore): Options {
  return { ...options, persistSession: true, sessionStore };
}
