/**
 * End-to-end test of the Deck builder (the in-app twin of the flashcard generator) with real browser sessions.
 *   npm run build && node e2e/builder.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const PORT = process.env.E2E_PORT ?? '3103';
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

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const T = await ctx.newPage();
  await T.addInitScript(() => { window.__printed = 0; window.print = () => { window.__printed++; }; }); // stand-in for the print dialog
  const S = await (await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true })).newPage();
  const errors = [];
  for (const [n, p] of [['teacher', T], ['student', S]]) { p.on('pageerror', (e) => errors.push(`${n}: ${e.message}`)); p.on('console', (m) => { if (m.type() === 'error') errors.push(`${n}: ${m.text()}`); }); }

  console.log('\n1. Load a generator list (.txt): lesson comes from the file name, position decides the pile');
  fs.writeFileSync('e2e/skills_03.txt', '# lesson 3\na, V, 2, M\nt, C, , IF\ns, C, , IF\nsh, DG, , IF\nck, DG, , F\nai, P, , M\n');
  await T.goto(BASE); await T.getByRole('button', { name: 'Deck builder' }).click();
  await T.getByText('Paste or load a flashcard-generator list').click();
  await T.locator('.import input[type=file]').setInputFiles('e2e/skills_03.txt');
  await T.waitForFunction(() => document.querySelectorAll('.builder-table tbody tr').length === 6);
  ok(true, 'six card rows were loaded from skills_03.txt');
  ok((await T.getByLabel('Deck name').inputValue()) === 'skills 03', 'the deck was named from the file');
  ok((await T.getByLabel('Lesson, row 1').inputValue()) === '3', 'lesson 3 was read from the file name');
  const piles = async () => T.locator('.builder-preview .preview-pile').evaluateAll((els) => els.map((e) => e.querySelectorAll('.preview-face').length));
  ok(JSON.stringify(await piles()) === '[3,2,4]', `position decides the pile: Beginning 3, Middle 2, Ending 4 (${JSON.stringify(await piles())})`);

  console.log('\n2. The colour code follows the category');
  const fill = (row) => T.locator('.builder-preview .preview-face svg text').evaluateAll((els, r) => els.map((e) => e.getAttribute('fill')), row);
  const fills = await fill();
  ok(fills.includes('#990000') && fills.includes('#000000') && fills.includes('#0b1a6b') && fills.includes('#c21f1f'), `V red, C black, DG navy, P lighter red are all used (${[...new Set(fills)].join(' ')})`);
  ok((await T.getByLabel('Card text, row 1').evaluate((e) => getComputedStyle(e).color)) === 'rgb(153, 0, 0)', 'the text box itself shows the category colour');
  await T.getByLabel('Category, row 2').selectOption('B');
  await eventually(async () => (await fill()).includes('#2f5fd9'), 'changing a category to B (blend) recolours the card royal blue');
  await T.getByLabel('Category, row 2').selectOption('C');

  console.log('\n7. Validation stops a bad deck');
  await T.getByRole('group', { name: 'Position, row 2' }).getByRole('button', { name: 'I' }).click();
  await T.getByRole('group', { name: 'Position, row 2' }).getByRole('button', { name: 'F' }).click();
  await eventually(async () => (await T.getByRole('alert').textContent()).includes('choose at least one position'), 'a card with no position is flagged');
  ok(await T.getByRole('button', { name: 'Save to my decks' }).isDisabled(), 'Save is disabled until it is fixed');
  await T.getByRole('group', { name: 'Position, row 2' }).getByRole('button', { name: 'I' }).click();
  await T.getByRole('group', { name: 'Position, row 2' }).getByRole('button', { name: 'F' }).click();
  await eventually(async () => !(await T.getByRole('button', { name: 'Save to my decks' }).isDisabled()), 'fixing it re-enables Save');

  console.log('\n3. Download the generator list and the game deck');
  const [txt] = await Promise.all([T.waitForEvent('download'), T.getByRole('button', { name: /Download card list/ }).click()]);
  ok(txt.suggestedFilename() === 'skills_03.txt', `the list is named like the generator expects (${txt.suggestedFilename()})`);
  const txtBody = fs.readFileSync(await txt.path(), 'utf8');
  ok(txtBody.split('\n')[0] === 'a, V, 2, M, 3' && txtBody.includes('t, C, , IF, 3'), 'it has text, category, sounds, position, lesson on each line');
  const [js] = await Promise.all([T.waitForEvent('download'), T.getByRole('button', { name: /Download deck/ }).click()]);
  const deck = JSON.parse(fs.readFileSync(await js.path(), 'utf8'));
  ok(deck.piles.length === 3 && deck.piles[1].cards[0].category === 'V' && deck.piles[1].cards[0].count === '2' && deck.piles[1].cards[0].lesson === 3, 'the deck JSON carries category, sounds and lesson on each card');

  console.log('\n4. Print cards (4×6 in, one per card, writing lines)');
  await T.getByRole('button', { name: /Print cards/ }).click();
  await T.waitForFunction(() => window.__printed >= 1, null, { timeout: 8000 });
  ok((await T.locator('.print-card').count()) === 6, 'six cards laid out for printing (one per row)');
  ok((await T.locator('.print-card svg[data-fit]').count()) === 6, 'every card had its text fitted before printing');
  ok((await T.locator('.print-card svg rect[height]').count()) === 6 * 5, 'each card has the border and its four writing lines');

  console.log('\n5. Save, pick it, and play with it');
  await T.getByRole('button', { name: 'Save to my decks' }).click();
  await T.getByRole('radio', { name: /skills 03/ }).waitFor();
  ok(await T.getByRole('radio', { name: /skills 03/ }).isChecked(), 'the new deck is already selected in the deck list');
  await T.getByRole('button', { name: 'Start game' }).click();
  const code = (await T.getByTestId('room-code').textContent()).trim();
  await S.goto(BASE); await S.getByLabel('Room code').fill(code); await S.getByRole('button', { name: 'Join game' }).click(); await S.getByTestId('student-status').waitFor();
  await eventually(async () => (await S.locator('.stack-top svg text').count()) >= 3, 'the student sees the formatted cards');
  const colours = await S.locator('.stack-top svg g > text').evaluateAll((els) => els.map((e) => e.getAttribute('fill')));
  ok(colours.length >= 3 && colours.every((c) => ['#990000', '#000000', '#0b1a6b', '#c21f1f', '#2f5fd9'].includes(c)), `the cards on the table use the category colours (${colours.join(' ')})`);
  const middle = await S.locator('.table-col').nth(1).locator('.stack-top svg g > text').evaluateAll((els) => els.map((e) => e.textContent + e.getAttribute('fill')));
  ok(middle.some((m) => /^a#990000$|^ai#c21f1f$/.test(m)), 'the middle pile holds the medial cards (a, ai) and no consonants');
  const gaps = await T.locator('.table-col').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r, i, a) => (i ? r.left - a[i - 1].right : 0)).slice(1));
  ok(gaps.every((g) => g >= 0 && g <= 10), 'the three piles touch');
  await T.screenshot({ path: `${SHOTS}/builder-table.png` });
  await T.getByRole('button', { name: /End game/ }).click(); await T.getByRole('dialog').getByRole('button', { name: 'End game' }).click();

  console.log('\n6. Edit a saved deck');
  await T.getByRole('button', { name: 'Deck builder' }).click();
  await T.getByRole('button', { name: 'Back' }).click();
  await T.getByRole('button', { name: 'Create a game' }).click();
  await T.getByRole('button', { name: /Edit skills 03 in the deck builder/ }).click();
  await T.waitForFunction(() => document.querySelectorAll('.builder-table tbody tr').length === 6);
  ok((await T.getByLabel('Card text, row 1').inputValue()) === 't', 'saved decks reopen with their rows (listed by pile: the initial cards first)');
  const pressed = async (row, p) => (await T.getByRole('group', { name: `Position, row ${row}` }).getByRole('button', { name: p, exact: true }).getAttribute('aria-pressed')) === 'true';
  ok((await pressed(1, 'I')) && (await pressed(1, 'F')) && !(await pressed(1, 'M')), 'the t card is I + F again (cards in two piles merge back into one row)');
  await T.screenshot({ path: `${SHOTS}/builder-edit.png`, fullPage: true });
  fs.rmSync('e2e/skills_03.txt');

  console.log('\n8. Mono cards (ink, ang, ow …): in the builder, then covering the Ending pile in play');
  await T.getByRole('button', { name: 'Back' }).click().catch(() => {});
  await T.getByRole('button', { name: 'Deck builder' }).click();
  await T.getByLabel('Deck name').fill('Mono test');
  await T.getByText('Paste or load a flashcard-generator list').click();
  await T.getByLabel('Card list').fill('b, C, , I\na, V, 2, M\nink, T, , Mono, 10\nt, C, , F\np, C, , F\n');
  await T.getByRole('button', { name: 'Add these cards' }).click();
  await T.waitForFunction(() => document.querySelectorAll('.builder-table tbody tr').length === 5);
  const posBtn = (row, name) => T.getByRole('group', { name: `Position, row ${row}` }).getByRole('button', { name, exact: true });
  ok((await posBtn(3, 'Mono').getAttribute('aria-pressed')) === 'true' && (await posBtn(3, 'M').getAttribute('aria-pressed')) === 'false', 'the line "ink, T, , Mono, 10" turns the Mono button on (and not M)');
  const pv = () => T.locator('.builder-preview .preview-pile').evaluateAll((els) => els.map((e) => e.querySelectorAll('.preview-face').length));
  ok(JSON.stringify(await pv()) === '[1,2,2]' && (await T.locator('.preview-face.mono').count()) === 1, 'the preview puts ink in the Medial pile and marks it Mono');
  await posBtn(3, 'F').click();
  ok((await T.locator('.preview-face.mono').count()) === 0 && JSON.stringify(await pv()) === '[1,1,3]', 'choosing F instead turns Mono off (they are exclusive)');
  await posBtn(3, 'Mono').click();
  ok((await T.locator('.preview-face.mono').count()) === 1 && JSON.stringify(await pv()) === '[1,2,2]', 'and Mono puts it back in the Medial pile');
  const [txt2] = await Promise.all([T.waitForEvent('download'), T.getByRole('button', { name: /Download card list/ }).click()]);
  ok(fs.readFileSync(await txt2.path(), 'utf8').includes('ink, T, , Mono, 10'), 'the downloaded list says "ink, T, , Mono, 10"');
  const [js2] = await Promise.all([T.waitForEvent('download'), T.getByRole('button', { name: /Download deck/ }).click()]);
  const monoDeck = JSON.parse(fs.readFileSync(await js2.path(), 'utf8'));
  ok(monoDeck.piles[1].cards.some((c) => c.text === 'ink' && c.mono === true), 'the deck JSON has "mono": true on the card, in the middle pile');

  await T.getByRole('button', { name: 'Save to my decks' }).click();
  await T.getByRole('radio', { name: /Mono test/ }).waitFor();
  await T.getByRole('button', { name: 'Start game' }).click();
  const code3 = (await T.getByTestId('room-code').textContent()).trim();
  await S.goto(BASE); await S.getByLabel('Room code').fill(code3); await S.getByRole('button', { name: 'Join game' }).click(); await S.getByTestId('student-status').waitFor();
  await T.locator('.stack-top').first().waitFor(); await sleep(500);
  const topOf = async (p, i) => /"(.+?)"/.exec((await p.locator('.table-col').nth(i).locator('.stack-top').first().getAttribute('aria-label')) ?? '')?.[1] ?? null;
  const covered = (p) => p.locator('.table-col.covered-col').count();
  const middleTo = async (want) => { for (let i = 0; i < 4 && (await topOf(T, 1)) !== want; i++) { await T.locator('.table-col').nth(1).locator('.stack-top').click(); await sleep(350); } return (await topOf(T, 1)) === want; };

  ok(await middleTo('a'), 'middle pile shows a plain card (a)');
  ok((await covered(T)) === 0 && (await T.locator('.table-col').nth(2).locator('svg text').count()) > 0, 'the Ending pile shows its card normally');
  const endingBefore = await topOf(T, 2);
  ok(await middleTo('ink'), 'tap the middle pile until the Mono card (ink) comes up');
  await eventually(async () => (await covered(T)) === 1 && (await covered(S)) === 1, 'the Ending pile is covered on the teacher AND the student screen');
  const col3 = T.locator('.table-col').nth(2);
  ok((await col3.locator('svg text, .card-text').count()) === 0 && (await col3.locator('.face-wrap.blank').count()) === 1, 'it is a blank card: no letters at all');
  ok((await T.getByText('so the Ending pile is covered').count()) === 1 && (await S.getByText('so the Ending pile is covered').count()) === 1, 'a short note explains why, on both screens');
  await col3.locator('.stack-top.covered').click({ force: true }); await sleep(400);
  await T.getByLabel(/All students/).check().catch(() => {});
  ok((await covered(T)) === 1, 'tapping the covered pile does nothing');
  await T.screenshot({ path: `${SHOTS}/builder-mono-covered.png` });
  await S.screenshot({ path: `${SHOTS}/builder-mono-covered-student.png` });
  ok(await middleTo('a'), 'tap the middle pile again: a plain card is back');
  await eventually(async () => (await covered(T)) === 0 && (await covered(S)) === 0, 'the Ending pile is uncovered on both screens');
  ok((await topOf(T, 2)) === endingBefore, `and it still shows the same card as before (${endingBefore}): nothing was used up while it was covered`);

  ok(errors.length === 0, `no browser errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  console.log(`\nAll ${passed} builder checks passed.`);
} catch (e) {
  console.error('\n' + (e instanceof Error ? e.message : e)); process.exitCode = 1;
} finally { await browser.close(); server.kill('SIGTERM'); fs.rmSync('e2e/skills_03.txt', { force: true }); }
