/**
 * End-to-end test: real server + built UI + real Chromium.
 * Runs the NEXUS TEST LAB through the browser: RUN, watch real agents work, inspect a
 * terminal, approve the gated merge from the UI, wait for completion, then exercise the
 * command palette, task board, branch explorer, 3D mode and DEMO mode.
 * Usage: npm run build:web && npm run test:e2e
 */
import { chromium, type Page } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startApp } from '../src/server/app.js';

const out = path.resolve('e2e/artifacts');
fs.mkdirSync(out, { recursive: true });
if (!fs.existsSync('dist/web/index.html')) {
  console.error('Build the UI first: npm run build:web');
  process.exit(1);
}

const app = await startApp({ config: { dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-e2e-')), tickMs: 200, anthropicApiKey: null }, llmPlanner: null, port: 0, serveStatic: true, seed: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

let step = 0;
async function check(name: string, fn: (p: Page) => Promise<void>) {
  const t0 = Date.now();
  try {
    await fn(page);
    console.log(`  ✓ ${name} (${Date.now() - t0}ms)`);
    await page.screenshot({ path: `${out}/${String(++step).padStart(2, '0')}-${name.replace(/\W+/g, '-').toLowerCase()}.png` });
  } catch (e) {
    await page.screenshot({ path: `${out}/FAILED-${name.replace(/\W+/g, '-').toLowerCase()}.png` });
    throw e;
  }
}

let failed = false;
try {
  console.log('NEXUS e2e');
  await page.goto(app.url);

  await check('cinematic intro shows and dismisses', async (p) => {
    await p.getByTestId('intro').waitFor();
    await p.getByTestId('intro').waitFor({ state: 'detached', timeout: 5000 });
  });

  await check('test lab loads with 20+ agents on the canvas', async (p) => {
    await p.waitForFunction(() => document.querySelectorAll('.react-flow__node-agent').length >= 22);
    assert.match(await p.getByTestId('project-switcher').innerText(), /NEXUS TEST LAB/);
    assert.match(await p.getByTestId('command-center').innerText(), /ACTIVE AGENTS/i);
  });

  await check('run starts real agents', async (p) => {
    await p.getByTestId('run-toggle').click();
    await p.waitForFunction(() => /Orchestration running/.test(document.querySelector('[data-testid=orchestrator-feed]')?.textContent ?? ''));
    await p.waitForFunction(() => /completed “Write requirements”/.test(document.querySelector('[data-testid=orchestrator-feed]')?.textContent ?? ''), null, { timeout: 30000 });
  });

  await check('inspector terminal shows real process output', async (p) => {
    await p.getByRole('button', { name: 'Tree' }).first().click().catch(() => undefined);
    await p.getByLabel('Agent tree').click();
    await p.getByText('Architect', { exact: true }).first().click();
    await p.getByTestId('inspector').waitFor();
    await p.getByRole('tab', { name: 'Terminal' }).click();
    await p.waitForFunction(() => /# pass \d+/.test(document.querySelector('[data-testid=terminal]')?.textContent ?? ''), null, { timeout: 30000 });
  });

  await check('failure triggers an automatic debugger agent', async (p) => {
    await p.waitForFunction(() => /Spawning debugger for “Easing curves”/.test(document.querySelector('[data-testid=orchestrator-feed]')?.textContent ?? ''), null, { timeout: 60000 });
  });

  await check('gated merge is approved from the merge queue', async (p) => {
    await p.getByLabel('Merge queue').click();
    const approve = p.getByTestId('approve-merge').first();
    await approve.waitFor({ timeout: 90000 });
    await approve.click();
  });

  await check('objective completes with every task merged', async (p) => {
    await p.waitForFunction(() => /Objective complete/.test(document.querySelector('[data-testid=orchestrator-feed]')?.textContent ?? ''), null, { timeout: 120000 });
    const center = await p.getByTestId('command-center').innerText();
    assert.match(center, /COMPLETED\s+(\d+)\s*\/\s*\1\b/i); // every task, including the debugger fix
  });

  await check('branch explorer lists merged agent branches', async (p) => {
    await p.getByLabel('Branches').click();
    await p.getByText('MAIN', { exact: true }).waitFor();
    await p.waitForFunction(() => (document.body.textContent?.match(/merged/g) ?? []).length >= 10);
  });

  await check('task board shows the recovered task', async (p) => {
    await p.getByLabel('Tasks').click();
    await p.getByText('Easing curves', { exact: true }).click();
    await p.getByText(/Resolved by Debugger/).waitFor();
  });

  await check('command palette searches the project (Ctrl+K)', async (p) => {
    await p.keyboard.press('Control+k');
    await p.getByLabel('Command or search').fill('easeInOut');
    await p.getByText(/fix\(ui\): correct second half of easeInOutQuad/).waitFor({ timeout: 10000 });
    await p.keyboard.press('Escape');
  });

  await check('3D command mode renders a WebGL scene', async (p) => {
    await p.getByRole('button', { name: 'Canvas', exact: true }).click();
    await p.getByLabel('3D command mode').click();
    await p.getByTestId('three-view').locator('canvas').waitFor({ timeout: 20000 });
    await p.waitForTimeout(1500);
  });

  await check('demo mode is clearly labelled and simulated', async (p) => {
    await p.getByLabel('Back to 2D canvas').click();
    await p.getByRole('radio', { name: 'DEMO' }).click();
    await p.getByTestId('demo-banner').waitFor();
    await p.waitForFunction(() => document.querySelectorAll('.react-flow__node-agent').length >= 35);
    await p.getByRole('radio', { name: 'LIVE' }).click();
    await p.getByTestId('demo-banner').waitFor({ state: 'detached' });
  });

  const real = errors.filter((e) => !/WebGL|GPU|three/i.test(e));
  assert.deepEqual(real, [], `browser errors: ${real.join('\n')}`);
  console.log(`\nAll e2e checks passed. Screenshots: ${out}`);
} catch (e) {
  failed = true;
  console.error('\n✗ e2e failed:', (e as Error).message);
  if (errors.length) console.error('browser errors:', errors.slice(0, 5));
} finally {
  await browser.close();
  await app.close();
  process.exit(failed ? 1 : 0);
}
