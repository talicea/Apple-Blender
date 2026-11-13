import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  CATEGORY_COLORS, NUM_GREY, coveredPileIds, SKILL_CATEGORIES, buildDeckMeta, buildSkillDeck, deckToRows, lessonFromFileName, parsePositions, parseSkillText,
  skillFileName, skillRowsToText, validateDeck,
} from '@shared/index';

describe('colour coding matches the Python flashcard generator', () => {
  const py = fs.readFileSync(path.resolve(process.cwd(), 'tools/flashcards/card_common.py'), 'utf8');
  const vars = Object.fromEntries([...py.matchAll(/^([A-Z_]+)\s*=\s*"(#[0-9a-fA-F]{6})"/gm)].map((m) => [m[1], m[2]!.toLowerCase()]));
  const block = /CATEGORY_COLORS = \{([\s\S]*?)\n\}/.exec(py)?.[1] ?? '';
  const fromPy = Object.fromEntries([...block.matchAll(/"([A-Z]+)":\s*(?:"(#[0-9a-fA-F]{6})"|([A-Z_]+))/g)].map((m) => [m[1], (m[2] ?? vars[m[3]!])?.toLowerCase()]));

  it('has exactly the same categories and colours as CATEGORY_COLORS in card_common.py', () => {
    expect(Object.keys(fromPy).sort()).toEqual([...SKILL_CATEGORIES].sort());
    for (const c of SKILL_CATEGORIES) expect(CATEGORY_COLORS[c].toLowerCase(), c).toBe(fromPy[c]);
  });
  it('uses the same lesson-number grey', () => { expect(NUM_GREY.toLowerCase()).toBe(vars.NUM_GREY); });
});

describe('the generator text format', () => {
  it('parses text, category, count, position and lesson', () => {
    const { rows, warnings } = parseSkillText('# comment\n\na, V, 2, M\nt, C, , IF\nck, DG, , F, 5\n', { lessonFromFilename: 1 });
    expect(warnings).toEqual([]);
    expect(rows).toEqual([
      { text: 'a', category: 'V', count: '2', lesson: 1, positions: ['M'] },
      { text: 't', category: 'C', count: undefined, lesson: 1, positions: ['I', 'F'] },
      { text: 'ck', category: 'DG', count: undefined, lesson: 5, positions: ['F'] },
    ]);
  });
  it('still reads the generator\'s OLD files (no position column) using sensible defaults per category', () => {
    const { rows } = parseSkillText('a,V,2\nb,C\nsh,DG\nai,P\nst,B\ntch,T\noi,DP\n');
    expect(rows.map((r) => r.positions.join(''))).toEqual(['M', 'IF', 'IF', 'M', 'I', 'F', 'MF']);
  });
  it('warns about unknown categories and bad positions/lessons instead of failing', () => {
    const { rows, warnings } = parseSkillText('x, ZZ\ny, C, , Q\nz, C, , I, abc\n');
    expect(rows).toHaveLength(3); expect(rows[0]!.category).toBe('C');
    expect(warnings.join('\n')).toMatch(/unknown category “ZZ”/); expect(warnings.join('\n')).toMatch(/position “Q”/); expect(warnings.join('\n')).toMatch(/lesson “abc”/);
  });
  it('accepts positions written several ways', () => {
    for (const [raw, want] of [['I', ['I']], ['fi', ['I', 'F']], ['I M F', ['I', 'M', 'F']], ['i/f', ['I', 'F']], ['', []]] as const) expect(parsePositions(raw)).toEqual(want);
    expect(parsePositions('X')).toBeNull();
  });
  it('writes text the Python scripts can read (extra columns are ignored by them) and names files like the generator', () => {
    const rows = parseSkillText('a,V,2,M\nt,C,,IF\n', { lessonFromFilename: 3 }).rows;
    expect(skillRowsToText(rows)).toBe('a, V, 2, M, 3\nt, C, , IF, 3\n');
    expect(skillFileName(rows)).toBe('skills_03.txt');
    expect(skillFileName([...rows, { ...rows[0]!, lesson: 4 }])).toBe('skills_all.txt');
    expect(lessonFromFileName('skills_07.txt')).toBe(7); expect(lessonFromFileName('mine.txt')).toBeUndefined();
  });
});

