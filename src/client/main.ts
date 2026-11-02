import './style.css';
import './course-theme.css';
import './course-theme.js';
import { createEventParser } from '../shared/sse.js';
import {
  DEFAULT_CONFIG,
  RECIPES,
  GUIDE,
  QUIZ,
  type Config,
  type Recipe,
  type Preview,
  type Metadata,
  type RunEvent,
  type RunResult,
} from '../shared/lesson.js';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const text = (id: string, value: string) => {
  $(id).textContent = value;
};
let recipe: Recipe = 'review';
let preview: Preview | undefined;
let metadata: Metadata | undefined;
let running = false;
let controller: AbortController | undefined;
let events: RunEvent[] = [];
let result: RunResult | undefined;
let traceConfig: Config | undefined;
let generation = 0;
let previewTimer: ReturnType<typeof setTimeout> | undefined;
function notice(message = '') {
  text('notice', message);
  $('notice').hidden = !message;
}
function config(): Config {
  return {
    recipe,
    workspace: $<HTMLSelectElement>('workspace').value as Config['workspace'],
    environment: $<HTMLSelectElement>('environment').value as Config['environment'],
    prompt: $<HTMLTextAreaElement>('prompt').value,
    maxTurns: Number($<HTMLInputElement>('max-turns').value),
    budgetUsd: Number($<HTMLInputElement>('budget').value),
    timeoutSeconds: Number($<HTMLInputElement>('timeout').value),
    includeHookEvents: $<HTMLInputElement>('hook-events').checked,
    requireSandbox: $<HTMLInputElement>('sandbox').checked,
    continuation:
      recipe === 'continuity'
        ? ($<HTMLSelectElement>('continuation').value as Config['continuation'])
        : 'new',
  };
}
async function api<T>(path: string, input?: unknown): Promise<T> {
  const response = await fetch(
    path,
    input === undefined
      ? { cache: 'no-store' }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
  );
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Request failed.');
  return value;
}
function updateResume() {
  const selector = $<HTMLSelectElement>('continuation');
  const available = metadata?.resumable.includes(config().workspace) ?? false;
  selector.options[1]!.disabled = !available;
  if (!available) selector.value = 'new';
}
async function loadMeta() {
  metadata = await api<Metadata>('/api/meta');
  text('key-status', metadata.liveAvailable ? 'LIVE KEY CONFIGURED' : 'LOCAL INSPECTION READY');
  text(
    'live-note',
    metadata.liveAvailable
      ? `Live is available with ${metadata.model}. The API key stays on the server.`
      : 'Live requires your own ANTHROPIC_API_KEY in the server .env file. Local inspection needs no key.',
  );
  $<HTMLSelectElement>('mode').options[1]!.disabled = !metadata.liveAvailable;
  text(
    'sandbox-note',
    metadata.platform === 'win32'
      ? 'An OS sandbox is unavailable on Windows. Local inspection can preview it; live execution requires a supported OS.'
      : 'A required sandbox fails if platform dependencies are unavailable. Tools-only mode does not claim OS isolation.',
  );
  updateResume();
}
async function refreshPreview() {
  const request = ++generation;
  try {
    const next = await api<Preview>('/api/preview', config());
    if (request !== generation) return;
    preview = next;
    text('code', next.code);
    text('options', JSON.stringify(next.options, null, 2));
    text('schema', JSON.stringify(next.schema, null, 2));
    $('schema-details').hidden = !next.schema;
    text('recipe-name', RECIPES[recipe].title);
    $('notes').replaceChildren(
      ...next.notes.map((note) => {
        const li = document.createElement('li');
        li.textContent = note;
        return li;
      }),
    );
    notice();
  } catch (error) {
    if (request === generation) notice((error as Error).message);
  }
}
function selectRecipe(next: Recipe) {
  recipe = next;
  $<HTMLTextAreaElement>('prompt').value = RECIPES[next].prompt;
  $('continuity-controls').hidden = next !== 'continuity';
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-recipe]'))
    button.setAttribute('aria-pressed', String(button.dataset.recipe === next));
  updateResume();
  void refreshPreview();
}
for (const [key, value] of Object.entries(RECIPES)) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.recipe = key;
  button.className = 'recipe-card';
  const num = document.createElement('small');
  num.textContent = `0${Object.keys(RECIPES).indexOf(key) + 1}`;
  const title = document.createElement('strong');
  title.textContent = value.title;
  const detail = document.createElement('span');
  detail.textContent = value.description;
  button.append(num, title, detail);
  button.addEventListener('click', () => selectRecipe(key as Recipe));
  $('recipes').append(button);
}
for (const field of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
  '[data-config]',
))
  field.addEventListener('input', () => {
    if (field.id === 'workspace') updateResume();
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => void refreshPreview(), 180);
  });
