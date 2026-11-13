/**
 * Skill cards: the card model shared by the game and the flashcard generator (tools/flashcards).
 *
 * A card has a TEXT (grapheme), a CATEGORY (which sets its colour), an optional sound COUNT (shown top-left),
 * an optional LESSON number (shown bottom-right) and a POSITION: Initial, Medial or Final.
 * Position decides which pile the card lives in: I → pile 1 (beginning), M → pile 2 (middle), F → pile 3 (ending).
 * A card can have several positions (e.g. "IF" for consonants); it then appears in each of those piles.
 *
 * The text format is the generator's:   text, category, count, position, lesson     (count/position/lesson optional)
 *   a, V, 2, M
 *   t, C, , IF
 *   ck, DG, , F, 5
 *   ink, T, , Mono, 10
 *
 * POSITION "Mono" = monosyllabic final: a whole welded ending (ink, ang, ow …). The card lives in the MEDIAL pile and,
 * while it is face-up on top of that pile, the Ending pile is covered by a blank card (see coveredPileIds).
 */
import type { CardStyle } from './style';
import { DEFAULT_ASPECT_RATIO } from './style';

export const SKILL_CATEGORIES = ['V', 'C', 'DG', 'P', 'B', 'T', 'DP'] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];
export const POSITIONS = ['I', 'M', 'F'] as const;
export type Position = (typeof POSITIONS)[number];

/** MUST match CATEGORY_COLORS / NUM_GREY in tools/flashcards/card_common.py (a test enforces it). */
export const CATEGORY_COLORS: Record<SkillCategory, string> = {
  V: '#990000',   // simple vowel
  C: '#000000',   // simple consonant
  DG: '#0b1a6b',  // digraph
  P: '#c21f1f',   // vowel pair
  B: '#2f5fd9',   // consonant blend
  T: '#4b1a7a',   // trigraph
  DP: '#ff4f9a',  // diphthong
};
export const NUM_GREY = '#555555';

export const CATEGORY_LABELS: Record<SkillCategory, string> = {
  V: 'Simple vowel', C: 'Simple consonant', DG: 'Digraph', P: 'Vowel pair', B: 'Consonant blend', T: 'Trigraph', DP: 'Diphthong',
};
export const POSITION_LABELS: Record<Position, string> = { I: 'Initial (beginning)', M: 'Medial (middle)', F: 'Final (ending)' };
export const PILE_FOR_POSITION: Record<Position, { id: string; label: string }> = {
  I: { id: 'initial', label: 'Beginning sound' },
  M: { id: 'medial', label: 'Middle sound' },
  F: { id: 'final', label: 'Ending sound' },
};

/** Where a card of this category usually goes, used only when no position is given. */
export const DEFAULT_POSITIONS: Record<SkillCategory, Position[]> = {
  V: ['M'], C: ['I', 'F'], DG: ['I', 'F'], P: ['M'], B: ['I'], T: ['F'], DP: ['M', 'F'],
};

export interface SkillRow {
  text: string;
  category: SkillCategory;
  count?: string | undefined;
  lesson?: number | undefined;
  /** Monosyllabic final: lives in the medial pile (positions is ['M']) and covers the Ending pile while on top. */
  mono?: boolean | undefined;
  positions: Position[];
}

/** The look of a generator card, as deck-wide formatting (see CardStyle). Applied to every deck that has skill cards. */
export const SKILLS_CARD_STYLE: CardStyle = {
  fontId: 'playwrite-co', fontWeight: 400, fontSize: 592 / 1345, glyphY: 721 / 1345, outlineWidth: 10.064 / 592,
  background: '#ffffff', borderColor: '#666666', borderWidth: 2 / 896, cornerRadius: 58.24 / 896,
};
export const SKILLS_ASPECT_RATIO = DEFAULT_ASPECT_RATIO;

