// Where every initial in the field comes from.
//   wild(seed)      a fresh initial: one of the built-in styles, or its parts taken from several, nudged.
//   child(A, B, d)  bred from its two parents; d is how many steps out from the root it sits, and the
//                   further out, the further it strays, until the edges are wild again.
//   Field           the whole plane for one generation: a cell's initial is a pure function of the
//                   generation and the cell, so the field can be panned forever and come back the same.
// Cells are axial hex coordinates (q, r). In a bred field each cell descends from the neighbours one
// step nearer the root, so lineages fan out from the root and nearby cells share ancestors.

import { DEFAULTS, SECTIONS, PARAMS } from '../render/src/params.js?v=a8136959';
import { PRESETS, PALETTES, presetParams, sectionPreset, mutate } from '../render/src/styles.js?v=a8136959';
import { BLOW_UP } from './codes.js?v=a8136959';

export * from './codes.js?v=a8136959';
import { rng, hash, gauss, clamp } from '../render/src/util.js?v=a8136959';

const ALL = SECTIONS.map(s => s.id);
const PARTS = ['letter', 'frame', 'orn', 'tex', 'ink'];
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const pick = (r, xs) => xs[(r() * xs.length) | 0];

// A few starting points after wen: patterned grounds, engraving.
// Kept few, so they season the field rather than take it over.
export const WEN = [
	{ name: 'garden', p: { font: 'cinzel-700', size: 0.6, lFill: 'A', letterGap: 7, frame: 'circle', fMargin: 40, fRules: 1, fW1: 3, fRuleColor: 'A', fField: 'paper', fPattern: 'contour', fPatScale: 9, fPatW: 1.3, fPatColor: 'A', orn: 'none', tKind: 'none', paper: '#f3eee3', inkA: '#1a1614', inkB: '#b3301e', inkC: '#2c4a8c' } },
	{ name: 'bronze', p: { font: 'cinzel-900', size: 0.62, lFill: 'pattern', lPattern: 'contour', lPatScale: 6, lPatW: 1.3, lPatColor: 'paper', lPatBg: 'A', lOutline: 2, lOutlineColor: 'A', letterGap: 9, frame: 'rect', fMargin: 42, fRules: 2, fW1: 3, fGap: 6, fW2: 1.5, fRuleColor: 'A', fField: 'paper', fPattern: 'frets', fPatScale: 7, fPatW: 1.8, fPatColor: 'C', orn: 'none', tKind: 'none', paper: '#ece6d3', inkA: '#24443a', inkB: '#b2582c', inkC: '#5f7f52' } },
	{ name: 'engraving', p: { font: 'playfair-display-900', size: 0.62, lFill: 'pattern', lPattern: 'engrave', lPatScale: 8, lPatAngle: 25, lPatW: 1.5, lPatColor: 'A', lPatBg: 'paper', lOutline: 2.4, lOutlineColor: 'A', letterGap: 10, frame: 'rect', fMargin: 46, fRules: 1, fW1: 2, fRuleColor: 'A', fField: 'paper', orn: 'none', tKind: 'none', paper: '#f2eee6', inkA: '#141313', inkB: '#b3301e', inkC: '#2c4a8c' } },
	{ name: 'waves', p: { font: 'eb-garamond-700', size: 0.64, lFill: 'paper', letterGap: 12, frame: 'rounded', fMargin: 40, fRules: 1, fW1: 3, fRuleColor: 'A', fField: 'A', fPattern: 'seigaiha', fPatScale: 11, fPatW: 1.4, fPatColor: 'paper', orn: 'none', tKind: 'none', paper: '#f3eee4', inkA: '#23305e', inkB: '#c0412b', inkC: '#d9a441' } },
	{ name: 'hemp', p: { font: 'cormorant-garamond-700', size: 0.64, lFill: 'B', letterGap: 14, lHalo: 6, lHaloColor: 'paper', frame: 'rect', fMargin: 40, fRules: 2, fW1: 3, fGap: 5, fW2: 1.5, fRuleColor: 'A', fField: 'paper', fPattern: 'asanoha', fPatScale: 14, fPatW: 1.2, fPatColor: 'A', orn: 'none', tKind: 'none', paper: '#f4f0e6', inkA: '#1f4f8f', inkB: '#c33c26', inkC: '#c8a24a' } },
	{ name: 'crackle', p: { font: 'federo-400', size: 0.6, lFill: 'paper', lOutline: 2.4, lOutlineColor: 'A', letterGap: 10, frame: 'octagon', fMargin: 40, fRules: 1, fW1: 3, fRuleColor: 'A', fField: 'C', fPattern: 'ice', fPatScale: 9, fPatW: 1.3, fPatColor: 'A', orn: 'none', tKind: 'none', paper: '#ece6d3', inkA: '#24443a', inkB: '#b2582c', inkC: '#7f9c80' } },
	// after galley's reveals, held still
	{ name: 'rime', p: { font: 'cinzel-700', size: 0.62, lFill: 'B', letterGap: 9, frame: 'rect', fMargin: 42, fRules: 1, fW1: 2.5, fRuleColor: 'A', fField: 'paper', fPattern: 'frost', fPatScale: 18, fPatW: 1.1, fPatColor: 'A', orn: 'none', tKind: 'none', paper: '#f3eee3', inkA: '#1f2a3a', inkB: '#b3301e', inkC: '#2c4a8c' } },
	{ name: 'hyphae', p: { font: 'playfair-display-900', size: 0.66, lFill: 'pattern', lPattern: 'mycelium', lPatScale: 16, lPatW: 1.2, lPatColor: 'A', lPatBg: 'paper', lOutline: 1.2, lOutlineColor: 'A', letterGap: 8, frame: 'none', orn: 'none', tKind: 'none', paper: '#f2eee4', inkA: '#2a2420', inkB: '#8c2f2a', inkC: '#5f6e34' } },
	{ name: 'watercolour', p: { font: 'eb-garamond-700', size: 0.68, lFill: 'pattern', lPattern: 'wash', lPatScale: 12, lPatW: 1.2, lPatColor: 'C', lPatBg: 'paper', letterGap: 10, frame: 'rounded', fMargin: 40, fRules: 1, fW1: 1.5, fRuleColor: 'C', fField: 'paper', orn: 'none', tKind: 'none', paper: '#f4f0e6', inkA: '#1f4f8f', inkB: '#c33c26', inkC: '#3d6ea8' } },
	{ name: 'tessera', p: { font: 'cinzel-900', size: 0.62, lFill: 'pattern', lPattern: 'mosaic', lPatScale: 6, lPatW: 1.1, lPatColor: 'A', lPatBg: 'paper', letterGap: 10, frame: 'rect', fMargin: 40, fRules: 1, fW1: 2.5, fRuleColor: 'A', fField: 'paper', fPattern: 'mosaic', fPatScale: 7, fPatW: 1.1, fPatColor: 'C', orn: 'none', tKind: 'none', paper: '#efe9da', inkA: '#202d1b', inkB: '#c08d3e', inkC: '#c9b99a' } },
	{ name: 'newsprint', p: { font: 'abril-fatface-400', size: 0.64, lFill: 'pattern', lPattern: 'halftone', lPatScale: 5.5, lPatW: 1.2, lPatColor: 'A', lPatBg: 'paper', letterGap: 10, frame: 'rect', fMargin: 44, fRules: 1, fW1: 2, fRuleColor: 'A', fField: 'paper', fPattern: 'halftone', fPatScale: 6, fPatW: 1, fPatColor: 'B', orn: 'none', tKind: 'none', paper: '#f1ece1', inkA: '#141313', inkB: '#c0412b', inkC: '#2f6b6b' } },
	{ name: 'tortoise', p: { font: 'abril-fatface-400', size: 0.6, lFill: 'pattern', lPattern: 'kikko', lPatScale: 8, lPatW: 1.4, lPatColor: 'paper', lPatBg: 'B', lOutline: 2, lOutlineColor: 'B', letterGap: 10, frame: 'circle', fMargin: 44, fRules: 2, fW1: 2.5, fGap: 6, fW2: 1, fRuleColor: 'B', fField: 'paper', orn: 'none', tKind: 'none', paper: '#f4efe7', inkA: '#1c1a18', inkB: '#e0401f', inkC: '#2f5aa0' } },
];

