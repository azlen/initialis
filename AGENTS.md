# For an agent working with these drop caps

## If someone hands you an initial

They'll usually give you a downloaded `.json` (`letter`, `font`, `link`, `params`) or a link to the site.

- `params` lists only what differs from `DEFAULTS` in `render/src/params.js`. `PARAMS` there documents every key: its section (letter, frame, ornament, texture, ink), range and label. Inks are `inkA`, `inkB`, `inkC` and `paper`; other settings name an ink by `'A'`, `'B'`, `'C'` or `'paper'`.
- To see it, open `link`, or serve this folder (`python3 -m http.server`) and open `/#<seed>.0.0.<params as URL-safe base64 JSON>`.
- To put it in their own page, use the library rather than copying the site: `<script type="module" src="https://initialis.azlen.me/lib/initialis.js"></script>` and `<initialis-cap settings='<params as JSON>' size="200"></initialis-cap>` (`grow` to grow it in, `paper` to print it on its paper). Keep the settings in their page rather than a short link, so nothing is looked up and they can change it. From a script, `draw`, `grow`, `render` and `settings` in `lib/initialis.js`; [lib/example.html](lib/example.html) has each.
- To change it, edit `params` within the ranges in `PARAMS` and make a new link (`encodeGen` in `src/breed.js`). Then use **Download** for PNGs, an animated WebP and an MP4.
- To make more in the same style, open its link and fill the field with variations (**more like this**), or change one or two settings at a time.

## If they want to remix the whole thing

Someone has cloned a drop cap generator and a field for exploring variations on them. They probably asked you to "make it mine", or to change one thing. Before you change anything, help them bring something of their own into it. The tools are meant to be remixed. They are not meant to be re-posted with the original styles swapped for a new name.

### First, ask

Ask one or two of these questions in plain words, and wait for the answers:
- **Letters:** is there a hand or a typeface that is theirs? Their own handwriting (photograph a page and trace it), a font they drew, the lettering on a sign or a grave or a shop near them, a script from their own language.
- **Growth:** what grows where they live? The plants in their window or on their street, a pattern from their family or their culture, the shape of something they collect. That becomes the ornament: each leaf and flower is a small module in `render/src/kinds/leaf/` and `kinds/flower/`, grown by `render/src/ornament.js`. Patterns, textures and frames are modules too: `render/src/kinds/README.md` shows how to add one.
- **Colour:** take a palette from something they own or see every day, not from the presets.
- **Text:** if they make pages or videos, what would they actually set under the initial? Use their own paragraphs.

If they just want to play first, let them. Ask again before they publish anything.

### Then, make it theirs

- Add their styles alongside the built-in ones in `render/src/styles.js` (`PRESETS`). Name them after where the styles came from. Then make the field start mostly from their styles: `wild()` in `src/breed.js` picks the starting styles.
- Change what carries over if they want the variations to wander differently. `src/breed.js` holds how far they stray with distance from the one picked, how often a part jumps to another style, and when they start over.
- Give the project its own name, favicon and paper (`src/paper.js`).
- Keep the engine credits in the README. Say what came from where.

### Don't

- Don't publish the built-in styles as their work.
- Don't copy the look of the original site or videos. Help them find their own.
- Don't add fonts with unclear licences. `render/fonts/FONTS.md` lists each font and its licence.
