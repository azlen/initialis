// A pattern of your own, to copy: chevron stripes, with a setting of its own for how deep they are.
// Load it, then name it in an initial's settings like any built-in pattern:
//
//   import { use, draw } from 'https://initialis.azlen.me/lib/initialis.js';
//   await use('https://your.site/chevrons.js');
//   await draw(canvas, { text: 'Q', fPattern: 'chevrons', fChevronDepth: 1.2 });
//
//   <initialis-cap use="https://your.site/chevrons.js" settings='{"text":"Q","fPattern":"chevrons"}'></initialis-cap>
//
// A module needs nothing from the renderer: everything it draws with comes in as the argument.
// What each family gets, and what it gives back: render/src/kinds/README.md.

export default {
	family: 'pattern',
	name: 'chevrons',
	// its own settings, as rows of the table in render/src/params.js: key, section, stage (geo: changes
	// the layout; paint: only what's painted), default, [min, max, step], label
	params: [['fChevronDepth', 'frame', 'paint', 0.6, [0.1, 2, 0.05], 'chevron depth']],

	// s: px between the lines; R: a radius covering the box; P(u, v): a point turned to the pattern's
	// angle round its middle; out: lines, polys and dots to add to; settings: the initial's settings
	geometry({ s, R, P, out, settings }) {
		const depth = (settings.fChevronDepth ?? 0.6) * s * 2, tooth = s * 2;
		for (let v = -R - depth; v <= R + depth; v += s) {
			const line = [];
			for (let u = -R, i = 0; u <= R + tooth; u += tooth, i++) line.push(P(u, v + (i % 2 ? depth : 0)));
			out.lines.push(line);
		}
	},
};
