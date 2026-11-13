/**
 * Prints a deck's cards, one per 4×6 in page, like the Python flashcard generator (use "Save as PDF" in the print dialog).
 * One card per distinct skill row (a card that lives in two piles is printed once). Optional handwriting lines.
 * The cards are rendered off-screen, we wait for the font and the text fitting, then call window.print().
 */
import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { buildDeckMeta, deckToRows, type Deck, type SkillRow } from '@shared/index';
import { CardFace } from './CardFace';

export function PrintCards({ deck, rows, lines, onDone }: { deck: Deck; /** in the order they should print (the builder's order) */ rows?: SkillRow[]; lines: boolean; onDone(): void }) {
  const meta = useMemo(() => { const m = buildDeckMeta(deck); return { ...m, cardStyle: { ...(m.cardStyle ?? {}), writingLines: lines } }; }, [deck, lines]);
  const cards = useMemo(() => {
    const all = deck.piles.flatMap((p) => p.cards);
    return (rows ?? deckToRows(deck)).flatMap((r) => {
      const c = all.find((x) => x.text === r.text && (x.category ?? 'C') === r.category && x.count === r.count && x.lesson === r.lesson);
      return c ? [c] : [];
    });
  }, [deck, rows]);

  useEffect(() => {
    let cancelled = false;
    const after = () => onDone();
    window.addEventListener('afterprint', after);
    void (async () => {
      try { await document.fonts.load('400 100px PlaywriteCO'); await document.fonts.ready; } catch { /* print anyway */ }
      const start = Date.now();
      // wait until every card has measured its text (so the writing lines are the right length)
      while (!cancelled && Date.now() - start < 4000 && document.querySelectorAll('.print-card svg[data-fit]').length < cards.length) await new Promise((r) => setTimeout(r, 60));
      if (!cancelled) window.print();
    })();
    return () => { cancelled = true; window.removeEventListener('afterprint', after); };
  }, [cards.length, onDone]);

  return createPortal(
    <div className="print-root" aria-hidden="true">
      {cards.map((c) => (
        <div className="print-card" key={c.id} style={{ ['--aspect' as string]: meta.aspectRatio ?? 0.6662 }}>
          <CardFace text={c.text} faceDown={false} deck={meta} cardId={c.id} />
        </div>
      ))}
    </div>,
    document.body,
  );
}