function modeChange() {
  const live = $<HTMLSelectElement>('mode').value === 'live';
  text(
    'mode-label',
    live ? 'Live SDK scenario · model charges apply' : 'Local inspection · real MCP, no model',
  );
  text(
    'mode-description',
    live
      ? 'Execute the prompt using the configured SDK options. Keys and platform values remain on the server.'
      : 'Review the configuration and call the bundled tool directly. The prompt is executed only in live mode.',
  );
  $('run').replaceChildren(document.createTextNode(live ? 'Run live scenario' : 'Inspect locally'));
}
$('mode').addEventListener('change', modeChange);
function append(event: RunEvent) {
  events.push(event);
  if (events.length > 100) events.shift();
  const entry = document.createElement('article');
  entry.className = `event ${event.kind === 'error' ? 'error' : event.kind === 'message' ? 'message' : event.kind === 'host' ? 'host' : 'control'}`;
  const heading = document.createElement('b');
  heading.textContent = event.title;
  const detail = document.createElement('p');
  detail.textContent = event.detail;
  entry.append(heading, detail);
  if (event.data !== undefined) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Selected fields';
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(event.data, null, 2);
    details.append(summary, pre);
    entry.append(details);
  }
  $('events').append(entry);
  while ($('events').children.length > 100) $('events').firstElementChild?.remove();
  $('events').scrollTop = $('events').scrollHeight;
}
function setRunning(value: boolean) {
  running = value;
  for (const field of document.querySelectorAll<
    HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement | HTMLSelectElement
  >(
    '#config-form input,#config-form select,#config-form textarea,#config-form button,[data-recipe]',
  ))
    field.disabled = value;
  $('stop').hidden = !value;
  $<HTMLButtonElement>('stop').disabled = false;
}
$('config-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (running) return;
  const submitted = config();
  traceConfig = submitted;
  const mode = $<HTMLSelectElement>('mode').value;
  events = [];
  result = undefined;
  $('events').replaceChildren();
  $('structured').hidden = true;
  text('result', 'Waiting for the scenario…');
  text('result-label', mode === 'live' ? 'REAL SDK EXECUTION' : 'LOCAL MCP INSPECTION');
  text('status', 'Running');
  $('result-meta').replaceChildren();
  $<HTMLButtonElement>('export').disabled = true;
  controller = new AbortController();
  setRunning(true);
  notice();
  try {
    const response = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: submitted, mode }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Scenario failed.');
    }
    if (!response.body) throw new Error('No event stream was returned.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let done = false;
    const parse = createEventParser((value) => {
      const event = value as RunEvent;
      append(event);
      if (event.kind === 'result') {
        result = event.data as RunResult;
        text('result', result.text);
        $('structured').hidden = result.structured === undefined;
        text('structured', JSON.stringify(result.structured, null, 2) || '');
        const tags = [
          result.mode === 'live' ? 'Real SDK result' : 'Direct MCP inspection',
          ...(result.validated ? ['Host schema validated'] : []),
          ...(result.resumed ? ['Resumed saved session'] : []),
          ...(result.costUsd === undefined
            ? []
            : [`Estimated cost: $${result.costUsd.toFixed(4)}`]),
        ];
        $('result-meta').replaceChildren(
          ...tags.map((tag) => {
            const span = document.createElement('span');
            span.className = 'tag';
            span.textContent = tag;
            return span;
          }),
        );
      }
      if (event.kind === 'error') {
        text('result', event.detail);
        text('status', 'Failed');
      }
      if (event.kind === 'done') {
        done = true;
        text(
          'status',
          event.detail === 'success'
            ? 'Completed'
            : event.detail === 'cancelled'
              ? 'Cancelled'
              : 'Failed',
        );
      }
    });
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      parse(decoder.decode(chunk.value, { stream: true }));
    }
    parse(decoder.decode());
    if (!done) throw new Error('The connection ended before the scenario finished.');
  } catch (error) {
    const cancelled = controller.signal.aborted;
    text('status', cancelled ? 'Cancelled' : 'Failed');
    const detail = cancelled ? 'The host cancelled this scenario.' : (error as Error).message;
    text('result', detail);
    append({ kind: 'error', title: cancelled ? 'Cancelled' : 'Scenario failed', detail });
  } finally {
    setRunning(false);
    $<HTMLButtonElement>('export').disabled = false;
    controller = undefined;
    void loadMeta().catch((error) => notice(error.message));
  }
});
$('stop').addEventListener('click', () => controller?.abort());
$('copy').addEventListener('click', async () => {
  if (!preview) return;
  try {
    await navigator.clipboard.writeText(preview.code);
    text('copy', 'Copied');
    setTimeout(() => text('copy', 'Copy example'), 1500);
  } catch {
    notice('Select the generated example to copy it.');
  }
});
$('export').addEventListener('click', () => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify({ lesson: 4, config: traceConfig, events, result }, null, 2)], {
      type: 'application/json',
    }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'lesson-04-configuration-trace.json';
  link.click();
  URL.revokeObjectURL(url);
});
for (const item of GUIDE) {
  const card = document.createElement('article');
  card.className = 'panel method-card';
  const group = document.createElement('small');
  group.textContent = item.group;
  const name = document.createElement('h3');
  name.textContent = item.name;
  const detail = document.createElement('p');
  detail.textContent = item.text;
  card.append(group, name, detail);
  $('guide-cards').append(card);
}
const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role=tab]')];
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => {
    for (const item of tabs) {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
      $(item.getAttribute('aria-controls')!).hidden = !selected;
    }
  });
  tab.addEventListener('keydown', (event) => {
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (index + tabs.length - 1) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : null;
    if (next !== null) {
      event.preventDefault();
      tabs[next]!.click();
      tabs[next]!.focus();
    }
  });
});
QUIZ.forEach((item, index) => {
  const field = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = `${index + 1}. ${item.question}`;
  field.append(legend);
  item.answers.forEach((answer, choice) => {
    const label = document.createElement('label');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = `q${index}`;
    radio.value = String(choice);
    radio.required = true;
    label.append(radio, document.createTextNode(answer));
    field.append(label);
  });
  $('questions').append(field);
});
$('quiz-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const values = new FormData($<HTMLFormElement>('quiz-form'));
  const score = QUIZ.filter(
    (item, index) => Number(values.get(`q${index}`)) === item.correct,
  ).length;
  text(
    'quiz-score',
    `${score} / ${QUIZ.length} correct${score === QUIZ.length ? ' · You understand the configuration.' : ' · Review the options guide and try again.'}`,
  );
});
$<HTMLTextAreaElement>('prompt').value = DEFAULT_CONFIG.prompt;
selectRecipe('review');
void loadMeta().catch((error) => notice(error.message));
modeChange();
window.addEventListener('pagehide', () => controller?.abort());