// the field's library: the kept initials (render/data/kept.json, the ones liked so far), the
// built-in styles and the few above. Parts of initials come from all of them.
const KEPT = [];
let SOURCES = [...PRESETS, ...WEN];
export function setKept(list) {
	// near-copies (same face, frame, ornament, texture and fills) count once
	const seen = new Set();
	KEPT.length = 0;
	for (const k of list || []) {
		const P = k.params || k;
		const sig = [P.font, P.frame, P.orn, P.tKind, P.lFill, P.fPattern, P.inkA].join('|');
		if (seen.has(sig)) continue;
		seen.add(sig);
		KEPT.push({ name: 'kept ' + (k.id || KEPT.length), p: P });
	}
	SOURCES = [...KEPT, ...PRESETS, ...WEN];
}
const grows = () => SOURCES.filter(p => presetParams(p).orn !== 'none');
const textured = () => SOURCES.filter(p => presetParams(p).tKind !== 'none');

// complete-initial fonts that come already boxed (the letter on its own block, panel, ground or
// loop frame) stay out of the field: frames and grounds here are drawn by the renderer, not borrowed.
// The unboxed ornate ones stay (Hentzau, Victorian initials, Elzevier, Starburst), unless passed on
// below.
const BOXED = new Set(['morris-jenson-initialen', 'goudy-initialen', 'typographer-woodcut-initials', 'florana-initials',
	'wolnough-capitals', '16th-arabesques', 'gloucester-initialen', 'camelot-initials', 'kanzlei-initialen',
	'paulus-franck-initialen', 'unger-fraktur-zierbuchstaben', 'ehmcke-fraktur-initialen', 'celtic-eels',
	'mysterious-voyage', 'behrens-antiqua-initialen', 'konanur-kaps', 'wadsworth-industria'].map(s => 'init-' + s));
