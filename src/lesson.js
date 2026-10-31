// Hints for a first visit, in the field instead of in words up top: a scrap of paper with a
// printer's hand pointing at where something happens, one at a time, as they come up while clicking
// around. Pick one; find more like it; wander; then, one for each initial picked after that, keep
// one, share one, see one on a page. Nothing waits for the thing to be done: each hint shows once
// and goes with the next press, and it's remembered so it never comes back. Doing the thing, or
// resting the pointer on its button for a moment (long enough to read its popover), counts as
// knowing it, and its hint is never shown.

import { drawIcon } from './icons.js?v=a8136959';
import { paperize } from './torn.js?v=a8136959';

const touch = matchMedia('(hover: none)').matches;

// app gives: store, world, aim (an initial near the middle), picked(), saved() (how many are in the
// collection), centre() (glide the picked initial to the middle) and busy(): the screen rects to keep off
export function lesson(app) {
	const STEPS = [
		// an initial near the middle, the hand at its left
		{ id: 'pick', delay: 1600, met: () => !!app.picked(), when: () => !!app.aim(160), say: touch ? 'tap one' : 'click one',
			place(el) { const c = app.aim(el.offsetWidth + 30); if (!c) return false; at(el, c.x - el.offsetWidth - 2, c.y - el.offsetHeight / 2); return true; } },
		// beside more like this (or under it, where there's no room beside), pointing at it
		{ id: 'breed', delay: 700, tag: true, centre: true, when: () => tagUp(), say: 'find more like it', sub: touch ? 'or double-tap the initial' : 'or double-click the initial',
			place: el => pointAt(el, '#vary', ['beside', 'before', 'under']) },
		// once a new field has grown round it: low down, clear of the initial in the middle and its tag,
		// the hand swaying side to side
		{ id: 'drag', delay: 2600, when: () => true, fixed: true, dir: 'sway', say: 'drag to wander', sub: 'it goes on in every direction',
			place(el) {
				const c = document.querySelector('#collection'), floor = c && !c.hidden ? c.getBoundingClientRect().top : innerHeight - 14;
				const x = (innerWidth - el.offsetWidth) / 2, w = el.offsetWidth, h = el.offsetHeight;
				// above the collection, or under the bar if the picked initial's tag is down there
				const clear = y => !app.busy().some(r => r.right > x && r.left < x + w && r.bottom > y && r.top < y + h);
				const low = floor - h - 26, high = document.querySelector('#nav').getBoundingClientRect().bottom + 24;
				at(el, x, clear(low) || !clear(high) ? low : high);
				return true;
			} },
		// then, one for each initial picked: the bookmark, share, the page
		{ id: 'save', delay: 900, tag: true, centre: true, met: () => app.saved() > 0, when: () => tagUp(), say: 'keep it', sub: 'it joins your collection along the bottom',
			place: el => pointAt(el, '#save', ['before', 'under', 'beside']) },
		{ id: 'share', delay: 900, tag: true, centre: true, when: () => tagUp(), say: 'send it to someone', sub: 'or paste in any agent chat', fine: 'they’ll know what to do ;)',
			place: el => pointAt(el, '#share', ['beside', 'over', 'before']) },
		{ id: 'context', delay: 900, tag: true, centre: true, when: () => tagUp(), say: 'see it on a page', sub: 'set as the opening of a printed book',
			place: el => pointAt(el, '#incontext', ['before', 'over', 'beside']) },
		// once there are a few in the collection: the bookmark at its start opens them all
		{ id: 'collection', delay: 1500, fixed: true, when: () => app.saved() >= 2 && !document.querySelector('#collection').hidden,
			say: 'see them all', sub: 'to share or download them together', place: el => pointAt(el, '#collection .mark', ['over', 'beside']) },
	];
	const tagUp = () => !document.querySelector('#tag').hidden;

	// a scrap at target (a scrap on the tag), in the first of the sides that fits on screen: beside it
	// (to its right, the hand pointing back), before it (to its left), under it or over it (the hand
	// pointing up or down at its middle). Widths are worked out from the words, so the scrap never
	// has to be laid out twice to find out.
	const LAYOUT = { beside: 'left', before: '', under: 'up', over: 'down' };
	function pointAt(el, sel, sides) {
		const t = document.querySelector(sel);
		if (!t || !t.offsetWidth) return false;
		// a hint in the field moves with it; one on the screen's own furniture (fixed) stays put
		const o = el.classList.contains('fixed') ? { left: 0, top: 0 } : app.world.getBoundingClientRect(), r = t.getBoundingClientRect();
		const T = el.querySelector('.say').offsetWidth, sayH = el.querySelector('.say').offsetHeight, rowW = T + 67, colW = Math.max(T, 40) + 26, rowH = Math.max(50, sayH + 15), colH = 34 + sayH + 20;
		const cy = (r.top + r.bottom) / 2, cx = (r.left + r.right) / 2, m = 10;
		const fits = {
			beside: () => r.right + 6 + rowW < innerWidth - m && [r.right + 6, cy - rowH / 2],
			before: () => r.left - 6 - rowW > m && [r.left - 6 - rowW, cy - rowH / 2],
			under: () => r.bottom + 8 + colH < innerHeight - m && [Math.max(m, Math.min(innerWidth - m - colW, cx - 30)), r.bottom + 8],
			over: () => r.top - 8 - colH > m && [Math.max(m, Math.min(innerWidth - m - colW, cx - 30)), r.top - 8 - colH],
		};
		const side = sides.find(k => fits[k]()) || sides[sides.length - 1], [x, y] = fits[side]() || fits.under() || [cx - 30, r.bottom + 8];
		const cls = LAYOUT[side];
		for (const c of ['left', 'up', 'down']) if (el.classList.contains(c) !== (c === cls)) el.classList.toggle(c, c === cls);
		// up and down: the hand over the target's middle
		el.querySelector('.hand').style.marginLeft = side === 'under' || side === 'over' ? cx - x - 12 - 17 + 'px' : '';
		at(el, x - o.left, y - o.top);
		return true;
	}
	let done;
	try { done = new Set(JSON.parse(app.store.get('scion:lesson') || '[]')); } catch { done = new Set(); }
	// shown: the hint up now ({ step, el, at, pick }); lastTag: the initial the last tag hint was
	// shown on (one hint per initial picked); hidAt: when the last one went, so they don't follow
	// each other straight off
	let shown = null, wanting = null, since = 0, timer = 0, centred = null, lastTag = null, hidAt = -1e9;
	const GAP = 1200, SEEN = 700, KNOWS = 1200;
	const save = () => app.store.set('scion:lesson', JSON.stringify([...done]));

	const at = (el, x, y) => { el.style.left = Math.round(x) + 'px'; el.style.top = Math.round(y) + 'px'; };
	function show(s) {
		const el = document.createElement('div');
		el.className = 'lesson' + (s.fixed ? ' fixed' : '') + (s.dir ? ' ' + s.dir : '');
		el.style.setProperty('--tilt', (s.id.length % 3 - 1) * 0.9 + 'deg');
		const hand = drawIcon('point', 34, { seed: 3 });
		hand.className = 'hand';
		const say = document.createElement('span');
		say.className = 'say';
		say.innerHTML = `<b></b>${s.sub ? '<small></small>' : ''}${s.fine ? '<small class="fine"></small>' : ''}`;
		say.querySelector('b').textContent = s.say;
		if (s.sub) say.querySelector('small').textContent = s.sub;
		if (s.fine) say.querySelector('.fine').textContent = s.fine;
		el.append(hand, say);
		(s.fixed ? document.body : app.world).append(el);
		paperize(el, { color: '#fbf8f1', edges: { top: 'torn', right: 'deckle', bottom: 'torn', left: 'torn' }, seed: 80 + s.id.length, fibres: 0.4 });
		shown = { step: s, el, at: performance.now(), pick: app.picked() };
		if (!s.place(el)) { el.remove(); shown = null; return; }
		if (s.tag) lastTag = shown.pick;
	}
	// a hint that was up long enough to be read counts as seen
	function hide() {
		if (!shown) return;
		const { el, step, at } = shown;
		shown = null;
		hidAt = performance.now();
		if (hidAt - at > SEEN && !done.has(step.id)) { done.add(step.id); save(); }
		el.classList.add('going');
		setTimeout(() => el.remove(), 260);
	}
	// the hint due: the first not yet seen that fits what's on screen now, once it has fitted for its
	// delay (and a moment has passed since the last one went)
	function tick() {
		for (const s of STEPS) if (!done.has(s.id) && s.met && s.met()) { done.add(s.id); save(); }
		// nothing while something covers the field (the collection's page): put away, not seen
		if (app.quiet && app.quiet()) {
			if (shown) { shown.el.remove(); shown = null; }
			clearTimeout(timer);
			wanting = null;
			return;
		}
		if (shown) {
			const s = shown.step;
			if (done.has(s.id) || !s.when() || (s.tag && app.picked() !== shown.pick) || !s.place(shown.el)) hide();
			else { recentre(s); return; }
		}
		const now = performance.now();
		const want = STEPS.find(s => !done.has(s.id) && s.when() && !(s.tag && app.picked() === lastTag)) || null;
		if (want !== wanting) { wanting = want; since = now; }
		clearTimeout(timer);
		if (!want) return;
		const wait = Math.max(want.delay - (now - since), GAP - (now - hidAt));
		if (wait > 0) { timer = setTimeout(tick, wait + 20); return; }
		show(want);
		if (shown) recentre(want);
	}
	// a hint about the tag, once for each initial picked: if the initial or its scraps run off the
	// screen, the view glides it to the middle so the hint can't land off screen either
	function recentre(s) {
		if (!s.centre || !app.centre) return;
		const key = s.id + ':' + app.picked();
		if (key !== centred) { centred = key; app.centre(); }
	}
	function did(id) {
		if (done.has(id)) return;
		done.add(id);
		save();
		// the next one waits its own delay from now
		wanting = null;
		tick();
	}
	// the next press anywhere puts the hint away (once it's been up a moment)
	addEventListener('pointerdown', () => { if (shown && performance.now() - shown.at > SEEN) { hide(); tick(); } }, true);
	// resting the mouse on a button its hint is about, for a moment: that one's known
	const KNOWN = { '#vary': 'breed', '#save': 'save', '#share': 'share', '#incontext': 'context', '#collection .mark': 'collection' };
	let over = null, overT = 0;
	addEventListener('pointerover', (e) => {
		if (e.pointerType !== 'mouse' || !e.target.closest) return;
		const sel = Object.keys(KNOWN).find(k => e.target.closest(k)), el = sel && e.target.closest(sel);
		if (el === over) return;
		clearTimeout(overT);
		over = el;
		if (el) overT = setTimeout(() => did(KNOWN[sel]), KNOWS);
	});
	addEventListener('pointerout', (e) => { if (over && !over.contains(e.relatedTarget)) { clearTimeout(overT); over = null; } });
	// the field settles without anything calling: look again now and then, until it's all been seen
	const every = setInterval(() => { if (STEPS.every(s => done.has(s.id))) clearInterval(every); else tick(); }, 400);
	return { tick, did };
}
