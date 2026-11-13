/**
 * Deck builder: the in-app twin of the flashcard generator.
 * Each row is one card, with the same fields as the generator's text files:
 *   grapheme · category (sets the colour) · sound count · lesson · position (I / M / F = which pile it goes in).
 * A card may have several positions (e.g. consonants I + F). Rows can be pasted / loaded from a generator .txt file,
 * the deck can be saved to this browser, downloaded (.json for the game, .txt for the Python generator) or printed.
 */
import { useMemo, useRef, useState } from 'react';
import {
  CATEGORY_COLORS, CATEGORY_LABELS, DEFAULT_POSITIONS, POSITIONS, POSITION_LABELS, SKILL_CATEGORIES, buildDeckMeta, buildSkillDeck, deckToRows,
  lessonFromFileName, parseSkillText, skillFileName, skillRowsToText, validateDeck, type Deck, type Position, type SkillCategory, type SkillRow,
} from '@shared/index';
import { CardFace } from './CardFace';
import { PrintCards } from './PrintCards';

interface Row { key: number; text: string; category: SkillCategory; count: string; lesson: string; positions: Position[]; /** monosyllabic final: lives in the medial pile and covers the Ending pile */ mono: boolean }
let nextKey = 1;
const blank = (lesson = ''): Row => ({ key: nextKey++, text: '', category: 'C', count: '', lesson, positions: DEFAULT_POSITIONS.C, mono: false });
const fromSkill = (r: SkillRow): Row => ({ key: nextKey++, text: r.text, category: r.category, count: r.count ?? '', lesson: r.lesson !== undefined ? String(r.lesson) : '', positions: r.positions, mono: !!r.mono });
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DeckBuilder({ initial, onSave, onCancel, notify }: { initial: Deck | null; onSave(deck: Deck): void; onCancel(): void; notify(msg: string): void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [rows, setRows] = useState<Row[]>(() => (initial ? deckToRows(initial).map(fromSkill) : [blank()]));
  const [defaultLesson, setDefaultLesson] = useState('');
  const [pasted, setPasted] = useState('');
  const [importNotes, setImportNotes] = useState<string[]>([]);
  const [lines, setLines] = useState(true);
  const [printing, setPrinting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const setCategory = (key: number, category: SkillCategory) => setRows((rs) => rs.map((r) => {
    if (r.key !== key) return r;
    // changing the category re-suggests the position unless the teacher has already chosen a non-default one
    if (r.mono) return { ...r, category }; // a monosyllabic final stays where it is
    const wasDefault = r.positions.join('') === DEFAULT_POSITIONS[r.category].join('');
    return { ...r, category, positions: wasDefault ? DEFAULT_POSITIONS[category] : r.positions };
  }));
  // Mono is exclusive with I / M / F: choosing one of those turns Mono off.
  const togglePos = (key: number, p: Position) => setRows((rs) => rs.map((r) => (r.key !== key ? r : r.mono ? { ...r, mono: false, positions: [p] } : { ...r, positions: POSITIONS.filter((x) => (x === p ? !r.positions.includes(x) : r.positions.includes(x))) })));
  const toggleMono = (key: number) => setRows((rs) => rs.map((r) => (r.key !== key ? r : r.mono ? { ...r, mono: false } : { ...r, mono: true, positions: ['M'] })));

  // ---- build + validate on every change
  const built = useMemo(() => {
    const problems: string[] = [];
    const skill: SkillRow[] = [];
    rows.forEach((r, i) => {
      if (!r.text.trim()) return;
      const n = i + 1;
      if (!r.mono && r.positions.length === 0) problems.push(`Row ${n} (“${r.text}”): choose at least one position (I, M or F).`);
      let lesson: number | undefined;
      if (r.lesson.trim()) {
        if (/^\d{1,2}$/.test(r.lesson.trim()) && +r.lesson >= 1) lesson = +r.lesson;
        else problems.push(`Row ${n} (“${r.text}”): lesson must be a number from 1 to 99.`);
      }
      skill.push({ text: r.text.trim(), category: r.category, count: r.count.trim() || undefined, lesson, positions: r.mono ? ['M'] : r.positions, ...(r.mono ? { mono: true } : {}) });
    });
    if (!name.trim()) problems.push('Give the deck a name.');
    if (skill.length === 0) problems.push('Add at least one card.');
    const id = initial?.id ?? `my-${slug(name) || 'deck'}`;
    const candidate = buildSkillDeck(skill, { id, name: name.trim() || 'My deck', description: `Built in the deck builder (${skill.length} cards).` });
    const v = validateDeck(candidate);
    if (!v.ok) problems.push(...v.errors);
    return { skill, problems, deck: v.ok ? v.deck : null };
  }, [rows, name, initial?.id]);
  const meta = useMemo(() => (built.deck ? buildDeckMeta(built.deck) : null), [built.deck]);
  const canSave = built.problems.length === 0 && !!built.deck;

  // ---- import from the generator's text files
  const addParsed = (text: string, lessonFromFile?: number, fileName?: string) => {
    const lessonFallback = lessonFromFile ?? (/^\d{1,2}$/.test(defaultLesson) ? +defaultLesson : undefined);
    const { rows: parsed, warnings } = parseSkillText(text, { lessonFromFilename: lessonFallback });
    setImportNotes(warnings);
    if (parsed.length === 0) { notify('No cards were found in that text.'); return; }
    setRows((rs) => [...rs.filter((r) => r.text.trim() !== ''), ...parsed.map(fromSkill)]); // blank placeholder rows make way for the new ones
    if (!name.trim() && fileName) setName(fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '));
    notify(`Added ${parsed.length} card row${parsed.length === 1 ? '' : 's'}.`);
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 200 * 1024) { notify('That file is too large to be a card list.'); return; }
    addParsed(await f.text(), lessonFromFileName(f.name), f.name);
  };

  const counts = built.deck ? built.deck.piles.map((p) => p.cards.length) : [0, 0, 0];

  return (
    <main className="builder">
      <header className="topbar">
        <h1 className="brand small">Phonics Piles <span className="muted">· Deck builder</span></h1>
        <button type="button" className="btn" onClick={onCancel}>Back</button>
      </header>

      <section className="panel">
        <label htmlFor="deck-name">Deck name</label>
        <input id="deck-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Skills · lesson 3" />
        <p className="muted small">Each row is one card. <strong>Category</strong> sets the colour (same codes as the flashcard generator). <strong>Position</strong> says which pile the card goes in — <strong>I</strong> Initial (beginning), <strong>M</strong> Medial (middle), <strong>F</strong> Final (ending) — and a card can be in more than one. <strong>Mono</strong> is for a whole ending such as <em>ink</em>, <em>ang</em> or <em>ow</em>: the card sits in the Medial pile and <strong>covers the Ending pile</strong> with a blank card while it is showing.</p>
        <div className="legend" aria-label="Colour code">
          {SKILL_CATEGORIES.map((c) => <span key={c} className="legend-item"><span className="swatch-dot" style={{ background: CATEGORY_COLORS[c] }} aria-hidden="true" /> <strong>{c}</strong> {CATEGORY_LABELS[c]}</span>)}
        </div>
      </section>

      <section className="panel">
        <div className="table-scroll">
          <table className="builder-table">
            <thead><tr><th scope="col">Card text</th><th scope="col">Category</th><th scope="col">Sounds</th><th scope="col">Lesson</th><th scope="col">Position</th><th scope="col"><span className="sr-only">Remove</span></th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key}>
                  <td><input aria-label={`Card text, row ${i + 1}`} className="cell-text" style={{ color: CATEGORY_COLORS[r.category] }} value={r.text} maxLength={16} onChange={(e) => update(r.key, { text: e.target.value })} /></td>
                  <td>
                    <select aria-label={`Category, row ${i + 1}`} value={r.category} onChange={(e) => setCategory(r.key, e.target.value as SkillCategory)}>
                      {SKILL_CATEGORIES.map((c) => <option key={c} value={c}>{c} — {CATEGORY_LABELS[c]}</option>)}
                    </select>
                  </td>
                  <td><input aria-label={`Sound count, row ${i + 1}`} className="cell-num" value={r.count} maxLength={6} inputMode="numeric" onChange={(e) => update(r.key, { count: e.target.value })} /></td>
                  <td><input aria-label={`Lesson, row ${i + 1}`} className="cell-num" value={r.lesson} maxLength={2} inputMode="numeric" onChange={(e) => update(r.key, { lesson: e.target.value.replace(/\D/g, '') })} /></td>
                  <td>
                    <div className="pos-group" role="group" aria-label={`Position, row ${i + 1}`}>
                      {POSITIONS.map((p) => { const on = !r.mono && r.positions.includes(p); return <button key={p} type="button" className={`pos${on ? ' on' : ''}`} aria-pressed={on} title={POSITION_LABELS[p]} onClick={() => togglePos(r.key, p)}>{p}</button>; })}
                      <button type="button" className={`pos mono${r.mono ? ' on' : ''}`} aria-pressed={r.mono} title="Monosyllabic final (a whole ending like ink or ow): lives in the Medial pile and covers the Ending pile" onClick={() => toggleMono(r.key)}>Mono</button>
                    </div>
                  </td>
                  <td><button type="button" className="btn small" aria-label={`Remove row ${i + 1}`} onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [blank()]))}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={() => setRows((rs) => [...rs, blank(defaultLesson)])}>＋ Add a card</button>
          <label className="inline" htmlFor="def-lesson">Lesson for new cards <input id="def-lesson" className="cell-num" value={defaultLesson} maxLength={2} inputMode="numeric" onChange={(e) => setDefaultLesson(e.target.value.replace(/\D/g, ''))} /></label>
        </div>

        <details className="import">
          <summary>Paste or load a flashcard-generator list</summary>
          <p className="muted small">One card per line: <code>text, category, sounds, position, lesson</code> (sounds, position and lesson are optional; position is I, M, F, a mix like IF, or <code>Mono</code>). Example: <code>a, V, 2, M</code>. Files like <code>skills_03.txt</code> take their lesson from the file name. Lines without a position get a sensible default for their category.</p>
          <textarea aria-label="Card list" rows={5} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={'a, V, 2, M\nt, C, , IF\nck, DG, , F\nink, T, , Mono, 10'} />
          <div className="row">
            <button type="button" className="btn" disabled={!pasted.trim()} onClick={() => { addParsed(pasted); setPasted(''); }}>Add these cards</button>
            <label className="btn file-btn">Load a .txt file…<input ref={fileRef} type="file" accept=".txt,text/plain" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void onFile(f); }} /></label>
          </div>
          {importNotes.length > 0 && <div className="error" role="status"><ul>{importNotes.map((n, i) => <li key={i}>{n}</li>)}</ul></div>}
        </details>
      </section>

      <section className="panel" aria-live="polite">
        <h2>Preview</h2>
        {built.problems.length > 0 && <div className="error" role="alert"><strong>Before you can save:</strong><ul>{built.problems.slice(0, 8).map((p, i) => <li key={i}>{p}</li>)}</ul></div>}
        {meta && built.deck && (
          <div className="builder-preview" style={{ ['--aspect' as string]: meta.aspectRatio ?? 0.6662 }}>
            {built.deck.piles.map((p, i) => (
              <div key={p.id} className="preview-pile">
                <strong>{POSITIONS[i]} · {p.label}</strong> <span className="count">({counts[i]})</span>
                <div className="preview-faces big">
                  {p.cards.map((c) => <div className={`preview-face${c.mono ? ' mono' : ''}`} key={c.id} title={c.mono ? `${c.text} (covers the Ending pile)` : c.text}><CardFace text={c.text} faceDown={false} deck={meta} cardId={c.id} /></div>)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel builder-actions">
        <button type="button" className="btn primary big" disabled={!canSave} onClick={() => built.deck && onSave(built.deck)}>Save to my decks</button>
        <button type="button" className="btn" disabled={!canSave} onClick={() => built.deck && download(`${built.deck.id}.json`, JSON.stringify(built.deck, null, 2) + '\n', 'application/json')}>Download deck (.json)</button>
        <button type="button" className="btn" disabled={built.skill.length === 0} onClick={() => download(skillFileName(built.skill), skillRowsToText(built.skill), 'text/plain')}>Download card list (.txt)</button>
        <span className="row">
          <button type="button" className="btn" disabled={!canSave} onClick={() => setPrinting(true)}>🖨 Print cards (4×6 in)</button>
          <label className="inline"><input type="checkbox" checked={lines} onChange={(e) => setLines(e.target.checked)} /> writing lines</label>
        </span>
      </section>
      {printing && built.deck && <PrintCards deck={built.deck} rows={built.skill} lines={lines} onDone={() => setPrinting(false)} />}
    </main>
  );
}
