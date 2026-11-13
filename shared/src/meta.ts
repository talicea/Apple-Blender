import { isStyledDeck, type Deck } from './deck';
import { SKILLS_ASPECT_RATIO, SKILLS_CARD_STYLE, mergeStyles, skillCardStyle } from './skills';
import type { DeckMeta } from './types';

/**
 * What clients need to know about a deck to draw its cards. Used by the server (room snapshots) and by previews.
 * Decks with skill cards (a `category`) get the generator's look: category colour, count and lesson corners,
 * Playwrite font, 4×6 card shape. Anything the deck states itself (cardStyle / card style) wins.
 */
export function buildDeckMeta(deck: Deck): DeckMeta {
  const { id, name, description, version, rules } = deck;
  const skills = deck.piles.some((p) => p.cards.some((c) => c.category));
  const cardStyle = skills ? mergeStyles(SKILLS_CARD_STYLE, deck.cardStyle) : deck.cardStyle;
  const aspectRatio = deck.cardAspectRatio ?? (skills ? SKILLS_ASPECT_RATIO : undefined);
  const cardStyles: DeckMeta['cardStyles'] = {};
  const monoCardIds: string[] = [];
  for (const pile of deck.piles) {
    for (const c of pile.cards) {
      if (c.mono) monoCardIds.push(c.id);
      const s = mergeStyles(c.category || c.count || c.lesson !== undefined ? skillCardStyle(c) : undefined, c.style);
      if (s && Object.keys(s).length) cardStyles[c.id] = s;
    }
  }
  return {
    id, name, description, version, rules, styled: isStyledDeck(deck), cardStyles, monoCardIds,
    ...(aspectRatio !== undefined ? { aspectRatio } : {}),
    ...(cardStyle ? { cardStyle } : {}),
  };
}
