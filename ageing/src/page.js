// The printed leaf: a chapter opening set in ET Book with the renderer's page engine (justified,
// hyphenated, a 3-line drop cap), plus the two texts that ghost through it: the back of the
// same leaf (show-through) and the facing page (offset). All in page units, y down; a unit is
// the renderer's (22 units = the text size), about 5.65 units to the millimetre on an octavo page.

import { layoutPage, pagePath, PAGE, textFont, hyphenator } from '../../render/src/page.js?v=a8136959';

export const MM = 5.65;
export let PAGE_W = 791, PAGE_H = 1220;            // 140 × 216 mm
// another sheet size, in page units (scion lays a sheet the size of the screen)
export function setPageSize(w = 791, h = 1220) { PAGE_W = w; PAGE_H = h; }
export const TEXT_X = 79;                           // inner margin (the spine is on the left of a recto)
const OPEN_Y = 300;                                 // chapter openings sink: the drop cap's top
const FULL_Y = 104;                                 // a full page's first cap top
const OPTS = { kerning: true, features: { liga: true, kern: true } };

let parasP = null;
export function paragraphs() {
	if (!parasP) parasP = fetch(new URL('../../render/data/paragraphs.json', import.meta.url)).then(r => r.json());
	return parasP;
}
let keptP = null;
export function keptInitials() {
	if (!keptP) keptP = fetch(new URL('../../render/data/kept.json', import.meta.url)).then(r => r.json())
		.then(list => list.map(k => ({ id: k.id, letter: k.params.text, png: new URL(`../../render/data/kept/${k.id}.png`, import.meta.url).href })))
		.catch(() => []);
	return keptP;
}

// the renderer's PAGE is shared module state: set it for one layout, then put it back
function withPage(over, fn) {
	const old = { ...PAGE };
	Object.assign(PAGE, over);
	try { return fn(); } finally { Object.assign(PAGE, old); }
}

// a run of whole paragraphs with no drop cap, as many as fit `lines`
function plainLayout(font, hyph, texts, lines) {
	return withPage({ lines: 0, maxLines: lines }, () => layoutPage(font, { text: ' ', next: texts }, hyph));
}

function smallCaps(ctx, font, text, x, y, fs, track) {
	let cx = x;
	for (const ch of text) {
		const small = ch !== ch.toUpperCase();
		const size = small ? fs * 0.76 : fs;
		const p = font.getPath(ch.toUpperCase(), cx, y, size, OPTS);
		p.fill = null;
		ctx.fill(new Path2D(p.toPathData(2)));
		cx += font.getAdvanceWidth(ch.toUpperCase(), size, OPTS) + track;
	}
	return cx - x - track;
}
function smallCapsWidth(font, text, fs, track) {
	let w = 0;
	for (const ch of text) w += font.getAdvanceWidth(ch.toUpperCase(), ch !== ch.toUpperCase() ? fs * 0.76 : fs, OPTS) + track;
	return w - track;
}

// Lay out the leaf for `letter` (A–Z: which book's chapter opening). Returns geometry only;
// draw() rasterises it.
export async function buildLeaf(letter) {
	const [font, hyph, paras] = await Promise.all([textFont(), hyphenator(), paragraphs()]);
	const par = paras[letter] || paras.A;
	const letters = Object.keys(paras).sort();
	const li = letters.indexOf(letter);
	const lineCount = Math.floor((PAGE_H - 170 - OPEN_Y) / PAGE.lh);
	const L = withPage({ lines: 3, maxLines: lineCount }, () => layoutPage(font, par, hyph));
	// the back of this leaf and the facing page: the books that follow and precede, run on until full
	const fill = (dir) => {
		const texts = [];
		for (let k = 1; texts.join(' ').length < 3400 && k < 26; k++) {
			const p = paras[letters[(li + dir * k + 26 * 4) % 26]];
			texts.push(p.text, ...(p.next || []));
		}
		return texts;
	};
	const fullLines = Math.floor((PAGE_H - 150 - FULL_Y) / PAGE.lh);
	const back = plainLayout(font, hyph, fill(1), fullLines);
	const facing = plainLayout(font, hyph, fill(-1), fullLines);
	return { font, letter, par, L, back, facing, folio: 3 + ((letter.charCodeAt(0) * 37) % 180) * 2 + 1 };
}

// The initial's box in page units: [x, y, size, size]
export function capBox(leaf) {
	return [TEXT_X, OPEN_Y, leaf.L.S, leaf.L.S];
}

