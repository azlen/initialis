// Popovers in place of the browser's title tooltips: a scrap of paper with a few words under (or
// over) whatever has a data-tip, once the pointer has rested on it a moment. Moving straight on to
// the next one shows its words at once; pressing anything, scrolling or dragging puts it away.
// Mouse only: on touch there is nothing to rest on.

import { paperize } from './torn.js?v=a8136959';

const DELAY = 350, WARM = 400;
const tip = document.createElement('div');
tip.id = 'tip';
tip.setAttribute('role', 'tooltip');
const words = document.createElement('span');
tip.append(words);
document.body.append(tip);
let paper = null, over = null, timer = 0, hidAt = 0;

function place(el) {
	const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight, m = 8;
	const below = r.bottom + m + h < innerHeight - 6;
	tip.style.left = Math.round(Math.max(6, Math.min(innerWidth - w - 6, r.left + r.width / 2 - w / 2))) + 'px';
	tip.style.top = Math.round(below ? r.bottom + m : r.top - m - h) + 'px';
}
function show(el) {
	if (!el.isConnected || !el.dataset.tip) return;
	words.textContent = el.dataset.tip;
	tip.classList.add('on');
	if (!paper) paper = paperize(tip, { color: '#fbf8f1', edges: { top: 'torn', right: 'torn', bottom: 'torn', left: 'deckle' }, seed: 91, fibres: 0.3 });
	place(el);
}
function hide() {
	clearTimeout(timer);
	if (tip.classList.contains('on')) hidAt = performance.now();
	tip.classList.remove('on');
	over = null;
}

addEventListener('pointerover', (e) => {
	if (e.pointerType !== 'mouse') return;
	const el = e.target.closest && e.target.closest('[data-tip]');
	if (el === over) return;
	hide();
	if (!el) return;
	over = el;
	timer = setTimeout(() => show(el), performance.now() - hidAt < WARM ? 0 : DELAY);
});
addEventListener('pointerout', (e) => {
	if (over && !over.contains(e.relatedTarget)) hide();
});
addEventListener('pointerdown', hide, true);
addEventListener('wheel', hide, { passive: true, capture: true });
addEventListener('keydown', hide, true);

// for words that change while they're showing (saved / not saved)
export function retip(el, text) {
	el.dataset.tip = text;
	if (over === el && tip.classList.contains('on')) { words.textContent = text; place(el); }
}
