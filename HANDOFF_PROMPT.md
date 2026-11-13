You are taking over **Phonics Piles**, a real-time classroom phonics card game (React 19 + Vite + TypeScript 7 client, Node/Express 5/Socket.IO server, shared Zod schemas, Playwright e2e). The attached zip is the complete project.

**Read first, in order:** `HANDOFF.md` (complete description of the project, invariants, contracts, tests, data, risks, backlog) → `PROGRESS.md` → `README.md`.

**Setup:** Node ≥ 20. `npm install`, `npm run dev` (http://localhost:5173). Definition of done for every change: `npm run typecheck && npm test && npm run build && npm run e2e` all green (e2e needs `npx playwright install chromium`). Note `vite build` does NOT typecheck — run `npm run typecheck`.

**Hard rules (see HANDOFF §6, §15):** server-authoritative (clients request, server validates identity/permission/payload/rules, then broadcasts; never trust client claims); never build a student snapshot without their id; card text always comes from the deck, never from the client; no external fonts/scripts/CDNs (children's privacy, offline classrooms — Playwrite CO is bundled); deck/card data is untrusted (strict Zod, hex colours only, text rendered as text); host token is secret; category colours must stay identical to `tools/flashcards/card_common.py` (a test enforces it); don't weaken tests; add tests for every behaviour change; don't claim anything works that you didn't run — list what you couldn't verify.

**The product owner is a teacher, not a developer.** Her own computer is an old Mac (macOS 10.13.6, cannot run Node); she deploys by uploading the repo to GitHub in the browser (Render redeploys). Keep UX simple. **Ask her before adding anything not listed below.** Work in small chunks and report after each.

**Your tasks, in order:**
1. **Browser support (HANDOFF §16.1).** Determine which modern features the app needs (`<dialog>`, container-query units `cqw`, `aspect-ratio`, `inset`, `:focus-visible`, Vite's default build target…). Propose a supported-browser baseline for the teacher to approve, then implement: feature-detect and show a clear, kind "this browser is too old — use X" screen instead of a blank page, and (if the teacher wants) a legacy build target/fallbacks. Test what you can (Chromium only is available; say what you could not test).
2. **Fix the HTML importer to the skill-card model (§16.2):** infer `category` from text colour using `CATEGORY_COLORS`; copy sound count (top-left corner) and lesson (bottom-right) into the card's `count`/`lesson` fields; stop treating the top-left mark as a pile number; use `DEFAULT_POSITIONS` for suggestions (keep the ENDING_ONLY heuristic); imported decks should then open in the Deck builder. Update `client/tests/htmlCards.test.ts` and the importer dialog text.
3. **Position review aid:** a small read-only table (in the Deck builder or deck picker) showing, per lesson, which cards are in Initial / Medial / Final, so the teacher can check the positions assigned in `examples/` (HANDOFF §12). The `examples/skills_all_with_positions.txt` file must load in the builder with 91 rows and no problems (an existing check).
4. Re-run all checks, update `README.md` / `PROGRESS.md`, and summarise exactly what changed, what you verified, and what you could not verify.

Do not start the other backlog items (HANDOFF §17) without asking.
