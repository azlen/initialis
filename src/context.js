// In context: the initial as the drop cap of a real page, set round it where it sits in the field.
// The opening comes from the renderer's 26 chapter openings (the one for its letter), set in ET Book
// with its line breaker. Each line is pulled in only as far as the initial's own ink reaches at that
// height, so the text hugs a round frame or a bare letter instead of a square box. The sheet is
// printed and aged on the GPU (ageing/src): a little yellowing, what lies behind showing through,
// a grease spot, light uneven cockling, rubbed and feathered ink.

import '../render/vendor/opentype.min.js?v=a8136959';
import { layoutPage, pagePath, PAGE, textFont, hyphenator } from '../render/src/page.js?v=a8136959';
import { Renderer, PRINT_S, GHOST_S } from '../ageing/src/gpu.js?v=a8136959';
import { buildLeaf, setPageSize } from '../ageing/src/page.js?v=a8136959';
import { defaultState } from '../ageing/src/effects.js?v=a8136959';
import { buildGeo, buildField } from '../ageing/src/fields.js?v=a8136959';

const MARGIN = 40;    // page units of sheet past each side of the screen

// how it ages, set by eye. No fold, and only a light cockle that comes and goes
// across the sheet: the even ripple read as a pattern laid over the page.
function ageing() {
	const st = defaultState();
	const set = (id, amount, more = {}) => Object.assign(st.fx[id], { amount, ...more });
	set('stock', 1); set('tone', 0.24); set('show', 0.22, { soft: 0.75 }); set('offset', 0.03); set('grease', 0.3);
	set('cockle', 0.22, { scale: 0.65, vary: 0.85 }); set('edges', 0.29);
	set('press', 0.18); set('fade', 0.1); set('rub', 0.42); set('feather', 0.1);
	return Object.assign(st, { light: 0.48, lightAngle: 0.57, under: 1 });
}

// an initial painted on its own paper → its ink (transmission: colour over paper) and coverage,
// the whole square kept so the letter stays where it was drawn
async function inkOf(bitmap) {
	const w = bitmap.width, h = bitmap.height;
	const cv = new OffscreenCanvas(w, h), x = cv.getContext('2d', { willReadFrequently: true });
	x.drawImage(bitmap, 0, 0);
	const d = x.getImageData(0, 0, w, h).data;
	const border = [];
	for (let i = 0; i < w; i += 4) border.push(i * 4, ((h - 1) * w + i) * 4);
	for (let j = 0; j < h; j += 4) border.push(j * w * 4, (j * w + w - 1) * 4);
	const med = c => { const v = border.map(o => d[o + c]).sort((a, b) => a - b); return Math.max(1, v[v.length >> 1]); };
	const paper = [med(0), med(1), med(2)];
	const T = new Uint8ClampedArray(d.length), C = new Uint8ClampedArray(d.length), cov = new Float32Array(w * h);
	for (let i = 0, p = 0; i < w * h; i++, p += 4) {
		let mn = 1;
		for (let c = 0; c < 3; c++) { const t = Math.min(1, d[p + c] / paper[c]); T[p + c] = t * 255; mn = Math.min(mn, t); }
		T[p + 3] = 255;
		cov[i] = 1 - mn;
		C[p] = C[p + 1] = C[p + 2] = cov[i] * 255; C[p + 3] = 255;
	}
	const bm = arr => createImageBitmap(new ImageData(arr, w, h));
	return { trans: await bm(T), cov: await bm(C), alpha: cov, w, h };
}

// where the initial's ink is in its square, as fractions [x0, y0, x1, y1]: rows and columns with
// more than a speck of ink, so a stray dot doesn't count as an edge
function extent(ink) {
	const { alpha, w, h } = ink, rows = new Float32Array(h), cols = new Float32Array(w);
	for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const a = alpha[y * w + x] > 0.15 ? 1 : 0; rows[y] += a; cols[x] += a; }
	const first = (v, n) => { const t = n * 0.004; for (let i = 0; i < v.length; i++) if (v[i] > t) return i; return 0; };
	const last = (v, n) => { const t = n * 0.004; for (let i = v.length - 1; i >= 0; i--) if (v[i] > t) return i + 1; return v.length; };
	return [first(cols, h) / w, first(rows, w) / h, last(cols, h) / w, last(rows, w) / h];
}

// a passage for the letter: a different one each time In context opens (data/passages.json, a few
// per letter from different books), the book's own opening when there's none
let passages = null;
const lastPassage = {};
async function passage(letter) {
	if (!passages) passages = fetch(new URL('../data/passages.json', import.meta.url)).then(r => r.ok ? r.json() : {}).catch(() => ({}));
	const list = (await passages)[letter] || [];
	if (!list.length) return (await buildLeaf(letter)).par;
	let i = Math.floor(Math.random() * list.length);
	if (list.length > 1 && i === lastPassage[letter]) i = (i + 1) % list.length;
	lastPassage[letter] = i;
	return list[i];
}

// how far right the initial's ink reaches between y0 and y1 (fractions of its height), as a
// fraction of its width; -1 where there's none
function reach(ink, y0, y1) {
	const { alpha, w, h } = ink;
	let best = -1;
	for (let y = Math.max(0, Math.floor(y0 * h)); y < Math.min(h, Math.ceil(y1 * h)); y++) {
		for (let x = w - 1; x > best; x--) if (alpha[y * w + x] > 0.12) { best = x; break; }
	}
	return best < 0 ? -1 : (best + 1) / w;
}