// faces left out after a look through them all
export const LEFT_OUT = new Set(['new-rocker-400', 'vast-shadow-400', 'ewert-400',
	'init-floral-majuscules-11th-c', 'init-lettres-ombrees-ornees', 'init-romantiques', 'init-celtic-knot']);
export const fieldFonts = fonts => fonts.filter(f => !BOXED.has(f.id) && !LEFT_OUT.has(f.id));

// textures whose marks are packed finer than this take minutes to grow (Voronoi cells at spacing 2:
// over two minutes; truchet a minute), so drift stops at these spacings. The styles use wider ones.
const FINEST = { cells: 10, truchet: 14, streams: 9, fur: 6, coral: 8, stipple: 4, bubbles: 4, ripples: 4 };
function tame(P) {
	if (FINEST[P.tKind] && P.tScale < FINEST[P.tKind]) P.tScale = FINEST[P.tKind];
	return P;
}

// the letter has to show against what's behind it. Behind it: the frame's ground (paper when
// there's no frame) and any pattern on that ground, which reads as solid when it's dense. The
// letter shows in its fill, pattern or split inks, and its outline. If none of those differ from
// what's behind, the outline (for an outline-only letter) or the fill moves to another ink.
// Two different inks of close colour (navy on near-black) count as the same.
const INKS = ['A', 'B', 'C', 'paper'];
const rgb = (P, k) => { const v = parseInt((k === 'paper' ? P.paper : P['ink' + k]).slice(1), 16); return [v >> 16 & 255, v >> 8 & 255, v & 255]; };
const lum = c => (0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]) / 255;
function alike(P, a, b) {
	if (a === b) return true;
	const x = rgb(P, a), y = rgb(P, b);
	const d = Math.sqrt(2 * (x[0] - y[0]) ** 2 + 4 * (x[1] - y[1]) ** 2 + 3 * (x[2] - y[2]) ** 2) / 765;
	return Math.abs(lum(x) - lum(y)) < 0.2 && d < 0.4;
}
function legible(P, r) {
	const behind = [P.frame === 'none' ? 'paper' : P.fField];
	if (P.frame !== 'none' && P.fPattern !== 'none') behind.push(P.fPatColor);
	const shows = k => !behind.some(b => alike(P, k, b));
	const free = INKS.filter(shows);
	const inks = P.lFill === 'pattern' ? [P.lPatColor] : P.lFill === 'split' ? [P.lSplitA, P.lSplitB] : INKS.includes(P.lFill) ? [P.lFill] : [];
	if (P.lOutline > 0) inks.push(P.lOutlineColor);
	if (!free.length) return P;
	// a pale letter on pale paper (yellow on cream) shows, but faintly: it takes the ink that stands
	// out most instead
	const ground = rgb(P, behind[0]);
	const faint = k => Math.abs(lum(rgb(P, k)) - lum(ground)) < 0.22;
	const fix = inks.some(shows) ? (inks.every(faint) ? [INKS.reduce((a, k) => Math.abs(lum(rgb(P, k)) - lum(ground)) > Math.abs(lum(rgb(P, a)) - lum(ground)) ? k : a)] : null) : free;
	if (!fix) return P;
	if (P.lFill === 'none' && P.lOutline > 0) P.lOutlineColor = pick(r, fix);
	else if (P.lFill === 'pattern') P.lPatColor = pick(r, fix);
	else P.lFill = pick(r, fix);
	return P;
}

