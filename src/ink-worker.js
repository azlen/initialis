// Works out when the ink reaches each point of an arriving initial (inking.js maskTimes) off the
// page's thread: the bitmap comes in, and goes back with its times.
import { maskTimes } from './inking.js?v=a8136959';

self.onmessage = (e) => {
	const { id, bitmap, rect, wave } = e.data;
	try {
		const { T, lo, hi } = maskTimes(bitmap, rect, wave);
		self.postMessage({ id, bitmap, T, lo, hi }, [bitmap, T.buffer]);
	} catch (err) {
		// the picture still goes back, or its place would stay empty
		console.warn(err);
		self.postMessage({ id, bitmap }, [bitmap]);
	}
};
