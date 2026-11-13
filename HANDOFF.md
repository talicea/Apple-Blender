# Phonics Piles — complete project handoff

*Written 2026-11 for the next engineer/agent (Grok). Read this top to bottom once, then `PROGRESS.md` (running log) and `README.md` (user-facing).
Everything below was checked against the code and the test runs at hand-off time; anything not verified is listed in §16.*

---

## 1. What this is

A **real-time classroom phonics card game** for one teacher and a class of students on their own devices.
The teacher creates a room; students join with a **5-character code**. Three piles of cards — **beginning / middle / ending sounds** —
sit face-up on an eggshell "table", touching each other. The three top cards read as one (usually nonsense) word for **blending drills**.
Tap a pile → the next card appears on every screen. No accounts, no database; one in-memory Node process serves the React app and Socket.IO.

Built for an **Orton-Gillingham-style** curriculum: cards are colour-coded by skill category (vowel, consonant, digraph, vowel pair, blend, trigraph, diphthong),
printed on 4×6 in cards with a bundled cursive font (**Playwrite CO**), and the teacher's own card sheets/lists are imported or built in the app.

Feature areas (all implemented and tested unless §16 says otherwise):

| Area | Summary |
|---|---|
| Rooms | create/join/resume/end, host token, reconnect, expiry, server-restart notice |
| Permissions | teacher-only / all students / one student at a time; enforced on the server |
| **Table (blending)** | eggshell table, 3 adjacent face-up piles, tap = next card, each card once per round then auto-reshuffle, ↶ Back, per-pile Shuffle, optional Flip, projector mode |
| Arrange view | classic drag-and-drop board (mouse/touch/keyboard) to re-order or move cards |
| Skill cards | category colour code, sound count, lesson, **position (I/M/F) = pile** |
| **Deck builder** | table of rows (text · category · sounds · lesson · position), generator `.txt` import/export, preview, save/edit, JSON download, **print 4×6 cards** |
| Deck import | JSON upload, HTML card-sheet importer (printable sheets from the Python generator), saved in the teacher's browser |
| **Tracing practice** | teacher marks cards a student hasn't mastered; student traces; teacher watches live; save/load practice JSON |
| Python generator | `tools/flashcards/` (the teacher's original scripts) sharing the same list format and colour code |

---

## 2. The teacher, and constraints that shape every decision

- The product owner is a **teacher, not a developer**. Keep UX simple, large touch targets, readable from a projector, minimal text.
- Their own computer is an **old MacBook Air on macOS 10.13.6 (High Sierra)** — it **cannot run Node**, and its browsers may be old (see §16, risk #1).
  Therefore **everything the teacher needs must work from the deployed website**; never require a local build step for her.
- She deploys by **uploading the repo contents to GitHub in the browser; Render redeploys** (`render.yaml`, single web service). Don't introduce steps that need a CLI on her side.
  The zip excludes `node_modules`, `dist`, screenshots.
- She also uses the **Python flashcard generator** (`tools/flashcards`) elsewhere; the app must stay compatible with its list format.
- **Children's privacy matters**: no accounts/emails, no external fonts/scripts/CDNs (no Google Fonts), minimal data. Student names are display names only.
- **She decides scope.** Ask before adding big features. Work in small chunks.

Her explicit requests so far (chronological): real-time classroom card game → sandbox/table look (eggshell, three piles, tap to draw) →
no discard piles + piles adjacent for blending → text colour = generator's category code → decks carry the same variables as the generator **plus position (I/M/F)** →
merge the Python generator and the game → a **deck builder** that mirrors the generator → convert her 23 lesson files into one importable deck.

---

## 3. Tech stack (exact versions in `package.json`)

React 19 · Vite 8 · TypeScript 7 (native compiler; **no `baseUrl`**) · Node ≥ 20 (developed on 22) · Express 5 · Socket.IO 4.8 · Zod 4 · Helmet 8 ·
Vitest 5 · Playwright (`playwright-core` 1.56, Chromium only) · esbuild (server bundle) · tsx · linkedom (importer tests/CLI) · Python 3 for `tools/flashcards`.

Path alias `@shared/*` → `shared/src/*` is defined **once** in `tsconfig.base.json` (paths are relative to that file) and mirrored in `vite.config.ts`/`vitest.config.ts`.
Strict TS incl. `noUncheckedIndexedAccess` (this bites: index access returns `T | undefined`).

## 4. Repository layout

```
client/                    React app (Vite root)
  index.html, vite.config.ts, tsconfig.json
  public/fonts/            PlaywriteCO.ttf (SIL OFL) + OFL-NOTICE.txt  — the only font file; do not add external fonts
  public/sample-deck.json  downloadable example deck
  src/
    main.tsx, App.tsx      screen state machine (home / setup / builder / active room / ended / resuming) + toasts
    api.ts                 fetch built-in decks; localStorage store for the teacher's own decks (max 40)
    hooks/useRoom.ts       ONE socket per tab, reducer state, auto re-auth on reconnect, `actions` (all emits)
    components/
      Home.tsx             join form + "Create a game" + "Deck builder"
      TeacherView.tsx      code banner, collapsible controls, Table/Arrange/Projector toggles, tracing-practice panel, live traces
      StudentView.tsx      status banner, Table (or Arrange if permitted), practice list + tracing canvas
      Table.tsx            THE TABLE (see §9.3)
      Board.tsx            classic drag board ("Arrange cards"): pointer-event drag, touch long-press, keyboard, locks
      CardFace.tsx         draws a card face: plain tile OR designed SVG (font/colour/outline/border/corners/writing lines)
      DeckPicker.tsx       built-in + saved decks, JSON/HTML/TXT-free upload, preview with real faces, Edit/Download/Remove
      DeckBuilder.tsx      the deck builder screen (§8.4)
      PrintCards.tsx       4×6 in print layout via portal + window.print()
      ImportDialog.tsx     review step for the HTML card-sheet importer (colour → pile mapping)
      TracingCanvas.tsx, LiveTraceMirror.tsx   tracing practice (§10)
      common.tsx           ConnectionBadge, Toasts, Modal(<dialog>), ConfirmDialog, CopyButton, ViewToggle
    import/htmlCards.ts    HTML card-sheet parser + deck builder (DOM-agnostic; browser DOMParser or linkedom)
    practiceFile.ts        build/download/parse `phonics-practice` JSON
    styles.css             all styling (eggshell tokens at top; table, builder, print, tracing at bottom)
  tests/                   htmlCards.test.ts, practiceFile.test.ts, fixtures/skills_{1,5,8}.html
server/src/
  index.ts                 entry; SIGTERM → tells clients "server restarted"
  config.ts                env parsing (see §13)
  gameServer.ts            Express (health, /api/decks, static, SPA fallback, Helmet CSP) + ALL Socket.IO handlers
  rooms/room.ts            AUTHORITATIVE STATE per room: board, permissions, locks, participants, practice lists
  rooms/roomManager.ts     codes, capacity, expiry sweep
  game/engine.ts           pure board ops: move, flip, shuffle, draw/undo/recycle, toBoardView (redacts face-down for students)
  deckLibrary.ts           loads/validates decks/*.json at startup (fails loudly if invalid)
  util/ids.ts, rateLimit.ts
server/tests/              multiplayer (30), engine-room (19), draw (13), practice (18), styled-deck (1), helpers
shared/src/                imported by BOTH sides (single source of truth)
  deck.ts                  Zod deck schema + limits + parse/validate (+ error formatting)
  style.ts                 card formatting schema, fonts list, geometry constants, resolveCardStyle
  skills.ts                skill-card model: categories/colours, positions, generator text format, rows⇄deck, SKILLS_CARD_STYLE
  meta.ts                  buildDeckMeta(deck): what clients need to draw a deck (derives per-card styles from skill fields)
  events.ts                socket event contract + Zod payload schemas
  types.ts                 wire types (RoomSnapshot, BoardView, PracticeState, ErrorCode…)
shared/tests/              deck (16), style (5), skills (12)
decks/*.json               4 built-in sample decks (loaded at server start)
tools/flashcards/          the teacher's Python generator (card_common.py, make_skills.py) + README
scripts/                   generate-json-schema.ts (→ docs/deck.schema.json), import-html-cards.ts (CLI importer), tsconfig.json
e2e/                       table.mjs, builder.mjs, practice.mjs, classic-board.mjs (Playwright, real browsers)
docs/DECK_SCHEMA.md, docs/deck.schema.json
examples/                  the teacher's REAL curriculum deck + list (see §12)
render.yaml, .env.example, README.md, PROGRESS.md, HANDOFF.md (this), HANDOFF_PROMPT.md
```

## 5. Commands

```bash
npm install
npm run dev            # server :3001 + Vite :5173 (proxies /api, /socket.io, /healthz). Open http://localhost:5173
npm run typecheck      # server + client + scripts. ALWAYS run: `vite build` does NOT typecheck
npm test               # 140 tests (Vitest)
npm run build          # client -> dist/client, server bundle -> dist/server/index.js
npm start              # production: one process serves client + sockets (needs a prior build)
npm run e2e            # table → builder → practice → classic-board suites; run `npm run build` first
npm run e2e:table | e2e:builder | e2e:practice | e2e:classic
npm run schema:json    # regenerate docs/deck.schema.json
npm run import:html -- <outDir> a.html b.html …   # CLI version of the HTML importer
```
E2E needs a Chromium for `playwright-core` (`npx playwright install chromium`, or set `PLAYWRIGHT_BROWSERS_PATH`; if the installed build differs from the pinned library's, set `CHROMIUM_PATH=/path/to/chrome`). Suites start their own server on ports 3100–3103 (`E2E_PORT` to change).
Screenshots go to `e2e/screenshots/` (git-ignored).

**Definition of done for any change:** `npm run typecheck && npm test && npm run build && npm run e2e` all green, plus new tests for new behaviour.

## 6. Architecture & invariants (do not break)

1. **Server-authoritative.** Clients send *requests* (acked). The server validates identity, room membership, permission, payload (Zod), and game rules; mutates `Room`; then broadcasts. UIs change when the broadcast arrives (a couple of controls show a pending state for responsiveness).
2. **Identity is server-side.** After `room:create` / `room:join` / `host:resume`, the socket's `{roomCode, role, participantId}` live in `socket.data`. Nothing in later payloads is trusted (unknown payload keys are rejected: schemas are `.strict()`).
3. **Secrets.** Room code (5 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, `crypto.randomInt`, unique among live rooms) ≠ host token (256-bit random, shown once, stored only as SHA-256, compared with `timingSafeEqual`, never broadcast or logged).
   Students get a participant token to reclaim their seat. Browser storage: host token `localStorage['phonics.host.v1']`; student token `sessionStorage['phonics.student.v1']`; saved decks `localStorage['phonics.customDecks.v1']`.
4. **Room isolation.** Each room has two Socket.IO channels (`r:CODE:host`, `r:CODE:students`); every emit targets one room. Tests prove nothing leaks across rooms.
5. **Per-viewer snapshots.** `room.snapshot(forHost, participantId)` — students receive only their own practice list, face-down card text is redacted (`toBoardView(board, forHost)`). **Never build a student snapshot without their id** (this bug wiped practice lists once; see §15).
6. **Conflict rules** (`room.ts` header): per-card **locks** (taken when a drag starts, 8 s TTL, refreshed every 4 s while dragging, released on drop/disconnect); another student gets `CARD_LOCKED`; **teacher always wins** (clears the lock);
   each card remembers the board version it last changed at → a move with an older `baseVersion` is `STALE` and the sender is re-synced with a snapshot. Draws use `expectedCardId` so a **double tap draws once**.
7. **Permissions.** `canManipulate`: host always; students per mode. Students who may move cards can: move, flip, shuffle, draw, undo, recycle, lock/unlock.
   **Teacher-only:** reset, load deck, set permissions, end room, practice:import, practice:allow-self.
8. **Lifecycle.** Rooms expire 30 min after the last connection leaves (`ROOM_IDLE_TTL_MS`) or after 12 h (`ROOM_MAX_AGE_MS`); disconnected students keep their seat 5 min (`PARTICIPANT_GRACE_MS`) and their practice list is deleted with them;
   sweeps every 15 s; SIGTERM emits `room:ended {reason:'server-restart'}`; after a hard crash clients reconnect, fail re-auth, and show "no longer available". Capacity 500 rooms / 100 students.
9. **Rate limits.** Per-socket token bucket for actions (burst 30, 15/s); **separate** bucket for `practice:points` (burst 20, 12/s, hard-coded) so tracing can't starve taps; per-IP creation 10/min and join/resume 30/min (also throttles code guessing). `TRUST_PROXY=true` behind Render so IPs come from `X-Forwarded-For`.
10. **Decks and card data are untrusted data.** Strict Zod validation on client *and* server; colours must be hex; fonts come from a fixed list; text rendered as text (React escapes); no HTML ever injected; uploads size-capped (`MAX_DECK_BYTES`, 100 KB default).
11. **No external network assets.** Helmet CSP is on; Playwrite CO is served from `/fonts/`. Don't add CDNs/Google Fonts (privacy + offline classrooms).
12. **One socket per tab;** on every (re)connect the client re-authenticates (host token / participant token) and replaces its state with a fresh snapshot (`useRoom.authenticate`). Actions are never queued while offline.

## 7. Socket contract (`shared/src/events.ts`; all client→server events take an ack `{ok:true,…}|{ok:false,code,message,details?}`)

Error codes: `BAD_REQUEST RATE_LIMITED ROOM_NOT_FOUND ROOM_FULL SERVER_BUSY UNAUTHORIZED FORBIDDEN NOT_IN_ROOM INVALID_DECK DECK_NOT_FOUND CARD_NOT_FOUND PILE_NOT_FOUND PARTICIPANT_NOT_FOUND CARD_LOCKED STALE RULE_VIOLATION INTERNAL`.

| Event (client → server) | Payload | Who | Notes |
|---|---|---|---|
| `room:create` | `{deckId}` xor `{deck}` | anyone | returns `{roomCode, hostToken, you, snapshot}` |
| `room:join` | `{roomCode, displayName?, participantToken?}` | anyone | token = reclaim seat; invalid token falls back to a fresh seat |
| `host:resume` | `{roomCode, hostToken}` | teacher | after refresh/reconnect |
| `host:end` | `{}` | host | notifies everyone, deletes room |
| `host:set-permissions` | `{mode, activeStudentId?}` | host | modes `teacher-only|all-students|one-student` |
| `host:load-deck` | `{deckId}` xor `{deck}` | host | replaces board; broadcasts per-viewer snapshots |
| `board:reset` | `{}` | host | back to initial arrangement, discards cleared |
| `card:lock` / `card:unlock` | `{cardId}` | manipulators | drag locks |
| `board:move` | `{cardId,toPileId,toIndex,baseVersion?}` | manipulators | index is *after* removal; clamped |
| `board:flip` | `{cardId,baseVersion?}` | manipulators | only if `deck.rules.allowFlip` |
| `board:shuffle` | `{scope:'all'}` \| `{scope:'pile',pileId}` | manipulators | shuffles the draw pile(s) |
| `pile:draw` | `{pileId, expectedCardId?}` | manipulators | top → discard; **auto-reshuffle when the round completes** (never starts with the card just shown); `STALE` if top changed |
| `pile:undo` | `{pileId}` | manipulators | last drawn card back on top (`RULE_VIOLATION` if none) |
| `pile:recycle` | `{pileId, shuffle?}` | manipulators | discards back under the pile. **Server only — the UI no longer uses it** |
| `practice:start` | `{text, cat?, count?, lesson?}` | student | text must be a real deck card or on the student's list |
| `practice:points` | `{points:number[]}` (0–1, x,y pairs, ≤80 numbers) | student | relayed to host only |
| `practice:end` | `{}` | student | |
| `practice:mark` / `practice:unmark` | `{participantId, card}` / `{participantId, cardId}` | host; student for self if allowed | card text comes from the **deck**; students can't mark face-down cards |
| `practice:allow-self` | `{enabled}` | host | |
| `practice:import` | `{participantId, cards[≤40]}` | host | replaces a student's list |

Server → client: `room:snapshot` (full, per viewer) · `board:update` (BoardView with `version`) · `board:locks` · `room:permissions` · `room:presence` (count, hostConnected, host also gets participant list) ·
`room:ended {reason: host-ended|expired|server-restart}` · `session:replaced` · `practice:update` (host: all lists; student: only own) · `practice:student-start|student-points|student-end` (**host only**; also sent on student disconnect).

HTTP: `GET /healthz`, `GET /api/config`, `GET /api/decks`, `GET /api/decks/:id`, static client + SPA fallback.

## 8. Data model

### 8.1 Deck (`shared/src/deck.ts`, `docs/DECK_SCHEMA.md`)
`schemaVersion:1`, `id`, `name`, `description`, `version`, **exactly 3 piles** `{id,label,cards[1..60]}` (≤150 cards total), `rules {allowCrossPileMoves, allowReorder, allowFlip, initialShuffle}`, optional `tags`, `cardStyle`, `cardAspectRatio`.
Card: `{id (unique across the whole deck), text (1–16 chars, kept exactly), faceDown?, tags?, category?, count?, lesson?, style?}`. Unknown keys are rejected everywhere.

### 8.2 Skill cards (`shared/src/skills.ts`) — the heart of the merge with the generator
- **category** → text colour. **Must equal `CATEGORY_COLORS` in `tools/flashcards/card_common.py`** (a test reads the Python file and fails on drift):
  `V #990000 simple vowel · C #000000 consonant · DG #0b1a6b digraph · P #c21f1f vowel pair · B #2f5fd9 blend · T #4b1a7a trigraph · DP #ff4f9a diphthong`; lesson-number grey `#555555`.
- **count** (≤6 chars): the number of sounds the letter(s) make (e.g. `2` on vowels); printed top-left in the category colour. **lesson** 1–99: printed bottom-right in grey.
- **position `I`/`M`/`F` = pile 1/2/3** (initial/medial/final). A card in two positions is **two cards in two piles** (distinct ids: `beginning-t`, `ending-t`). `DEFAULT_POSITIONS` per category is used only when a line has no position.
- **Generator text format** (one card per line): `text, category, sounds, position, lesson` — sounds/position/lesson optional; `#` comments; lesson falls back to the file name (`skills_03.txt` → 3). The Python scripts ignore the position column and honour the lesson column.
- **Mono (monosyllabic final)** — position word `Mono` in the text format (`ink, T, , Mono, 10`); card field `mono: true`, allowed only in the middle pile (schema rule). `coveredPileIds(piles, monoIds)` in `shared/src/skills.ts` is the single rule: a **face-up** mono card on top of the middle pile covers the Ending pile. The server uses it to refuse `pile:draw`/`pile:undo` on a covered pile (`RULE_VIOLATION`); `Table.tsx` draws a blank card (`.covered-col`) and hides its controls; the teacher's "Mark top cards" skips a covered pile; `DeckMeta.monoCardIds` carries the ids. The covered pile's own cards are untouched. A face-down mono card never covers (that would leak it). The builder's **Mono** button is exclusive with I/M/F.
- `buildSkillDeck(rows, meta)` / `deckToRows(deck)` convert rows⇄deck (cards that share text/category/count/lesson across piles merge back into one row with positions like `IF`). Builder decks use `allowCrossPileMoves:false` (position *is* the pile) and `initialShuffle:true`.
- `buildDeckMeta(deck)` (`meta.ts`) — used by the **server snapshot and client previews** — gives any deck with a `category` the generator look (`SKILLS_CARD_STYLE`: Playwrite CO, outline, 4×6 shape, border) and derives each card's style (colour + corner marks); anything the deck states itself wins.

### 8.3 Card formatting (`shared/src/style.ts`)
`cardStyle` (deck) / `style` (card): `fontId (default|serif|playwrite-co)`, `fontWeight`, `fontSize`, `glyphY`, `textColor`, `outlineColor`, `outlineWidth`, `writingLines`, `background`, `borderColor`, `borderWidth`, `cornerRadius`, `corners{topLeft,topRight,bottomLeft,bottomRight:{text,color?,fontId?,size?}}`.
All sizes are **fractions** of the card (so it looks identical at any size). Geometry constants (`CARD_GEOMETRY`) were measured from the teacher's original cards (896×1345 units, 4 writing lines at 110/425/721/1037). `CardFace.tsx` reproduces her printed cards to ≈2/255 mean pixel difference.

### 8.4 Deck builder (`DeckBuilder.tsx`)
Rows = cards (text, category select, sounds, lesson, I/M/F toggles). Live validation (`buildSkillDeck` → `validateDeck`) with a preview in real colours. Paste/load generator lists (blank placeholder rows make way). Actions: Save to my decks (localStorage; App then opens the picker with it selected),
Download deck `.json`, Download card list `.txt` (`skills_NN.txt` if one lesson), **Print cards (4×6 in)** with optional writing lines (`PrintCards`: off-screen render, waits for font + text-fit (`svg[data-fit]`), then `window.print()`; `@media print` shows only `.print-root`, `@page 4in 6in`).
Editing a saved deck uses `deckToRows` (rows come back **ordered by pile**, not typing order).

### 8.5 HTML card-sheet importer (`client/src/import/htmlCards.ts`)
Parses printable sheets (`section.card > svg`) in the browser (inert `DOMParser`; scripts never run), captures text, colour, outline, font→bundled id, weight, size, baseline, border, corner marks, shape and lesson; warns about anything dropped (e.g. writing-line rects).
`ImportDialog` lets the teacher map colour groups to piles, name piles, and choose cumulative decks. **Known weakness — see §16.**

## 9. Client behaviour

### 9.1 Screens (`App.tsx`)
`phase`: idle → Home (join form / Create a game / Deck builder) · setup (DeckPicker) · builder · resuming (reconnecting with saved token) · active (TeacherView/StudentView) · ended (reason screen).
URL params: `?join=CODE` (prefill), `?view=arrange` (open classic board first; used by the classic e2e), `?view=trace&text=ea&cat=P&lesson=3` (single-player tracing demo).

### 9.2 Connection (`useRoom.ts`)
Reducer state `{conn, phase, session, snapshot, ended}`; updates from events; `request()` with 8 s ack timeout and **immediate failure when offline**; auto re-auth on every `connect`; failure → "no longer available".
`actions`: lock, unlock, move, flip, shufflePile, shuffleAll, draw, undo, recycle, reset, setPermissions, loadDeck, practice*.

### 9.3 The Table (`Table.tsx`)
`section.table-col` ×3 in a CSS grid with `--sw = min((100% − 2·gap)/3, 50vh·aspect, 340px)` and a 2–6 px gap so piles **touch**. Each column: label (`1 Beginning sound`), `.stack` (up to 3 depth layers + `button.stack-top` for the top card), `n left`, and for manipulators: Flip/Reveal (if `rules.allowFlip`), Shuffle, ↶ Back.
Tap = `onDraw(pileId, top.id)`; one in-flight request per pile; `STALE` is swallowed silently (the sender is re-synced). Non-manipulators see the table with inert taps. Projector mode enlarges everything. `aria-live` announces top cards.
Plain (unformatted) decks render script letters sized with container-query units (`cqw`) — **not percentages in `font-size`** (that bug happened).

### 9.4 CardFace / Board / drag
`CardFace`: face-down → `?`; plain deck → text; styled deck → SVG (`StyledFace`) with measured fit-to-width (waits for the font) and optional writing lines.
`Board.tsx` (Arrange): window-level pointer listeners (registered once, read refs), mouse drag after 5 px, **touch long-press 160 ms** then drag (non-passive `touchmove` blocks scrolling only while holding), auto-scroll near edges, drop index by reading order, toolbar buttons (Make top, Earlier, Later, → pile, Flip), keyboard (arrows, Enter/Space, Shift+arrows), roving tabindex.

## 10. Tracing practice

Teacher: *Tracing practice lists* panel → pick student → **Mark "x"** for each current top card (`practice:mark`); optional *Allow students to mark cards themselves*; **Save JSON** per student (`practice-<name>.json`, `kind:"phonics-practice"`, `schemaVersion:1`, `studentName`, `cards[]`, ≤40 cards) and **Load practice JSON** onto the selected student (`practice:import`, replaces their list).
Student: *Your practice list* chips → `TracingCanvas` (card with writing lines, cursive letter, pointer tracing; stroke green inside the letter / muted outside; shows `% covered` and `% inside`; **success at ≥ 80 % coverage and ≥ 55 % inside**; optional vibration — Android mostly; Clear). Streams normalised points (batched, ≤10 requests/s) → teacher's `LiveTraceMirror` thumbnail ("Ada is tracing b"). A student's disconnect clears the thumbnail.
Rules learned: marked/traced card text always comes from the **deck**; callbacks passed into `TracingCanvas` must not retrigger its setup effect (it rebuilds the mask and **wipes the child's drawing**) — it keeps `onStreamEnd` in a ref.
Privacy: lists live in server memory for the room's life; files are saved only on the device that pressed Save.

## 11. Tests (what exists, and how to extend)

**140 unit/integration tests** (`npm test`): shared deck validation (16) · formatting schema incl. CSS-injection attempts (5) · skill model & **Python-colour sync** (12) · engine/room with a fake clock (19) · multiplayer over real Socket.IO sockets (30: codes, join, sync, isolation, permissions, malformed payloads, reconnect, end, conflicts, rate limits, expiry, shutdown) ·
draw/undo/recycle & double-tap race (13) · styled deck over the wire (1) · practice (18: visibility, marking rules, import validation, snapshot regressions, mirror relay, abuse limits) · HTML importer on the teacher's real sheets (12) · practice files (4).
Helpers in `server/tests/helpers.ts` (`startHarness`, `call`, `nextEvent`, `createRoom`, `joinRoom`). Use the injectable clock (`GameServerOptions.now`) and `server.sweep()` for time-based behaviour.

**4 browser suites** (real Chromium, desktop teacher + phone-sized student; 25 + 24 + 13 + 43 checks): table (draw sync, double tap, permissions, Back, full-round cycle, plain deck, Arrange) · builder (txt load, colour code, validation, downloads, print layout, save/play/edit) ·
practice (mark, live mirror, drawing survives board updates, deck change keeps lists, save/load, disconnect cleanup) · classic board (create/join, mouse + touch drag, swipe-vs-drag, reconnect, host resume, uploads, importer, graceful restart + crash, end).
E2E tips: use `getByRole`/`getByTestId`, beware strict-mode (several matching nodes), nested `<dialog>`s match twice, stub `window.print` (don't fire `afterprint` until you've inspected `.print-card`), glyph vs corner text: `svg g > text`.

## 12. The teacher's real curriculum data (`examples/`)

Source: `Archive.zip` with `skills_NN.txt` (+ `.html` sheets) for **lessons 1–8, 10–12, 14–18, 21, 23, 24, 26–28, 30** (23 lessons). **Missing entirely: 9, 13, 19, 20, 22, 25, 29.** Lesson 18 has a `.txt` but no `.html`. The html/txt pairs agree on all 22 lessons that have both (text, colour→category, sounds, lesson). Source `.txt` had no position column.
Output (also produced as downloads for the teacher): `examples/skills-all-lessons.json` (91 cards; piles 54/13/43; ids `b-…/m-…/e-…`), `examples/skills_all_with_positions.txt` (editable source of truth), plus a zip of 23 cumulative decks (lessons 1…N).
**Positions were assigned by me from phonics logic (the teacher has not signed off) — except Mono, which is hers:** lesson 10 `ink ank onk unk ing ang ong ung` and lesson 30 `oe ow` (hyphens dropped) are **Mono** (Medial pile, cover the Ending pile). Resulting deck: Beginning 54 / Middle 23 (10 Mono) / Ending 33.


| Position | Cards |
|---|---|
| I only | c r h j v w k y z qu wh · initial blends sc sk sm sn sp st sw tw bl cl fl gl pl sl br cr dr fr gr pr tr sr str spr spl scr shr thr · squ · wr |
| F only | x ck ff ll ss zz · ay ey · any card written with a leading hyphen (`-st -sk -sp -nt -mp -nd`; hyphen kept in the text) |
| **Mono** (Medial pile, covers Ending) | ink ank onk unk ing ang ong ung · oe ow |
| I + F | t s m b f n p l d g ch sh th |
| M only | a e i o u ai oa |
| M + F | ar or ear ee ie ea |

Everything else (counts like `2` on vowels/`th`, categories) comes straight from her files. The `.txt` is the place to adjust positions.

## 13. Configuration & deployment

Env (all optional; `.env.example`): `PORT 3001`, `HOST`, `NODE_ENV`, `TRUST_PROXY`, `CORS_ORIGINS` (only for a split deploy), `MAX_DECK_BYTES 102400`, `MAX_ROOMS 500`, `MAX_PARTICIPANTS_PER_ROOM 100`, `ROOM_CODE_LENGTH 5`, `ROOM_IDLE_TTL_MS`, `ROOM_MAX_AGE_MS`, `PARTICIPANT_GRACE_MS`, `LOCK_TTL_MS 8000`, `SWEEP_INTERVAL_MS 15000`, `ACTION_BURST 30`, `ACTION_REFILL_PER_SEC 15`, `CREATE_PER_MINUTE 10`, `JOIN_PER_MINUTE 30`, `DECKS_DIR`, `CLIENT_DIST_DIR`.
Render (`render.yaml`): build `npm ci --include=dev && npm run build`, start `npm start`, health `/healthz`, `NODE_VERSION=22`, `NODE_ENV=production`, `TRUST_PROXY=true`. **One instance only** (in-memory state). Free tier sleeps when idle. Built-in decks are every `decks/*.json` (validated at startup; a bad file stops the server).

## 14. History & the decisions behind it (so you don't undo them)

- **Server-authoritative, in-memory, no DB** — simplest thing that is safe for a classroom; sessions end on restart by design (clients are told).
- **Eggshell palette** adopted from an earlier external restyle (`--bg #f5f0e6`), but its **Google-hosted Caveat font was rejected**: it only approximated the cards, leaks children's IPs to Google, and breaks offline. The exact font (Playwrite CO) is bundled instead.
- **Discard piles were built, then removed** at the teacher's request (they confused students in blending drills). Internally a "discard" still exists as "cards already shown this round" so each card appears once per round before the pile reshuffles itself.
- **Piles are adjacent** on purpose (word reads across).
- **Position = pile**, so builder decks forbid cross-pile moves; consonants live in two piles (I and F) as separate cards.
- **Colour = category code** shared with the Python generator (single source of truth guarded by a test).
- **The HTML importer predates the skill-card model** and is kept for sheets made elsewhere; the txt/builder path is now primary.
- The earlier "tap a pile → discard + undo + recycle" UI had e2e coverage; those assertions were rewritten for the new behaviour (not weakened).

## 15. Pitfalls (each cost real time)

1. **`vite build` doesn't typecheck.** Always run `npm run typecheck` (strict index access; TS 7 removed `baseUrl`).
2. **Per-viewer snapshots** — a student snapshot without their id wipes their practice list.
3. **Never trust client text** for cards (marking, tracing labels); derive from the deck. Face-down text must not reach students.
4. **Effects and inline callbacks:** don't list unstable callbacks in effect deps; use refs (the tracing canvas wipe bug).
5. **Rate limits:** continuous streams need their own bucket (points had starved taps).
6. **CSS:** percentages inside `font-size: calc()` resolve against the parent font size (microscopic letters) → use `cqw`; with `box-shadow`-only borders, the printed hairline border is invisible on screen so a shadow was added.
7. **File inputs:** reset `input.value=''` after reading or re-selecting a fixed file doesn't fire `change`. Revoke object URLs after a delay (Safari cancels downloads otherwise).
8. **Shell:** `pkill -f "dist/server/index.js"` kills your own shell; use `pkill -f "[d]ist/server/index.js"`.
9. **Plain-deck vs designed-deck** rendering paths differ (`deck.styled`); any new card UI must handle both and the face-down case.
10. `socket.io` `emit` while disconnected would queue stale actions — the client refuses instead.

## 16. Known limitations, unverified areas, risks

1. **RISK — old browsers on the teacher's own hardware (unverified, likely real).** macOS 10.13.6 tops out around Safari 13 / older Chrome. The app uses modern features: `<dialog>.showModal()`, container-query units, `aspect-ratio`, `inset`, `:focus-visible`, and Vite's default build target (a modern baseline) — the bundle may not even parse there. Nothing has been tested on old browsers. Recommended first task: decide a supported-browser baseline with the teacher, detect-and-explain unsupported browsers, and/or add a legacy build target + fallbacks. Until then assume the teacher screen needs a newer device.
2. **HTML importer heuristic is stale:** `suggestPlacements` still treats a top-left corner mark (1/2/3) as a pile number, but that mark is the **sound count**. It also doesn't set `category/count/lesson` on imported cards (so those decks can't be edited in the builder). Fix: infer `category` from colour via `CATEGORY_COLORS`, copy count/lesson into the card fields, use `DEFAULT_POSITIONS`; update `client/tests/htmlCards.test.ts`.
3. **Positions in `examples/` are my assignments** (see §12) — not yet reviewed by the teacher.
4. **Tracing success detection** was verified only for "strokes register, show progress and stream"; not with real careful traces, children, or a finger on iPad/Safari. Vibration is Android-only in practice.
5. **Layout:** with *Live tracing* + *Tracing practice lists* open, the table is pushed below the first screen (suggestion: side column or pop-over).
6. **Print:** the 4×6 layout was verified by capturing the print stylesheet as a PDF in Chromium (5 cards → 5 pages, lines sized to text), not through a real browser print dialog on Safari/iPad.
7. **Builder limits:** re-opening lists rows by pile (not typing order); cannot set `rules` (flip/shuffle) or `faceDown`; default positions per category are my choices; there is no "lesson filter" when starting a game (cumulative decks are the workaround).
8. `pile:recycle` and parts of the classic Arrange view are not exercised by the new table UI.
9. **Not verified at all:** real Render deployment/WSS behind the proxy, `TRUST_PROXY` behaviour, Safari/iOS touch, Firefox, real tablets, screen readers, contrast measurement, load/scale (single in-memory instance).
10. Practice/privacy: student names appear in saved practice filenames/contents by design.

## 17. Suggested backlog (ask the teacher before anything marked ★)

1. Supported-browser decision + graceful "your browser is too old" screen / legacy build (§16.1).
2. Fix the HTML importer to the skill-card model (§16.2) + tests.
3. Teacher review of positions in `examples/` (offer a quick UI to view/adjust positions per lesson).
4. ★ Live-trace panel layout (side column vs pop-over vs leave).
5. Builder: remember typing order on edit; per-deck rules toggles (flip); ★ lesson filter/picker at game start.
6. Real-device pass (iPad/Safari: touch drag, tracing, print) and a screen-reader/contrast pass.
7. ★ Optional extras the teacher hasn't asked for: movable piles, word read-out, auto-offering a saved practice file on rejoin.

## 18. How to work

Small chunks; after each: `typecheck → test → build → e2e`; update `PROGRESS.md`; say exactly what changed and what you could **not** verify. Don't weaken tests to make them pass. Keep the rules in §6. If a request is ambiguous or big, ask the teacher (she answers briefly and decisively).