// a wild letter alone on the paper, with nothing grown, framed or textured round it, gets one of
// those (a bred one keeps its parent's bareness)
function enough(P, r) {
	if (P.frame === 'none' && P.orn === 'none' && P.tKind === 'none') part(r, P, r() < 0.65 ? 'orn' : 'frame');
	if (P.orn === 'none' && P.frame === 'none' && P.tKind === 'none') P.orn = 'grow';
	return P;
}

// the letter keeps its place: variations never shift it. It sits a little bigger than in the built-in
// styles, and its size only drifts slightly from parent to child.
const big = s => clamp(+(s * 1.15).toFixed(3), 0.6, 0.95);
function hold(P, from, fonts, r) {
	P.dx = from.dx; P.dy = from.dy;
	if (!fonts.some(f => f.id === P.font)) P.font = pick(r, fonts.filter(f => f.group !== 'initials')).id;
	return P;
}

// one part of the initial from a random style; ornament and texture mostly from styles that have
// some, or most initials end up bare
function part(r, P, sec) {
	const pool = sec === 'orn' && r() < 0.85 ? grows() : sec === 'tex' && r() < 0.5 ? textured() : SOURCES;
	Object.assign(P, sectionPreset(pick(r, pool), sec));
}

// restraint: a ground holds at most two of a pattern, a texture and grown ornament; a letter at most
// two of a patterned fill, filigree, echoes, a shadow and an inline
function restrain(P, r) {
	// a letter split into two inks, half and half, was never liked: it takes one of them
	if (P.lFill === 'split') P.lFill = r() < 0.5 ? P.lSplitA : P.lSplitB;
	const ground = [];
	if (P.frame !== 'none' && P.fPattern !== 'none') ground.push(() => { P.fPattern = 'none'; });
	if (P.tKind !== 'none') ground.push(() => { P.tKind = 'none'; });
	if (P.orn !== 'none') ground.push(() => { P.orn = 'none'; });
	while (ground.length > 2) ground.splice((r() * ground.length) | 0, 1)[0]();
	const letter = [];
	if (P.lFill === 'pattern') letter.push(() => { P.lFill = P.lPatBg !== 'none' && P.lPatBg !== 'paper' ? P.lPatBg : P.lPatColor; });
	if (P.lFil !== 'none') letter.push(() => { P.lFil = 'none'; });
	if (P.lEcho > 0) letter.push(() => { P.lEcho = 0; });
	if (P.lShadow !== 'none') letter.push(() => { P.lShadow = 'none'; });
	if (P.lInline > 0) letter.push(() => { P.lInline = 0; });
	while (letter.length > 2) letter.splice((r() * letter.length) | 0, 1)[0]();
	return P;
}

