// Anonymous usage counts, so the field can be tuned to what people take to: what was done (picked,
// bred from, saved, downloaded, shared…) with which initial, as its settings, and nothing else. No
// cookies; the id is random, for one visit in one tab, and forgotten when the tab closes; nothing
// about who. Nothing is counted when the browser asks not to be tracked, under ?test (unless &count),
// or anywhere but the site itself. functions/api/e.js keeps them (see README, Privacy).

import { diff } from './breed.js?v=a8136959';

const HOST = /(^|\.)initialis\.azlen\.me$|\.initialis-6k5\.pages\.dev$/;
const Q = new URLSearchParams(location.search);
const on = HOST.test(location.hostname) && !navigator.globalPrivacyControl && navigator.doNotTrack !== '1' && (!Q.has('test') || Q.has('count'));

let id = null;
try { id = sessionStorage.getItem('scion:visit'); } catch { }
if (!id || !/^[a-z0-9]{10,20}$/.test(id)) {
	const a = crypto.getRandomValues(new Uint8Array(12));
	id = [...a].map(b => (b % 36).toString(36)).join('');
	try { sessionStorage.setItem('scion:visit', id); } catch { }
}

const queue = [];
let timer = 0;
// k: what happened; d: the initial (its settings are sent as their differences from the defaults),
// or the letter typed
export function count(k, d = null) {
	if (!on) return;
	queue.push([Date.now(), k, d && typeof d === 'object' ? diff(d) : d]);
	if (queue.length >= 30) flush();
	else if (!timer) timer = setTimeout(flush, 10000);
}
function flush() {
	clearTimeout(timer);
	timer = 0;
	while (queue.length) {
		const body = JSON.stringify({ s: id, e: queue.splice(0, 30) });
		try { if (!navigator.sendBeacon('/api/e', body)) fetch('/api/e', { method: 'POST', body, keepalive: true }).catch(() => { }); } catch { }
	}
}
addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