/** Per-card style derived from its skill fields: category colour, sound count (top-left), lesson number (bottom-right). */
export function skillCardStyle(card: { category?: SkillCategory | undefined; count?: string | undefined; lesson?: number | undefined }): CardStyle {
  const color = card.category ? CATEGORY_COLORS[card.category] : undefined;
  const corners: NonNullable<CardStyle['corners']> = {};
  if (card.count) corners.topLeft = { text: card.count, ...(color ? { color } : {}), fontId: 'serif' };
  if (card.lesson !== undefined) corners.bottomRight = { text: String(card.lesson), color: NUM_GREY, fontId: 'serif' };
  return { ...(color ? { textColor: color } : {}), ...(Object.keys(corners).length ? { corners } : {}) };
}

/** Combine two styles; corners are merged one by one. `b` wins. */
export function mergeStyles(a: CardStyle | undefined, b: CardStyle | undefined): CardStyle | undefined {
  if (!a && !b) return undefined;
  const corners = { ...(a?.corners ?? {}), ...(b?.corners ?? {}) };
  const out: CardStyle = { ...(a ?? {}), ...(b ?? {}) };
  if (Object.keys(corners).length) out.corners = corners; else delete out.corners;
  return out;
}

// ------------------------------------------------------------------------------------------------ text format
const isCategory = (s: string): s is SkillCategory => (SKILL_CATEGORIES as readonly string[]).includes(s);

/** Parse positions like "I", "IF", "I F", "i/m/f" → ['I','F']. Returns null if anything else is in there. */
export function parsePositions(raw: string): Position[] | null {
  const letters = raw.toUpperCase().replace(/[\s/,+&-]/g, '');
  if (!letters) return [];
  const set = new Set<Position>();
  for (const ch of letters) { if (ch !== 'I' && ch !== 'M' && ch !== 'F') return null; set.add(ch); }
  return POSITIONS.filter((p) => set.has(p));
}

/** The word used in the position column for monosyllabic finals. */
export const MONO_WORD = 'Mono';
const isMonoWord = (s: string) => /^mono(syllabic)?$/i.test(s.trim());

/**
 * Which piles are covered (shown as a blank card) right now: when the top card of the middle pile is a face-up Mono card,
 * every pile after it (the Ending pile) is covered. A face-down card never covers (that would give its secret away).
 * Used by the server (to refuse taps on a covered pile) and by the table (to draw the blank card).
 */
export function coveredPileIds(piles: { id: string; cards: { id: string; faceDown: boolean }[] }[], monoIds: Iterable<string>): Set<string> {
  const mono = new Set(monoIds);
  const covered = new Set<string>();
  if (mono.size === 0) return covered;
  piles.forEach((pile, i) => {
    const top = pile.cards[0];
    if (top && !top.faceDown && mono.has(top.id)) for (const later of piles.slice(i + 1)) covered.add(later.id);
  });
  return covered;
}

export interface ParsedSkillText { rows: SkillRow[]; warnings: string[] }

/** The generator's .txt format. Lesson comes from the 5th column, else `lessonFromFilename` (skills_03.txt → 3). */
export function parseSkillText(text: string, opts: { lessonFromFilename?: number | undefined } = {}): ParsedSkillText {
  const rows: SkillRow[] = [];
  const warnings: string[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const parts = line.split(',').map((p) => p.trim());
    const n = i + 1;
    const grapheme = parts[0] ?? '';
    if (!grapheme) return;
    let category: SkillCategory = 'C';
    const catRaw = (parts[1] ?? '').toUpperCase().replace(/\s/g, '');
    if (isCategory(catRaw)) category = catRaw;
    else warnings.push(`Line ${n} (“${line}”): ${catRaw ? `unknown category “${catRaw}”` : 'no category'}; using C (consonant, black).`);
    const count = parts[2] || undefined;
    let positions: Position[];
    const posRaw = parts[3] ?? '';
    const mono = isMonoWord(posRaw);
    const parsed = mono ? ['M' as Position] : parsePositions(posRaw);
    if (parsed === null) { warnings.push(`Line ${n}: position “${posRaw}” must be made of I, M and F; using the default for ${category}.`); positions = DEFAULT_POSITIONS[category]; }
    else if (parsed.length === 0) positions = DEFAULT_POSITIONS[category];
    else positions = parsed;
    let lesson = opts.lessonFromFilename;
    if (parts[4]) {
      if (/^\d{1,2}$/.test(parts[4])) lesson = parseInt(parts[4], 10);
      else warnings.push(`Line ${n}: lesson “${parts[4]}” is not a number; ignored.`);
    }
    rows.push({ text: grapheme, category, count, lesson, positions, ...(mono ? { mono: true } : {}) });
  });
  return { rows, warnings };
}