// patterns packed finer than this read as a grey tint at the size the field shows them
const PAT_FINEST = { seigaiha: 9, asanoha: 10, kikko: 7, shippo: 8, frets: 5.5, ice: 8, contour: 6, engrave: 7, diaper: 7, scales: 5, checker: 4, frost: 15, mycelium: 13, wash: 8, mosaic: 4.5, halftone: 4.5 };
function coarse(P) {
	if (PAT_FINEST[P.fPattern] && P.fPatScale < PAT_FINEST[P.fPattern]) P.fPatScale = PAT_FINEST[P.fPattern];
	if (PAT_FINEST[P.lPattern] && P.lPatScale < PAT_FINEST[P.lPattern]) P.lPatScale = PAT_FINEST[P.lPattern];
	return P;
}
// blown-up letters only in faces whose strokes take it: romans, didones, uncials and deco. Scripts,
// blackletter and the swash and shadow display faces turn into unreadable blobs (fattened), or into
// a tangle of strokes (blown up from their skeleton)
const INFLATES = new Set(['roman', 'didone', 'uncial', 'deco']);
function readable(P, fonts) {
	const f = fonts.find(x => x.id === P.font), ok = f && INFLATES.has(f.group);
	if (P.lInflate > 0) P.lInflate = ok ? Math.min(P.lInflate, 20) : 0;
	// blown up (the among way) from the letter's strokes: past about 3.6 the counters close
	if (P.lBlob > 0) {
		if (!ok || !BLOW_UP) P.lBlob = 0;
		else {
			P.lBlob = clamp(P.lBlob, 1.8, 3.6);
			P.lBlobCounter = Math.max(30, P.lBlobCounter);
			P.lBlobRoom = Math.min(P.lBlobRoom, 80);
		}
	}
	return P;
}
const finish = (P, r, fonts) => tame(coarse(legible(readable(restrain(P, r), fonts), r)));

// colour: most wild initials keep their source's paper and inks; some take one of the named palettes
// whole (the renderer's PALETTES), which is where most of the field's range of colour comes from.
// Its own random stream, so the rest of each initial comes out as it did before there were these.
const RECOLOUR = 0.4;
function recolour(P, seed) {
	const r = rng(hash(seed, 'palette'));
	if (r() >= RECOLOUR) return;
	const p = PALETTES[(r() * PALETTES.length) | 0];
	Object.assign(P, { paper: p.paper, inkA: p.inkA, inkB: p.inkB, inkC: p.inkC });
}

// Most wild initials start close to one that was kept, then one of the built-in styles, then the
// few above, and the rest take each part from a different source. All are nudged a little.
// font: set it in that face (the fonts page rolls initials one face at a time)
export function wild(seed, fonts, font = null) {
	const r = rng(seed), u = r(), k = KEPT.length ? 0.42 : 0;
	let base, amount;
	if (u < k) { base = presetParams(pick(r, KEPT)); amount = 0.05 + r() * 0.17; }
	else if (u < k + 0.2) { base = presetParams(pick(r, PRESETS)); amount = 0.08 + r() * 0.24; }
	else if (u < k + 0.36) { base = presetParams(pick(r, WEN)); amount = 0.05 + r() * 0.17; }
	else { base = { ...DEFAULTS }; for (const sec of ALL) part(r, base, sec); amount = 0.08 + r() * 0.2; }
	recolour(base, seed);
	const P = hold(mutate(base, amount, ALL, hash(seed, 'm'), fonts), base, fonts, r);
	if (font) P.font = font;
	P.size = big(base.size);
	P.text = pick(r, LETTERS);
	return finish(enough(P, r), r, fonts);
}

// d = steps from the root. Nothing starts over: each step strays a little further and swaps a part
// a little more often, and every cell crosses its two parents (the neighbours one step nearer the
// root), so neighbouring lineages blend instead of meeting at a seam. Close in they are kin; by six
// or seven rings out most parts have come from somewhere else.
const stray = d => Math.min(0.6, 0.09 + 0.055 * d);               // mutation amount
const jump = d => Math.min(0.55, 0.07 * d);                       // a part swapped for another style's
const reletter = d => d < 2 ? 0.25 : 0.45;

