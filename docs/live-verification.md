# Manual live verification

Verified on **2 November 2026**, Windows, Node.js 24, SDK **0.3.310**, using **claude-haiku-5-5** and a locally configured server-side API key. No key or raw environment values are included here.

`npm run live:smoke -- --all` completed four real SDK queries:

| Scenario               | Observed evidence                                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Read-only review       | One bounded note read; the answer identified Atlas Tasks and recommended testing unknown task completion.                  |
| Structured brief       | Two note reads; structured_output passed the host Zod schema with projectName, purpose, keyComponents, and recommendation. |
| New persistent session | One note read; a successful persistent conversation was registered for the Atlas workspace.                                |
| Resumed session        | A subsequent query used resume, recalled Atlas Tasks and the earlier recommendation, and required no further note reads.   |

These are manual observations, not fixed expected model wording or token counts. Automated tests use actual local MCP calls and injected query handles, and do not use model credentials.

The same local credential setup was also verified with live runs of the Lesson 1, 2, and 3 applications. Lesson 3's streaming-input initialization was corrected to use the control handshake before enabling the first user turn.
