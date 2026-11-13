import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BoardView } from '@shared/index';
import { createBoard, drawTop, recycleDiscard, undoDraw, type BoardState } from '../src/game/engine';
import { validateDeck } from '@shared/index';
import { call, createRoom, joinRoom, must, nextEvent, startHarness, type Harness } from './helpers';

const deck = () => {
  const r = validateDeck({
    schemaVersion: 1, id: 'd', name: 'D', version: '1',
    piles: [
      { id: 'p1', label: 'One', cards: [{ id: 'c1', text: 'b' }, { id: 'c2', text: 'c' }, { id: 'c3', text: 'd' }] },
      { id: 'p2', label: 'Two', cards: [{ id: 'c4', text: 'a' }] },
      { id: 'p3', label: 'Three', cards: [{ id: 'c5', text: 't' }, { id: 'c6', text: 'n', faceDown: true }] },
    ],
    rules: { allowFlip: true },
  });
  if (!r.ok) throw new Error(r.errors.join());
  return r.deck;
};
const ids = (b: BoardState, i: number, which: 'cards' | 'discard' = 'cards') => b.piles[i]![which].map((c) => c.id);
const everyCard = (b: BoardState) => b.piles.flatMap((p) => [...p.cards, ...p.discard].map((c) => c.id)).sort();

describe('engine: draw / undo / recycle', () => {
  it('draws the top card onto the discard and reveals the next, without losing or duplicating cards', () => {
    const b0 = createBoard(deck());
    const r1 = drawTop(b0, 'p1'); if (!r1.ok) throw new Error();
    expect(ids(r1.board, 0)).toEqual(['c2', 'c3']); expect(ids(r1.board, 0, 'discard')).toEqual(['c1']);
    const r2 = drawTop(r1.board, 'p1'); if (!r2.ok) throw new Error();
    expect(ids(r2.board, 0)).toEqual(['c3']); expect(ids(r2.board, 0, 'discard')).toEqual(['c2', 'c1']); // newest first
    expect(everyCard(r2.board)).toEqual(everyCard(b0));
    expect(r2.board.version).toBe(b0.version + 2);
    expect(ids(b0, 0)).toEqual(['c1', 'c2', 'c3']); // input untouched
  });

  it('rejects an unknown pile and a stale expectation', () => {
    const b = createBoard(deck());
    expect(drawTop(b, 'nope')).toMatchObject({ ok: false, code: 'PILE_NOT_FOUND' });
    expect(drawTop(b, 'p1', 'c2')).toMatchObject({ ok: false, code: 'STALE' });
  });

  it('a pile never runs out: after the last card it reshuffles, and never repeats the card just shown', () => {
    let b = createBoard(deck());
    const shown: string[] = [];
    for (let i = 0; i < 9; i++) { shown.push(b.piles[0]!.cards[0]!.id); const r = drawTop(b, 'p1', undefined, () => 0); if (!r.ok) throw new Error(String(i)); b = r.board; }
    expect(b.piles[0]!.cards.length + b.piles[0]!.discard.length).toBe(3);
    // every round of three shows each card once...
    for (let r = 0; r < 3; r++) expect(new Set(shown.slice(r * 3, r * 3 + 3)).size).toBe(3);
    // ...and a round never starts with the card that ended the previous one (rng stuck at 0 would otherwise do exactly that)
    expect(shown[3]).not.toBe(shown[2]); expect(shown[6]).not.toBe(shown[5]);
    expect(everyCard(b)).toEqual(everyCard(createBoard(deck())));
  });

  it('a one-card pile keeps showing its card', () => {
    const b = createBoard(deck());
    const d = drawTop(b, 'p2'); if (!d.ok) throw new Error();
    expect(ids(d.board, 1)).toEqual(['c4']); expect(ids(d.board, 1, 'discard')).toEqual([]);
  });

  it('undo puts the last drawn card back on top; nothing to undo is an error', () => {
    const b = createBoard(deck());
    expect(undoDraw(b, 'p1')).toMatchObject({ ok: false, code: 'RULE_VIOLATION' });
    const d1 = drawTop(b, 'p1'); const d2 = d1.ok ? drawTop(d1.board, 'p1') : d1; if (!d2.ok) throw new Error();
    const u = undoDraw(d2.board, 'p1'); if (!u.ok) throw new Error();
    expect(ids(u.board, 0)).toEqual(['c2', 'c3']); expect(ids(u.board, 0, 'discard')).toEqual(['c1']);
  });

  it('recycle restores the original order without shuffle, and keeps every card with shuffle', () => {
    let b = createBoard(deck());
    for (let i = 0; i < 2; i++) { const r = drawTop(b, 'p1'); if (!r.ok) throw new Error(); b = r.board; }
    expect(ids(b, 0)).toEqual(['c3']);
    const plain = recycleDiscard(b, 'p1', false); if (!plain.ok) throw new Error();
    expect(ids(plain.board, 0)).toEqual(['c3', 'c1', 'c2']); expect(ids(plain.board, 0, 'discard')).toEqual([]);
    const shuffled = recycleDiscard(b, 'p1', true, (n) => n - 1); if (!shuffled.ok) throw new Error();
    expect([...ids(shuffled.board, 0)].sort()).toEqual(['c1', 'c2', 'c3']);
    expect(recycleDiscard(plain.board, 'p1', true)).toMatchObject({ ok: false, code: 'RULE_VIOLATION' }); // nothing to recycle
  });

  it('recycling while cards remain puts the discards underneath', () => {
    const b = createBoard(deck());
    const d = drawTop(b, 'p1'); if (!d.ok) throw new Error();
    const r = recycleDiscard(d.board, 'p1', false); if (!r.ok) throw new Error();
    expect(ids(r.board, 0)).toEqual(['c2', 'c3', 'c1']);
  });
});

