# Lesson 4 classroom walkthrough

**Options and Session Configuration · SDK 0.3.310**

Allow 25–35 minutes. Begin with local inspection, then optionally use your own server-side key for live scenarios.

## 1. Task and workspace

Choose **Read-only project brief**, select Atlas Tasks, and inspect the generated query. Identify top-level `prompt` and nested `options.cwd`. Inspect locally, switch to Beacon Notes, and inspect again.

**Evidence:** The real MCP tool returns different fixture notes. No model query runs in local inspection, so the application does not claim to have executed the user prompt.

**Explain:** Prompt specifies the goal. cwd selects project context. It does not create an OS filesystem sandbox. The application implements a separate fixed-file reader boundary.

## 2. Environment and capabilities

Change `LESSON_ENV` to production and inspect the code and sanitized options.

**Explain:** An explicit SDK env replaces the subprocess environment. The host must preserve the platform/authentication values it needs. The preview shows placeholders, never credentials. Setting an environment variable does not automatically insert it into the model's prompt.

Find `tools: []`, the bundled MCP server, the empty `allowedTools`, and `canUseTool` in `runner.ts`. Distinguish availability, automatic approval, permission callbacks, and actual handler behavior. The callback checks SDK provenance where the request reaches the host; the handler independently checks the fixed note names and real paths.

## 3. Run limits and observations

Choose modest turn and budget limits. Toggle **Include hook lifecycle messages**. Explain the difference between configured hook callbacks and hook messages in the stream. The checkbox affects the latter.

**Explain:** maxTurns, estimated cost budget, and the host wall-clock timeout control different things. initializeTimeoutMs is a preparation option for startup/prewarm in this package, not an ordinary query option.

On Windows, select **Require an OS sandbox** and inspect the generated settings; a live run should report that the requested sandbox is unsupported. Turn it off to continue. On a supported OS, missing sandbox dependencies should fail rather than silently degrade.

## 4. Structured output

Choose **Structured project brief**. Open the schema and find its four required fields. The version-correct request uses `options.outputFormat`.

With a valid key, choose live mode and run. Check the **Host schema validated** badge and inspect the structured object. Missing or invalid structured output must fail host validation. Local inspection only previews this behavior and calls the note tool; it does not manufacture a model result.

## 5. Continuity

Choose **Persist and resume**, then **New persistent session**. Run live once. Record the answer's project name and recommendation.

Choose **Resume this workspace’s last successful session**. Change the prompt to ask what project and recommendation were discussed. Run again.

**Evidence:** A later query receives `resume` with the host-owned saved ID. A fresh persistent query receives a new UUID as `sessionId`. These are separate call shapes. The model should answer using the continued conversation rather than needing the initial prompt repeated.

Switch to the other workspace. Its resume option remains unavailable until this host has created a successful persistent session for it. Restarting the server clears the UI registry even though SDK transcripts remain in ignored local storage.

## 6. Student extension

Add a third bundled fixture workspace. Update the server enum and UI selection, keep the reader limited to the existing fixed file names, and add an MCP integration test proving the new workspace returns its own notes. Do not introduce arbitrary paths from the browser.

## Exit questions and answers

1. What differs between prompt and cwd? **Task goal versus workspace context.**
2. Why preserve only relevant environment values? **The child needs some platform/auth values, while unrelated server secrets are unnecessary.**
3. Do allowedTools and canUseTool restrict the same thing? **No. allowedTools auto-approves names; canUseTool handles permission requests reaching the host. tools controls built-in availability.**
4. Which options address continuity? **persistSession, sessionId, resume, and optionally an alpha sessionStore mirror.**

Finish the quiz and export a trace. Check that the exported configuration matches the run, even if a later draft has changed.
