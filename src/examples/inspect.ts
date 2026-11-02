import { ScenarioRunner } from '../server/runner.js';
import { defaultPreview } from '../server/config.js';
const preview = defaultPreview();
console.log(preview.code);
const result = await new ScenarioRunner().run(
  preview.config,
  'inspect',
  new AbortController().signal,
  (event) => console.log(event.title + ': ' + event.detail),
);
console.log(JSON.stringify(result, null, 2));