describe('rows ⇄ deck', () => {
  const rows = parseSkillText('a,V,2,M\nt,C,,IF\nsh,DG,,IF\nck,DG,,F,2\na,V,2,M,2\n', { lessonFromFilename: 1 }).rows;

  it('builds a valid deck: position decides the pile, multi-position rows are duplicated with distinct ids', () => {
    const v = validateDeck(buildSkillDeck(rows, { id: 'skills-1', name: 'Skills 1' }));
    expect(v.ok, v.ok ? '' : v.errors.join()).toBe(true);
    if (!v.ok) return;
    const texts = v.deck.piles.map((p) => p.cards.map((c) => c.text).join(' '));
    expect(texts).toEqual(['t sh', 'a a', 't sh ck']);
    const ids = v.deck.piles.flatMap((p) => p.cards.map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(v.deck.piles[1]!.cards[0]).toMatchObject({ category: 'V', count: '2', lesson: 1 });
    expect(v.deck.rules.allowCrossPileMoves).toBe(false);
  });
  it('round-trips back into the same rows', () => {
    const v = validateDeck(buildSkillDeck(rows, { id: 'skills-1', name: 'Skills 1' })); if (!v.ok) throw new Error();
    expect(deckToRows(v.deck)).toEqual(expect.arrayContaining(rows.map((r) => expect.objectContaining({ text: r.text, category: r.category, positions: r.positions }))));
    expect(deckToRows(v.deck)).toHaveLength(rows.length);
  });
  it('rejects bad skill fields in a deck', () => {
    const base = buildSkillDeck(rows, { id: 's', name: 'S' }) as { piles: { cards: Record<string, unknown>[] }[] };
    for (const patch of [{ category: 'X' }, { count: '1234567' }, { lesson: 0 }, { lesson: 1.5 }, { lesson: 100 }]) {
      const d = JSON.parse(JSON.stringify(base)); Object.assign(d.piles[0].cards[0], patch);
      expect(validateDeck(d).ok, JSON.stringify(patch)).toBe(false);
    }
  });
  it('colours cards by category in the client metadata, with the count and lesson corners', () => {
    const v = validateDeck(buildSkillDeck(rows, { id: 's', name: 'S' })); if (!v.ok) throw new Error();
    const m = buildDeckMeta(v.deck);
    expect(m.styled).toBe(true); expect(m.cardStyle?.fontId).toBe('playwrite-co'); expect(m.aspectRatio).toBeCloseTo(0.66617, 4);
    const a = v.deck.piles[1]!.cards[0]!; const sh = v.deck.piles[0]!.cards[1]!;
    expect(m.cardStyles[a.id]).toMatchObject({ textColor: CATEGORY_COLORS.V, corners: { topLeft: { text: '2', color: CATEGORY_COLORS.V, fontId: 'serif' }, bottomRight: { text: '1', color: NUM_GREY } } });
    expect(m.cardStyles[sh.id]).toMatchObject({ textColor: CATEGORY_COLORS.DG });
  });
  it('lets a deck override the category colour explicitly', () => {
    const d = buildSkillDeck(rows, { id: 's', name: 'S' }) as { piles: { cards: Record<string, unknown>[] }[] };
    d.piles[0]!.cards[0]!.style = { textColor: '#123456' };
    const v = validateDeck(d); if (!v.ok) throw new Error();
    expect(buildDeckMeta(v.deck).cardStyles[v.deck.piles[0]!.cards[0]!.id]!.textColor).toBe('#123456');
  });
});

describe('Mono: monosyllabic finals (ink, ang, ow …)', () => {
  const text = 'a, V, 2, M, 10\nt, C, , IF, 10\nink, T, , Mono, 10\now, P, , mono, 30\n';
  const rows = parseSkillText(text).rows;

  it('parses "Mono" (any case) as a medial card flagged mono, with no warnings', () => {
    const r = parseSkillText(text);
    expect(r.warnings).toEqual([]);
    expect(r.rows[2]).toMatchObject({ text: 'ink', category: 'T', lesson: 10, positions: ['M'], mono: true });
    expect(r.rows[3]).toMatchObject({ text: 'ow', positions: ['M'], mono: true });
    expect(r.rows[0]!.mono).toBeUndefined();
    expect(parseSkillText('ink, T, , Monosyllabic\n').rows[0]!.mono).toBe(true);
  });
  it('writes it back as "Mono" so the text round-trips (and the Python scripts just ignore the column)', () => {
    expect(skillRowsToText(rows)).toBe('a, V, 2, M, 10\nt, C, , IF, 10\nink, T, , Mono, 10\now, P, , Mono, 30\n');
    expect(parseSkillText(skillRowsToText(rows)).rows).toEqual(rows);
  });
  it('puts mono cards in the MIDDLE pile with mono:true, and rows come back from the deck', () => {
    const v = validateDeck(buildSkillDeck(rows, { id: 'm', name: 'M' })); if (!v.ok) throw new Error(v.errors.join());
    expect(v.deck.piles.map((p) => p.cards.map((c) => c.text).join(' '))).toEqual(['t', 'a ink ow', 't']);
    expect(v.deck.piles[1]!.cards.filter((c) => c.mono).map((c) => c.text)).toEqual(['ink', 'ow']);
    expect(deckToRows(v.deck)).toEqual(expect.arrayContaining([expect.objectContaining({ text: 'ink', mono: true, positions: ['M'] })]));
    expect(deckToRows(v.deck)).toHaveLength(rows.length);
    expect(buildDeckMeta(v.deck).monoCardIds).toEqual(['m-ink', 'm-ow']);
  });
  it('a plain medial card with the same text is NOT merged with a mono card', () => {
    const r = parseSkillText('b, C, , I\now, P, , M\now, P, , Mono\nt, C, , F\n').rows;
    const v = validateDeck(buildSkillDeck(r, { id: 'm', name: 'M' })); if (!v.ok) throw new Error(v.errors.join());
    expect(deckToRows(v.deck).filter((x) => x.text === 'ow').map((x) => !!x.mono).sort()).toEqual([false, true]);
  });
  it('the schema only allows mono cards in the middle pile', () => {
    for (const pile of [0, 2]) {
      const d = buildSkillDeck(rows, { id: 'm', name: 'M' }) as { piles: { cards: Record<string, unknown>[] }[] };
      d.piles[pile]!.cards[0]!.mono = true;
      const v = validateDeck(d);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.errors.join('\n')).toMatch(/belong in the middle pile/);
    }
    const bad = buildSkillDeck(rows, { id: 'm', name: 'M' }) as { piles: { cards: Record<string, unknown>[] }[] };
    bad.piles[1]!.cards[0]!.mono = 'yes';
    expect(validateDeck(bad).ok).toBe(false);
  });
});

describe('coveredPileIds', () => {
  const pile = (id: string, ...cards: [string, boolean?][]) => ({ id, cards: cards.map(([cid, fd]) => ({ id: cid, faceDown: !!fd })) });
  it('covers the Ending pile only while a FACE-UP mono card is on top of the middle pile', () => {
    const board = (mid: [string, boolean?][]) => [pile('i', ['t']), pile('m', ...mid), pile('f', ['p'])];
    expect([...coveredPileIds(board([['ink'], ['a']]), ['ink'])]).toEqual(['f']);
    expect([...coveredPileIds(board([['a'], ['ink']]), ['ink'])]).toEqual([]);        // mono is not on top
    expect([...coveredPileIds(board([['ink', true]]), ['ink'])]).toEqual([]);          // face-down: must not give its secret away
    expect([...coveredPileIds(board([['ink']]), [])]).toEqual([]);                      // no mono cards in the deck
    expect([...coveredPileIds([pile('i'), pile('m'), pile('f')], ['ink'])]).toEqual([]); // empty piles
  });
});