/** Rows → generator-compatible text (the extra position / lesson columns are ignored by the Python scripts). */
export function skillRowsToText(rows: SkillRow[]): string {
  return rows.map((r) => [r.text, r.category, r.count ?? '', r.mono ? MONO_WORD : r.positions.join(''), r.lesson ?? ''].join(', ').replace(/(, )+$/, '')).join('\n') + '\n';
}

/** `skills_03.txt` when every card is from one lesson; otherwise `skills_all.txt`. */
export function skillFileName(rows: SkillRow[]): string {
  const lessons = new Set(rows.map((r) => r.lesson));
  const only = lessons.size === 1 ? [...lessons][0] : undefined;
  return only !== undefined ? `skills_${String(only).padStart(2, '0')}.txt` : 'skills_all.txt';
}
export function lessonFromFileName(name: string): number | undefined {
  const m = name.replace(/\.[^.]+$/, '').match(/\d+/g);
  const last = m?.[m.length - 1];
  return last ? parseInt(last, 10) : undefined;
}

// ------------------------------------------------------------------------------------------------ rows ⇄ deck
const idPart = (t: string) => Array.from(t).map((ch) => (/[a-z0-9]/.test(ch) ? ch : /[A-Z]/.test(ch) ? ch.toLowerCase() : `u${ch.codePointAt(0)!.toString(16)}`)).join('');

/** Rows → a deck object (validate it with validateDeck). A row with several positions becomes one card per pile. */
export function buildSkillDeck(rows: SkillRow[], meta: { id: string; name: string; description?: string }): unknown {
  const used = new Map<string, number>();
  const piles = POSITIONS.map((pos) => ({ id: PILE_FOR_POSITION[pos].id, label: PILE_FOR_POSITION[pos].label, cards: [] as Record<string, unknown>[] }));
  for (const r of rows) {
    for (const pos of r.positions) {
      const base = `${pos.toLowerCase()}-${idPart(r.text)}`;
      const k = (used.get(base) ?? 0) + 1;
      used.set(base, k);
      piles[POSITIONS.indexOf(pos)]!.cards.push({
        id: k === 1 ? base : `${base}-${k}`, text: r.text, category: r.category,
        ...(r.count ? { count: r.count } : {}), ...(r.lesson !== undefined ? { lesson: r.lesson } : {}), ...(r.mono ? { mono: true } : {}),
      });
    }
  }
  return {
    schemaVersion: 1, id: meta.id, name: meta.name, description: (meta.description ?? '').slice(0, 300), version: '1.0.0',
    piles,
    // Position IS the pile, so cards stay where they were built; the teacher can still re-order within a pile.
    rules: { allowCrossPileMoves: false, allowReorder: true, allowFlip: false, initialShuffle: true },
    tags: ['skills'],
  };
}

/** Deck → rows again (cards with the same text/category/count/lesson in several piles merge into one row, e.g. "IF"). */
export function deckToRows(deck: { piles: { cards: { text: string; category?: SkillCategory | undefined; count?: string | undefined; lesson?: number | undefined; mono?: boolean | undefined }[] }[] }): SkillRow[] {
  const map = new Map<string, SkillRow>();
  deck.piles.forEach((pile, pi) => {
    const pos = POSITIONS[pi] as Position;
    for (const c of pile.cards) {
      const key = JSON.stringify([c.text, c.category ?? 'C', c.count ?? '', c.lesson ?? null, !!c.mono]);
      const row: SkillRow = map.get(key) ?? { text: c.text, category: c.category ?? 'C', count: c.count, lesson: c.lesson, positions: [], ...(c.mono ? { mono: true } : {}) };
      if (!row.positions.includes(pos)) row.positions.push(pos);
      map.set(key, row);
    }
  });
  return [...map.values()].map((r) => ({ ...r, positions: POSITIONS.filter((p) => r.positions.includes(p)) }));
}
