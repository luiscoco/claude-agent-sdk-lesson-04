import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import { ScenarioRunner, redact } from '../server/runner.js';
import { DEFAULT_CONFIG, RECIPES, type Config } from '../shared/lesson.js';
if (existsSync('.env')) loadEnvFile('.env');
if (!process.env.ANTHROPIC_API_KEY)
  throw new Error('Configure your own server-side ANTHROPIC_API_KEY first.');
console.log('REAL SDK SMOKE CHECK — billable model calls, at most $0.25 per scenario.');
const runner = new ScenarioRunner();
const scenarios: Config[] = process.argv.includes('--all')
  ? [
      { ...DEFAULT_CONFIG },
      { ...DEFAULT_CONFIG, recipe: 'structured', prompt: RECIPES.structured.prompt },
      { ...DEFAULT_CONFIG, recipe: 'continuity', prompt: RECIPES.continuity.prompt },
      {
        ...DEFAULT_CONFIG,
        recipe: 'continuity',
        continuation: 'resume',
        prompt:
          'What project name did we discuss, and what next step did you recommend? Answer in two sentences.',
      },
    ]
  : [{ ...DEFAULT_CONFIG }];
for (const config of scenarios) {
  try {
    let tools = 0;
    const result = await runner.run(config, 'live', new AbortController().signal, (event) => {
      if (event.kind === 'tool') tools++;
    });
    console.log(
      JSON.stringify({
        recipe: config.recipe,
        continuation: config.continuation,
        ok: result.ok,
        validated: result.validated,
        resumed: result.resumed,
        costUsd: result.costUsd,
        toolReads: tools,
        text: result.text,
        structured: result.structured,
      }),
    );
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.log(
      JSON.stringify({
        recipe: config.recipe,
        ok: false,
        error: redact(error instanceof Error ? error.message : 'Run failed.'),
      }),
    );
    process.exitCode = 1;
  }
}
