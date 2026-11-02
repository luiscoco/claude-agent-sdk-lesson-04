import { test, expect } from '@playwright/test';
test('workspace and environment choices produce nested sanitized options', async ({ page }) => {
  await page.goto('/');
  await page.locator('#workspace').selectOption('beacon');
  await page.locator('#environment').selectOption('production');
  await expect(page.locator('#code')).toContainText('workspacePath("beacon")');
  await expect(page.locator('#code')).toContainText('"production"');
  await expect(page.locator('#code')).toContainText('options: {');
});
test('local inspection returns real MCP evidence without claiming a model result', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('#workspace').selectOption('beacon');
  await page.getByRole('button', { name: 'Inspect locally', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Completed');
  await expect(page.locator('#result')).toContainText('beacon');
  await expect(page.locator('#events')).toContainText('Real MCP tool result');
  await expect(page.locator('#result-meta')).toContainText('Direct MCP inspection');
});
test('structured recipe renders the actual outputFormat schema', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Structured project brief/ }).click();
  await expect(page.locator('#code')).toContainText('outputFormat:');
  await page.locator('#schema-details summary').click();
  await expect(page.locator('#schema')).toContainText('projectName');
  await expect(page.locator('#schema')).toContainText('additionalProperties');
});
test('continuity config enables persistence and prevents an unavailable resume', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Persist and resume/ }).click();
  await expect(page.locator('#continuity-controls')).toBeVisible();
  await expect(page.locator('#code')).toContainText('persistSession: true');
  await expect(page.locator('#code')).toContainText('sessionId: newSessionId');
  expect(await page.locator('#continuation option[value=resume]').isDisabled()).toBe(true);
});
test('trace records the submitted configuration even after the next draft changes', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('#workspace').selectOption('beacon');
  await page.locator('#run').click();
  await expect(page.locator('#status')).toHaveText('Completed');
  await page.locator('#workspace').selectOption('atlas');
  const waiting = page.waitForEvent('download');
  await page.locator('#export').click();
  const download = await waiting;
  expect(download.suggestedFilename()).toBe('lesson-04-configuration-trace.json');
  const stream = await download.createReadStream();
  let content = '';
  for await (const chunk of stream!) content += chunk.toString();
  expect(JSON.parse(content).config.workspace).toBe('beacon');
});
test('options guide and quiz teach the version-specific distinctions', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: /Options guide/ }).click();
  await expect(page.locator('.method-card')).toHaveCount(9);
  await expect(page.locator('#guide')).toContainText('not an unconditional interceptor');
  await page.getByRole('tab', { name: /Check your understanding/ }).click();
  for (const [i, choice] of [0, 1, 2, 0].entries())
    await page.locator(`input[name=q${i}][value="${choice}"]`).check();
  await page.getByRole('button', { name: 'Check my answers' }).click();
  await expect(page.locator('#quiz-score')).toContainText('4 / 4 correct');
});
test('phone layout fits the builder, guide and quiz', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#code')).toContainText('query');
  for (const tab of [/Build a query/, /Options guide/, /Check your understanding/]) {
    await page.getByRole('tab', { name: tab }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});
test('selected live result fields render as text and schema validation is visible', async ({
  page,
}) => {
  await page.route('**/api/meta', (route) =>
    route.fulfill({
      json: {
        version: '0.3.310',
        liveAvailable: true,
        model: 'test-model',
        platform: 'linux',
        recipes: {},
        resumable: [],
      },
    }),
  );
  await page.route('**/api/run', (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body: [
        {
          kind: 'result',
          title: 'SDK result',
          detail: 'Test result',
          data: {
            ok: true,
            mode: 'live',
            text: '<img src=x onerror=alert(1)>',
            structured: { projectName: 'Test' },
            validated: true,
            costUsd: 0.001,
          },
        },
        { kind: 'done', title: 'Finished', detail: 'success' },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join(''),
    }),
  );
  await page.goto('/');
  await page.locator('#mode').selectOption('live');
  await page.locator('#run').click();
  await expect(page.locator('#status')).toHaveText('Completed');
  await expect(page.locator('#result')).toContainText('<img');
  expect(await page.locator('#result img').count()).toBe(0);
  await expect(page.locator('#result-meta')).toContainText('Host schema validated');
});
