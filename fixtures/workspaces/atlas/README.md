# Atlas Tasks

Atlas Tasks is a small TypeScript task tracker for a study group. Members create tasks, assign an owner, and mark work complete.

The domain logic lives in `tasks.ts`; the CLI calls that domain API. Data is stored in memory and is lost when the process ends. There is no authentication and no database yet.

Suggested next step: test the behavior when completing an unknown task ID, then add a persistence adapter without coupling storage to the domain functions.
