/**
 * The "sandbox table": an eggshell surface with the three piles side by side, face-up, touching each other so the
 * three top cards read as ONE word for blending practice.
 *  - Tap a pile → the top card is shown and the next card appears (every card once per round, then it reshuffles).
 *  - "Back" under a pile undoes the last tap (for an accidental tap).
 * The server is authoritative: a tap sends a request, and the cards move when the broadcast arrives.
 */
import { useRef } from 'react';
import { DEFAULT_ASPECT_RATIO, coveredPileIds, type AckResult, type BoardView, type CardView, type DeckMeta, type PileView } from '@shared/index';
import { CardFace } from './CardFace';

export interface TableProps {
  board: BoardView;
  deck: DeckMeta;
  canManipulate: boolean;
  statusMessage: string;
  /** Larger cards and labels for classroom projection. */
  projector?: boolean;
  onDraw(pileId: string, expectedCardId: string): Promise<AckResult>;
  onUndo(pileId: string): Promise<AckResult>;
  onShuffle(pileId: string): Promise<AckResult>;
  /** Flip the top card of a pile (only when deck.rules.allowFlip). */
  onFlip?(cardId: string, baseVersion: number): Promise<AckResult>;
  notify(message: string): void;
}

const label = (c: CardView | undefined) => (!c ? 'nothing' : c.faceDown || c.text === null ? 'a hidden card' : `"${c.text}"`);

function Face({ card, deck }: { card: CardView; deck: DeckMeta }) {
  return (
    <span className={`face-wrap${deck.styled ? ' styled' : ' plain'}`}>
      <CardFace text={card.text} faceDown={card.faceDown} deck={deck} cardId={card.id} />
    </span>
  );
}

function Column({ pile, index, board, isCovered, ...p }: { pile: PileView; index: number; isCovered: boolean } & TableProps) {
  const { deck, canManipulate: can } = p;
  const busy = useRef(false);
  const top = pile.cards[0];
  const layers = Math.min(3, Math.max(0, pile.cards.length - 1));

  // One request at a time per pile: a second tap while the first is in flight is ignored (the server also rejects it as stale).
  const run = async (fn: () => Promise<AckResult>) => {
    if (busy.current) return;
    busy.current = true;
    try { const r = await fn(); if (!r.ok && r.code !== 'STALE') p.notify(r.message); } finally { busy.current = false; }
  };

  if (isCovered) {
    // A monosyllabic ending (ink, ang, ow…) is showing in the middle: the Ending pile is covered by a blank card.
    return (
      <section className="table-col covered-col" aria-label={`${pile.label} pile, covered`}>
        <h2 className="table-label"><span className="pile-num" aria-hidden="true">{index + 1}</span> {pile.label}</h2>
        <div className="stack">
          <div className="stack-top covered" role="img" aria-label={`${pile.label} pile is covered: the middle card is already a whole ending.`}>
            <span className="face-wrap blank" />
          </div>
        </div>
        <p className="count" aria-hidden="true">&nbsp;</p>
        <div className="table-actions" aria-hidden="true"><button type="button" className="btn small" tabIndex={-1} disabled>🔀 Shuffle</button></div>
      </section>
    );
  }

  return (
    <section className="table-col" aria-label={`${pile.label} pile`}>
      <h2 className="table-label"><span className="pile-num" aria-hidden="true">{index + 1}</span> {pile.label}</h2>
      <div className="stack">
        {Array.from({ length: layers }, (_, k) => <div key={k} className="stack-layer" style={{ ['--k' as string]: layers - k }} aria-hidden="true" />)}
        {top && (
          <button
            key={top.id} type="button" className={`stack-top${can ? ' tappable' : ''}`} aria-disabled={!can || undefined}
            aria-label={`${pile.label}: ${label(top)}. ${pile.cards.length} card${pile.cards.length === 1 ? '' : 's'} left in this round.${can ? ' Press for the next card.' : ''}`}
            onClick={() => { if (can) void run(() => p.onDraw(pile.id, top.id)); }}
          >
            <Face card={top} deck={deck} />
          </button>
        )}
      </div>
      <p className="count" aria-hidden="true">{pile.cards.length} left</p>
      {can && (
        <div className="table-actions">
          {deck.rules.allowFlip && top && p.onFlip && (
            <button type="button" className="btn small" onClick={() => void run(() => p.onFlip!(top.id, board.version))}>{top.faceDown ? 'Reveal' : 'Flip down'}</button>
          )}
          <button type="button" className="btn small" disabled={pile.cards.length < 2} onClick={() => void run(() => p.onShuffle(pile.id))}>🔀 Shuffle</button>
          <button type="button" className="btn small" disabled={pile.discard.length === 0} onClick={() => void run(() => p.onUndo(pile.id))} title="Put the last card back on top">↶ Back</button>
        </div>
      )}
    </section>
  );
}

export function Table(props: TableProps) {
  const { board, deck, canManipulate, statusMessage, projector } = props;
  const aspect = deck.aspectRatio ?? DEFAULT_ASPECT_RATIO;
  const covered = coveredPileIds(board.piles, deck.monoCardIds);
  const spoken = board.piles.map((pl) => (covered.has(pl.id) ? 'covered' : label(pl.cards[0]))).join(', ');
  return (
    <div className={`table-surface${projector ? ' projector' : ''}`} style={{ ['--aspect' as string]: aspect }}>
      <div className="sr-only" aria-live="polite">Top cards, left to right: {spoken}</div>
      {(canManipulate || statusMessage) && (
        <p className="table-hint">
          {canManipulate ? `Tap a pile for its next card.${deck.rules.allowFlip ? ' Use Reveal / Flip down to flip a top card.' : ''}` : statusMessage}
        </p>
      )}
      {covered.size > 0 && <p className="table-hint cover-note" role="status">The middle card is a whole ending, so the Ending pile is covered.</p>}
      <div className="table-grid">
        {board.piles.map((pile, i) => <Column key={pile.id} pile={pile} index={i} isCovered={covered.has(pile.id)} {...props} />)}
      </div>
    </div>
  );
}