let R = null;
async function renderer() {
	if (!R) R = await Renderer.create(new OffscreenCanvas(4, 4));
	return R;
}
export const canAge = () => !!navigator.gpu;

// In context, across the screen: one sheet the size of the screen, no edges, with a passage for P's
// letter set from where P sits (its box: screen px x, y and side s) to the right edge and down to
// the foot. The text sits flush with the initial's ink, not its square: the ink's left edge is the
// text's left margin, its top is the first line's cap height, and the drop cap runs as many lines
// as bring its foot to a baseline. The other initials in view (ghosts: {src, x, y, s}) are what lies
// behind the sheet, so they show through it faintly, the way the back of a leaf does. The initial
// itself is laid over the sheet by the caller, as crisp as in the field. Returns a canvas of the
// screen at device pixels.
export async function sheetAround({ P, box, w, h, ghosts, paint, dpr = Math.min(2, devicePixelRatio || 1) }) {
	const [font, hyph] = await Promise.all([textFont(), hyphenator()]);
	const letter = /^[A-Z]/.test(P.text) ? P.text[0] : 'A';
	const par = await passage(letter);
	const capH = ((font.tables.os2 && font.tables.os2.sCapHeight) || font.unitsPerEm * 0.66) / font.unitsPerEm * PAGE.fs;
	// the initial first, to find its ink (drawn at its screen size, about)
	const bmp = await paint(P, Math.round(Math.min(1024, box.s * dpr)));
	if (!bmp) return null;
	const ink = await inkOf(bmp);
	bmp.close();
	const [ex0, ey0, ex1, ey1] = extent(ink);
	// a drop cap as many lines deep as keeps the text near 21 css px for the ink's height; the scale
	// then puts the ink's foot exactly on the last of those lines' baseline
	const inkH = box.s * (ey1 - ey0);
	const N = Math.max(2, Math.min(9, Math.round((inkH / 0.95 - capH) / PAGE.lh) + 1));
	const D = capH + (N - 1) * PAGE.lh, z = inkH / D, S = box.s / z;
	// the sheet runs MARGIN units past every side of the screen, so its edges never show
	const W = w / z + 2 * MARGIN, H = h / z + 2 * MARGIN;
	// the square's corner, and the text's: the ink's top left
	const bx = box.x / z + MARGIN, by = box.y / z + MARGIN, ox = ex0 * S, oy = ey0 * S, tx = bx + ox, ty = by + oy;
	const measure = Math.max(280, Math.min(720, W - MARGIN - 50 / z - tx));
	const gap = PAGE.fs * 0.5;
	// lines beside the initial start past its ink, measured from the text's margin
	const indent = (l) => {
		const base = capH + l * PAGE.lh;
		if (base - capH > D) return 0;
		const f = reach(ink, (oy + base - capH - 2) / S, (oy + base + PAGE.fs * 0.3) / S);
		return f < 0 ? 0 : f * S - ox + gap;
	};
	// the text runs on past the foot of the screen, so no paragraph is ever too long to set
	const maxLines = Math.max(N + 1, Math.ceil((H - ty) / PAGE.lh) + 40);
	const L = layoutPage(font, par, hyph, measure, { lines: N, maxLines, indent });
	setPageSize(W, H);
	try {
		// the text (r = ink coverage)
		const recto = new OffscreenCanvas(Math.round(W * PRINT_S), Math.round(H * PRINT_S)), x = recto.getContext('2d');
		x.fillStyle = '#000'; x.fillRect(0, 0, recto.width, recto.height);
		x.fillStyle = '#fff';
		x.scale(PRINT_S, PRINT_S);
		x.save(); x.translate(tx, ty); x.fill(pagePath(font, L)); x.restore();
		// what lies behind the sheet: the other initials, as plain coverage (r)
		const back = new OffscreenCanvas(Math.round(W * GHOST_S), Math.round(H * GHOST_S)), g = back.getContext('2d');
		g.fillStyle = '#000'; g.fillRect(0, 0, back.width, back.height);
		// each as a white silhouette (by hand: Safari's canvas has no filter)
		for (const o of ghosts) {
			const t = new OffscreenCanvas(o.src.width, o.src.height), tx = t.getContext('2d');
			tx.drawImage(o.src, 0, 0);
			tx.globalCompositeOperation = 'source-in';
			tx.fillStyle = '#fff';
			tx.fillRect(0, 0, t.width, t.height);
			g.drawImage(t, (o.x / z + MARGIN) * GHOST_S, (o.y / z + MARGIN) * GHOST_S, o.s / z * GHOST_S, o.s / z * GHOST_S);
		}
		const r = await renderer();
		r.setLeaf({ recto, ghosts: back, cap: { box: [bx, by, S] } });
		const st = ageing();
		r.setGeo(buildGeo(st));
		r.setField(buildField(st));
		const img = await r.read(st, { x: MARGIN, y: MARGIN, z: z * dpr }, Math.round(w * dpr), Math.round(h * dpr));
		const canvas = document.createElement('canvas');
		canvas.width = img.width; canvas.height = img.height;
		canvas.getContext('2d').putImageData(img, 0, 0);
		return { canvas, lines: N, S, indents: L.lines.slice(0, N + 1).map(l => Math.round(l.words[0] ? l.words[0].x : 0)) };
	} finally { setPageSize(); }
}