let h: Harness;
beforeEach(async () => { h = await startHarness(); });
afterEach(async () => { await h.stop(); });
const pile = (b: BoardView, i: number) => b.piles[i]!;

describe('draw over the wire', () => {
  it('teacher taps a pile: every screen shows the card moving to the discard and the next one appearing', async () => {
    const { host, roomCode, snapshot } = await createRoom(h);
    const a = await joinRoom(h, roomCode); const b = await joinRoom(h, roomCode);
    const top = pile(snapshot.board, 0).cards[0]!.id; const next = pile(snapshot.board, 0).cards[1]!.id;
    const seenA = nextEvent(a.student, 'board:update', (bd: BoardView) => pile(bd, 0).discard[0]?.id === top);
    const seenB = nextEvent(b.student, 'board:update', (bd: BoardView) => pile(bd, 0).discard[0]?.id === top);
    must(await call(host, 'pile:draw', { pileId: pile(snapshot.board, 0).id, expectedCardId: top }));
    const [ba] = await seenA; await seenB;
    expect(pile(ba, 0).cards[0]!.id).toBe(next);
    expect(pile(ba, 0).cards).toHaveLength(pile(snapshot.board, 0).cards.length - 1);
    // a student who joins later sees the discard too
    const late = await joinRoom(h, roomCode);
    expect(pile(late.snapshot.board, 0).discard.map((c) => c.id)).toEqual([top]);
  });

  it('a double tap draws exactly once (the second request is stale), and the loser is re-synced', async () => {
    const { host, snapshot } = await createRoom(h);
    const p = pile(snapshot.board, 1); const top = p.cards[0]!.id;
    const resync = nextEvent(host, 'room:snapshot');
    const [r1, r2] = await Promise.all([
      call(host, 'pile:draw', { pileId: p.id, expectedCardId: top }),
      call(host, 'pile:draw', { pileId: p.id, expectedCardId: top }),
    ]);
    expect([r1.ok, r2.ok].filter(Boolean)).toHaveLength(1);
    expect(r1.ok ? r2 : r1).toMatchObject({ ok: false, code: 'STALE' });
    const [fresh] = await resync;
    expect(pile(fresh.board, 1).discard).toHaveLength(1);
    expect(h.server.rooms.get(snapshot.roomCode)!.board.piles[1]!.discard).toHaveLength(1);
  });

  it('students can draw only when permitted; one-student mode honours the designated student', async () => {
    const { host, roomCode, snapshot } = await createRoom(h);
    const a = await joinRoom(h, roomCode, 'A'); const b = await joinRoom(h, roomCode, 'B');
    const p = pile(snapshot.board, 0);
    for (const ev of ['pile:draw', 'pile:undo', 'pile:recycle'] as const) {
      expect(await call(a.student, ev, { pileId: p.id }), ev).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    }
    expect(h.server.rooms.get(roomCode)!.board.version).toBe(snapshot.board.version);
    must(await call(host, 'host:set-permissions', { mode: 'one-student', activeStudentId: a.you.participantId }));
    expect(await call(b.student, 'pile:draw', { pileId: p.id })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    must(await call(a.student, 'pile:draw', { pileId: p.id }));
    must(await call(host, 'host:set-permissions', { mode: 'all-students' }));
    must(await call(b.student, 'pile:undo', { pileId: p.id }));
    expect(h.server.rooms.get(roomCode)!.board.piles[0]!.discard).toHaveLength(0);
  });

  it('validates payloads and unknown piles', async () => {
    const { host } = await createRoom(h);
    for (const [ev, payload, code] of [
      ['pile:draw', {}, 'BAD_REQUEST'], ['pile:draw', { pileId: 5 }, 'BAD_REQUEST'], ['pile:draw', { pileId: 'x', extra: 1 }, 'BAD_REQUEST'],
      ['pile:draw', { pileId: 'nope' }, 'PILE_NOT_FOUND'], ['pile:undo', { pileId: 'nope' }, 'PILE_NOT_FOUND'],
      ['pile:recycle', { pileId: 'nope', shuffle: 'yes' }, 'BAD_REQUEST'], ['pile:recycle', { pileId: 'nope' }, 'PILE_NOT_FOUND'],
    ] as const) expect(await call(host, ev, payload), `${ev} ${JSON.stringify(payload)}`).toMatchObject({ ok: false, code });
  });

  it('drawing a whole pile starts a new round automatically; reset / change deck clear the discards', async () => {
    const { host, roomCode, snapshot } = await createRoom(h);
    const p = pile(snapshot.board, 2); const n = p.cards.length;
    const room = h.server.rooms.get(roomCode)!;
    for (let i = 0; i < n; i++) must(await call(host, 'pile:draw', { pileId: p.id }));
    expect(room.board.piles[2]!.cards.map((c) => c.id).sort()).toEqual(p.cards.map((c) => c.id).sort()); // everything is back
    expect(room.board.piles[2]!.discard).toEqual([]);
    must(await call(host, 'pile:draw', { pileId: p.id })); // and the drill just keeps going
    must(await call(host, 'pile:draw', { pileId: p.id })); must(await call(host, 'pile:draw', { pileId: pile(snapshot.board, 0).id }));
    must(await call(host, 'board:reset'));
    expect(room.board.piles.map((x) => x.discard.length)).toEqual([0, 0, 0]);
    expect(room.board.piles[2]!.cards.map((c) => c.id)).toEqual(p.cards.map((c) => c.id)); // back to the starting order
    must(await call(host, 'pile:draw', { pileId: p.id }));
    must(await call(host, 'host:load-deck', { deckId: 'sample-phonograms' }));
    expect(room.board.piles.every((x) => x.discard.length === 0)).toBe(true);
  });

  it('hides the text of face-down discards from students', async () => {
    const { host, roomCode, snapshot } = await createRoom(h, 'sample-mystery-flip');
    const s = await joinRoom(h, roomCode);
    const mid = pile(snapshot.board, 1);
    const seen = nextEvent(s.student, 'board:update', (bd: BoardView) => pile(bd, 1).discard.length === 1);
    must(await call(host, 'pile:draw', { pileId: mid.id }));
    const [bd] = await seen;
    expect(pile(bd, 1).discard[0]).toMatchObject({ faceDown: true, text: null }); // the mystery deck's middle cards start face-down
  });
});

describe('monosyllabic finals cover the Ending pile', () => {
  const monoDeck = {
    schemaVersion: 1, id: 'mono', name: 'Mono', version: '1',
    piles: [
      { id: 'i', label: 'Beginning', cards: [{ id: 'i1', text: 'b' }, { id: 'i2', text: 'd' }] },
      { id: 'm', label: 'Middle', cards: [{ id: 'm-ink', text: 'ink', category: 'T', mono: true }, { id: 'm-a', text: 'a', category: 'V' }, { id: 'm-ow', text: 'ow', category: 'P', mono: true }] },
      { id: 'f', label: 'Ending', cards: [{ id: 'f1', text: 't' }, { id: 'f2', text: 'p' }] },
    ],
    rules: { allowFlip: true },
  };

  it('refuses draw and undo on the covered pile, and works again once the middle card changes', async () => {
    const host = await h.connect();
    const created = must<import('@shared/index').CreateRoomResult>(await call(host, 'room:create', { deck: monoDeck }));
    expect(created.snapshot.deck.monoCardIds).toEqual(['m-ink', 'm-ow']);
    const room = h.server.rooms.get(created.roomCode)!;
    expect(room.isPileCovered('f')).toBe(true);                                   // 'ink' is face-up on top of the middle pile
    expect(await call(host, 'pile:draw', { pileId: 'f' })).toMatchObject({ ok: false, code: 'RULE_VIOLATION' });
    expect(await call(host, 'pile:undo', { pileId: 'f' })).toMatchObject({ ok: false, code: 'RULE_VIOLATION' });
    expect(room.board.piles[2]!.cards.map((c) => c.id)).toEqual(['f1', 'f2']);     // untouched
    must(await call(host, 'pile:draw', { pileId: 'i' }));                           // other piles are fine
    must(await call(host, 'pile:draw', { pileId: 'm', expectedCardId: 'm-ink' }));  // 'a' is now on top
    expect(room.isPileCovered('f')).toBe(false);
    must(await call(host, 'pile:draw', { pileId: 'f' }));
    expect(room.board.piles[2]!.cards.map((c) => c.id)).toEqual(['f2']);            // the covered pile's own cards were preserved
    must(await call(host, 'pile:draw', { pileId: 'm' }));                           // 'ow' comes up: covered again
    expect(room.isPileCovered('f')).toBe(true);
  });

  it('a face-down mono card does not cover (that would reveal it), and flipping it up does', async () => {
    const host = await h.connect();
    const created = must<import('@shared/index').CreateRoomResult>(await call(host, 'room:create', { deck: { ...monoDeck, piles: monoDeck.piles.map((p, i) => (i === 1 ? { ...p, cards: p.cards.map((c) => (c.id === 'm-ink' ? { ...c, faceDown: true } : c)) } : p)) } }));
    const room = h.server.rooms.get(created.roomCode)!;
    expect(room.isPileCovered('f')).toBe(false);
    must(await call(host, 'pile:draw', { pileId: 'f' }));
    must(await call(host, 'board:flip', { cardId: 'm-ink' }));
    expect(room.isPileCovered('f')).toBe(true);
  });

  it('students are held to the same rule', async () => {
    const host = await h.connect();
    const created = must<import('@shared/index').CreateRoomResult>(await call(host, 'room:create', { deck: monoDeck }));
    const s = await h.connect();
    must(await call(s, 'room:join', { roomCode: created.roomCode }));
    must(await call(host, 'host:set-permissions', { mode: 'all-students' }));
    expect(await call(s, 'pile:draw', { pileId: 'f' })).toMatchObject({ ok: false, code: 'RULE_VIOLATION' });
  });

  it('a mono card outside the middle pile is rejected when the deck is created', async () => {
    const host = await h.connect();
    const bad = { ...monoDeck, piles: monoDeck.piles.map((p, i) => (i === 2 ? { ...p, cards: [{ id: 'f1', text: 'ink', mono: true }, ...p.cards.slice(1)] } : p)) };
    expect(await call(host, 'room:create', { deck: bad })).toMatchObject({ ok: false, code: 'INVALID_DECK' });
  });
});