// Rasterise the recto ink into a canvas: white ink on black (r = coverage), at `s` texels per
// unit. `cap` is the drop cap: null (an ET Book capital) or an ImageBitmap of a rendered
// initial already turned into ink (see initialInk), which also lands in the coverage.
export function drawRecto(leaf, s, capInk) {
	const { font, L, par } = leaf;
	const W = Math.round(PAGE_W * s), H = Math.round(PAGE_H * s);
	const cv = new OffscreenCanvas(W, H), ctx = cv.getContext('2d');
	ctx.fillStyle = '#000';
	ctx.fillRect(0, 0, W, H);
	ctx.fillStyle = '#fff';
	ctx.scale(s, s);
	// the heading: the book's title in spaced small caps, centred over the measure
	const fsH = PAGE.fs * 0.92, trackH = PAGE.fs * 0.24;
	const title = (par.title || '').replace(/^The /, 'The ');
	const tw = smallCapsWidth(font, title, fsH, trackH);
	smallCaps(ctx, font, title, TEXT_X + (PAGE.measure - tw) / 2, OPEN_Y - 128, fsH, trackH);
	// the text, offset so the drop cap's box sits at the text block's top left
	ctx.save();
	ctx.translate(TEXT_X, OPEN_Y);
	ctx.fill(pagePath(font, L));
	ctx.restore();
	// the drop cap
	const [bx, by, bs] = capBox(leaf);
	if (capInk) ctx.drawImage(capInk.cov, bx, by, bs, bs);
	else {
		const ch = par.text[0];
		const g = font.charToGlyph(ch), bb = g.getBoundingBox(), upm = font.unitsPerEm;
		const size = bs / ((bb.y2) / upm);                 // cap height fills the box
		const adv = (bb.x2 - bb.x1) / upm * size;
		const p = font.getPath(ch, bx + (bs - adv) / 2 - bb.x1 / upm * size, by + bs, size, OPTS);
		ctx.fill(new Path2D(p.toPathData(2)));
	}
	// drop folio, centred at the foot
	const fol = String(leaf.folio), fw = font.getAdvanceWidth(fol, PAGE.fs * 0.9, OPTS);
	ctx.fill(new Path2D(font.getPath(fol, TEXT_X + (PAGE.measure - fw) / 2, PAGE_H - 92, PAGE.fs * 0.9, OPTS).toPathData(2)));
	return cv;
}

// The back of the leaf (r) and the facing page (g), both as seen from the front: mirrored, and
// backed up against the recto's text block as a good printer registers them.
export function drawGhosts(leaf, s) {
	const W = Math.round(PAGE_W * s), H = Math.round(PAGE_H * s);
	const cv = new OffscreenCanvas(W, H), ctx = cv.getContext('2d');
	ctx.fillStyle = '#000';
	ctx.fillRect(0, 0, W, H);
	ctx.globalCompositeOperation = 'lighter';
	const put = (L, color, dx, dy) => {
		ctx.save();
		ctx.scale(s, s);
		// mirror about the text block's centre line
		ctx.translate(TEXT_X + PAGE.measure + dx, FULL_Y + dy);
		ctx.scale(-1, 1);
		ctx.fillStyle = color;
		ctx.fill(pagePath(leaf.font, L));
		ctx.restore();
	};
	put(leaf.back, '#f00', 1.5, 0.8);
	put(leaf.facing, '#0f0', -3, 4);
	return cv;
}

// A rendered initial (a kept PNG, painted on its own paper) → its ink alone: transmission
// (ink colour relative to its paper, white where bare) and coverage (white = ink), cropped to
// what's painted. Both as ImageBitmaps.
export async function initialInk(url) {
	const blob = await (await fetch(url)).blob();
	const bmp = await createImageBitmap(blob);
	const w = bmp.width, h = bmp.height;
	const cv = new OffscreenCanvas(w, h), ctx = cv.getContext('2d', { willReadFrequently: true });
	ctx.drawImage(bmp, 0, 0);
	const im = ctx.getImageData(0, 0, w, h), d = im.data;
	// its paper: the median of the border pixels
	const border = [];
	for (let i = 0; i < w; i += 4) border.push(i * 4, ((h - 1) * w + i) * 4);
	for (let j = 0; j < h; j += 4) border.push(j * w * 4, (j * w + w - 1) * 4);
	const med = (c) => { const v = border.map(o => d[o + c]).sort((a, b) => a - b); return Math.max(1, v[v.length >> 1]); };
	const paper = [med(0), med(1), med(2)];
	let x1 = w, y1 = h, x2 = 0, y2 = 0;
	const T = new Uint8ClampedArray(d.length), C = new Uint8ClampedArray(d.length);
	for (let i = 0, p = 0; i < w * h; i++, p += 4) {
		let mn = 1;
		for (let c = 0; c < 3; c++) {
			const t = Math.min(1, d[p + c] / paper[c]);
			T[p + c] = t * 255;
			mn = Math.min(mn, t);
		}
		T[p + 3] = 255;
		const cov = 1 - mn;
		C[p] = C[p + 1] = C[p + 2] = cov * 255;
		C[p + 3] = 255;
		if (cov > 0.08) { const x = i % w, y = (i / w) | 0; if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y; }
	}
	// crop to a square around what's painted
	const side = Math.max(x2 - x1, y2 - y1, 8) + 2;
	const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
	const sx = Math.max(0, Math.min(w - side, Math.round(cx - side / 2))), sy = Math.max(0, Math.min(h - side, Math.round(cy - side / 2)));
	const out = async (arr, bg) => {
		const c2 = new OffscreenCanvas(w, h);
		c2.getContext('2d').putImageData(new ImageData(arr, w, h), 0, 0);
		const sq = new OffscreenCanvas(side, side), x = sq.getContext('2d');
		x.fillStyle = bg; x.fillRect(0, 0, side, side);
		x.drawImage(c2, sx, sy, side, side, 0, 0, side, side);
		return createImageBitmap(sq);
	};
	return { trans: await out(T, '#fff'), cov: await out(C, '#000') };
}
