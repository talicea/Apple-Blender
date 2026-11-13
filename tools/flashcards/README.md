# Flashcard generator (Python)

The original printable-card generator, kept in this project so the game and the generator share ONE card format
(category colours, sound count, lesson, and now **position**). The app's **Deck builder** does the same job in the browser
(including printing 4×6 in cards); these scripts remain for batch work.

```
pip install playwright fonttools && playwright install chromium
python3 make_skills.py skills_03.txt            # -> skills_03.pdf   (add --png, --trace, --no-lines ...)
```

## Card list format (one card per line)

```
text, category, sounds, position, lesson
a, V, 2, M
t, C, , IF
ck, DG, , F, 5
```

* **category** `V C DG P B T DP` sets the colour (see `CATEGORY_COLORS` in `card_common.py`; the app reads the same codes, and a test fails if they ever differ).
* **sounds** (optional) is printed top-left. **lesson** (optional 5th column) overrides the lesson number taken from the file name (`skills_03.txt` → 3).
* **position** (optional here, used by the game) is `I` initial, `M` medial, `F` final, or a combination such as `IF`: which pile(s) the card goes in.
  The printed card ignores it, so old three-column files still work. In the app, lines without a position get a default for their category.

Export a list from the Deck builder with **Download card list (.txt)** and print it here, or load any of these files into the Deck builder.
The font is read from `fonts/` next to the scripts, or from `../../client/public/fonts/` (the copy the game already bundles).