// the keys of one section of P
const KEYS = Object.fromEntries(ALL.map(sec => [sec, PARAMS.filter(p => p.section === sec && p.key !== 'text').map(p => p.key)]));
const sectionOf = (P, sec) => Object.fromEntries(KEYS[sec].map(k => [k, P[k]]));

// pins: sections of the root every initial in the field keeps exactly
export function child(A, B, d, seed, fonts, pins = [], root = null) {
	const r = rng(seed);
	let parent = A;
	if (B && B !== A) { parent = { ...A }; for (const sec of ALL) if (r() < 0.5) Object.assign(parent, sectionOf(B, sec)); }
	const P = hold(mutate(parent, stray(d), ALL, hash(seed, 'm'), fonts), parent, fonts, r);
	P.size = clamp(+(parent.size + gauss(r) * 0.02).toFixed(3), 0.6, 0.95);
	if (r() < jump(d)) {
		for (const sec of r() < Math.min(0.5, 0.06 * d) ? [pick(r, PARTS), pick(r, PARTS)] : [pick(r, PARTS)]) {
			part(r, P, sec);
			if (sec === 'letter') { P.size = big(P.size); hold(P, P, fonts, r); }
		}
	}
	if (r() < reletter(d)) P.text = pick(r, LETTERS);
	finish(P, r, fonts);
	if (root && pins.length) {
		for (const sec of pins) Object.assign(P, sectionOf(root, sec));
		if (pins.includes('letter')) { P.text = root.text; P.size = root.size; }
		else legible(P, r);
	}
	return P;
}

const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
export const hexDist = (dq, dr) => (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;

// gen = { seed, root: null | { q, r, P }, pins: [section…] }
export class Field {
	constructor(gen, fonts) {
		this.gen = gen;
		this.fonts = fonts;
		this.pins = gen.pins || [];
		this.memo = new Map();
		if (gen.root) this.memo.set(gen.root.q + ',' + gen.root.r, gen.root.P);
	}
	dist(q, r) { const o = this.gen.root; return o ? hexDist(q - o.q, r - o.r) : Infinity; }
	// the neighbours one step nearer the root, the one it takes most after first. Far out a single line
	// of descent does (crossing there would mean breeding the whole cone back to the root)
	parentsOf(q, r) {
		const d = this.dist(q, r);
		const c = DIRS.map(([a, b]) => [q + a, r + b]).filter(([a, b]) => this.dist(a, b) === d - 1);
		const h = hash(this.gen.seed, q, r, 'p');
		if (c.length < 2) return c;
		if (d > 16) return [c[h % c.length]];
		return h & 1 ? c : [c[1], c[0]];
	}
	at(q, r) {
		const key = q + ',' + r;
		if (this.memo.has(key)) return this.memo.get(key);
		const { seed, root } = this.gen;
		if (!root) {
			const P = wild(hash(seed, q, r), this.fonts);
			this.memo.set(key, P);
			return P;
		}
		// every ancestor not bred yet, then breed them nearest the root first
		const need = [], seen = new Set([key]), stack = [[q, r]];
		while (stack.length) {
			const c = stack.pop();
			need.push(c);
			for (const p of this.parentsOf(c[0], c[1])) {
				const k = p[0] + ',' + p[1];
				if (!this.memo.has(k) && !seen.has(k)) { seen.add(k); stack.push(p); }
			}
		}
		need.sort((x, y) => this.dist(x[0], x[1]) - this.dist(y[0], y[1]));
		for (const [a, b] of need) {
			const [A, B] = this.parentsOf(a, b).map(([x, y]) => this.memo.get(x + ',' + y));
			this.memo.set(a + ',' + b, child(A, B || null, this.dist(a, b), hash(seed, a, b), this.fonts, this.pins, root.P));
		}
		return this.memo.get(key);
	}
}
