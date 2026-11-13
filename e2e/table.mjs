/**
 * End-to-end test of the sandbox TABLE view with two real browser sessions (desktop teacher + touch phone student).
 *   npm run build && node e2e/table.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const PORT = process.env.E2E_PORT ?? '3101';
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = 'e2e/screenshots'; fs.mkdirSync(SHOTS, { recursive: true });
const server = spawn('node', ['dist/server/index.js'], { env: { ...process.env, PORT, HOST: '127.0.0.1', NODE_ENV: 'production' }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));

let passed = 0;
const ok = (c, m) => { if (!c) throw new Error(`FAILED: ${m}`); passed++; console.log(`  ✓ ${m}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function eventually(fn, msg, timeout = 6000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { try { if (await fn()) return ok(true, msg); } catch { /* retry */ } await sleep(80); }
  throw new Error(`FAILED (timeout): ${msg}`);
}
/** "m|i|t": the visible top card of each pile, read from the accessible labels. */
const tops = (p) => p.locator('.stack-top, .stack-empty').evaluateAll((els) => els.map((e) => /"(.+?)"/.exec(e.getAttribute('aria-label') ?? '')?.[1] ?? '∅').join('|'));
const col = (p, i) => p.locator('.table-col').nth(i);

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  const T = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  const S = await (await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })).newPage();
  const errors = [];
  for (const [n, p] of [['teacher', T], ['student', S]]) { p.on('pageerror', (e) => errors.push(`${n}: ${e.message}`)); p.on('console', (m) => { if (m.type() === 'error') errors.push(`${n}: ${m.text()}`); }); }

  console.log('\n1. Import formatted card sheets and start a game');
  await T.goto(BASE); await T.getByRole('button', { name: 'Create a game' }).click();
  await T.getByRole('radio', { name: /Short vowels/ }).waitFor();
  await T.locator('input[type=file]').setInputFiles(['client/tests/fixtures/skills_1.html', 'client/tests/fixtures/skills_5.html', 'client/tests/fixtures/skills_8.html']);
  await T.getByRole('button', { name: /^Add 3 decks/ }).click();
  await T.getByRole('radio', { name: /lessons 1, 5, 8/ }).check();
  await T.getByRole('button', { name: 'Start game' }).click();
  const code = (await T.getByTestId('room-code').textContent()).trim();
  await S.goto(BASE); await S.getByLabel('Room code').fill(code); await S.getByRole('button', { name: 'Join game' }).click(); await S.getByTestId('student-status').waitFor();
  await T.locator('.stack-top svg').first().waitFor();
  ok((await T.locator('.table-surface').count()) === 1 && (await S.locator('.table-surface').count()) === 1, 'both screens open on the eggshell table');
  ok((await T.evaluate(() => getComputedStyle(document.body).backgroundColor)) === 'rgb(245, 240, 230)', 'page background is eggshell (#f5f0e6)');
  ok((await T.locator('.stack-top').count()) === 3 && (await T.locator('.stack-top svg text').first().getAttribute('font-family')).includes('PlaywriteCO'), 'three face-up stacks drawn with the card formatting');
  ok((await T.locator('.discard, .discard-top, .discard-fan').count()) === 0, 'there are no discard piles');
  const gaps = await T.locator('.table-col').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r, i, a) => (i ? r.left - a[i - 1].right : 0)).slice(1));
  ok(gaps.every((g) => g >= 0 && g <= 10), `the three piles sit right next to each other (gaps ${gaps.map((g) => Math.round(g)).join(', ')}px)`);
  const start = await tops(T);
  ok(start === (await tops(S)), `same top cards on both screens (${start})`);
  await T.screenshot({ path: `${SHOTS}/table-1-teacher.png` });

  console.log('\n2. Teacher taps a pile: the next card appears (everywhere)');
  const left = async (p, i) => parseInt(await col(p, i).locator('.count').first().textContent(), 10);
  const n0 = await left(T, 0);
  await col(T, 0).locator('.stack-top').click();
  await eventually(async () => (await tops(T)) !== start && (await tops(T)) === (await tops(S)), 'the next card is showing, identically on the student phone');
  ok((await left(T, 0)) === n0 - 1 && (await left(S, 0)) === n0 - 1, `the pile counts down (${n0} → ${n0 - 1})`);
  await S.screenshot({ path: `${SHOTS}/table-2-student-phone.png` });

  console.log('\n3. Double tap draws only once');
  const n2 = await left(T, 2);
  await col(T, 2).locator('.stack-top').dblclick();
  await sleep(600);
  ok((await left(T, 2)) === n2 - 1, `double tap drew exactly one card (${n2} → ${await left(T, 2)})`);

  console.log('\n4. Student cannot draw while the teacher has control');
  const sBefore = await tops(S);
  await col(S, 1).locator('.stack-top').click({ force: true }); await sleep(500);
  ok((await tops(S)) === sBefore && (await tops(T)) === sBefore, 'a student tap changed nothing');
  ok((await S.locator('.table-actions').count()) === 0 && (await S.getByText('Arrange cards').count()) === 0, 'student sees no teacher buttons');

  console.log('\n5. Teacher allows all students: the student can tap too');
  await T.getByLabel(/All students/).check();
  await eventually(async () => (await S.getByTestId('student-status').textContent()).includes('You can move cards'), 'student UI updates immediately');
  const t5 = await tops(T);
  await col(S, 0).locator('.stack-top').tap();
  await eventually(async () => (await tops(T)) !== t5 && (await tops(T)) === (await tops(S)), 'the student tap changed the card on the teacher screen as well');

  console.log('\n6. Back undoes an accidental tap');
  const beforeTap = (await tops(T)).split('|')[0];
  await col(T, 0).locator('.stack-top').click();
  await eventually(async () => (await tops(T)).split('|')[0] !== beforeTap, 'a card was shown');
  await col(T, 0).getByRole('button', { name: /Back/ }).click();
  await eventually(async () => (await tops(T)).split('|')[0] === beforeTap && (await tops(S)).split('|')[0] === beforeTap, `"${beforeTap}" is back on top, on both screens`);

  console.log('\n7. A pile never runs out: every card once per round, then it reshuffles');
  await T.getByLabel(/Teacher only/).check();
  await T.getByRole('button', { name: /Reset board/ }).click(); await T.getByRole('dialog').getByRole('button', { name: 'Reset board' }).click();
  await eventually(async () => (await left(T, 0)) > 3 && (await tops(T)) === (await tops(S)), 'board reset');
  const k = await left(T, 0);
  const seen = [];
  for (let i = 0; i < k; i++) { seen.push((await tops(T)).split('|')[0]); await col(T, 0).locator('.stack-top').click(); await sleep(260); }
  ok(new Set(seen).size === k, `all ${k} cards were shown once each (${seen.join(' ')})`);
  await eventually(async () => (await left(T, 0)) === k, 'a new round started by itself (the pile is full again)');
  ok((await tops(T)).split('|')[0] !== seen[k - 1], 'the new round does not start with the card just shown');
  ok((await col(T, 0).locator('.stack-top').count()) === 1, 'the pile is never empty');
  await eventually(async () => (await tops(S)) === (await tops(T)), 'student screen matches');

  console.log('\n8. A deck with no formatting is drawn in script letters');
  fs.writeFileSync('e2e/plain-deck.json', JSON.stringify({ schemaVersion: 1, id: 'plain', name: 'Plain deck', version: '1', piles: ['x', 'y', 'z'].map((id, i) => ({ id, label: `Pile ${i + 1}`, cards: [{ id: `${id}1`, text: ['sh', 'a', 'ck'][i] }, { id: `${id}2`, text: ['ch', 'e', 'tch'][i] }] })) }));
  await T.getByRole('button', { name: /Change deck/ }).click();
  await T.locator('dialog input[type=file]').setInputFiles('e2e/plain-deck.json');
  await T.getByText(/Added “Plain deck”/).waitFor();
  await T.getByRole('button', { name: 'Use this deck' }).click();
  await eventually(async () => (await T.locator('.stack-top .face-wrap.plain .card-text').count()) === 3, 'the plain deck is shown on the table');
  const fs_ = await T.locator('.stack-top .card-text').first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  ok(fs_ > 40, `plain-deck letters are large (${fs_.toFixed(0)}px)`);
  fs.rmSync('e2e/plain-deck.json');
  await T.screenshot({ path: `${SHOTS}/table-3-plain-deck.png` });

  console.log('\n9. Arrange view is still available to the teacher');
  await T.getByRole('button', { name: /Arrange cards/ }).click();
  ok((await T.locator('.piles .pile').count()) === 3, 'classic drag-to-arrange board opens');
  await T.getByRole('button', { name: /^🃏 Table/ }).click();

  ok(errors.length === 0, `no browser errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  console.log(`\nAll ${passed} table checks passed.`);
} catch (e) {
  console.error('\n' + (e instanceof Error ? e.message : e)); process.exitCode = 1;
} finally { await browser.close(); server.kill('SIGTERM'); }
