// A zip with nothing compressed (the pictures and the video are compressed already): enough to hand
// over an initial's files as one download. files: [{ name, data: Blob | string | Uint8Array }]

const TABLE = new Uint32Array(256).map((_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});
function crc32(b) {
	let c = 0xffffffff;
	for (let i = 0; i < b.length; i++) c = TABLE[(c ^ b[i]) & 255] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

export async function zip(files) {
	const enc = new TextEncoder(), parts = [], dir = [];
	const d = new Date();
	const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
	const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
	let off = 0;
	for (const f of files) {
		const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data instanceof Blob ? new Uint8Array(await f.data.arrayBuffer()) : f.data;
		const name = enc.encode(f.name), crc = crc32(data);
		// the local header, then the file
		const head = new DataView(new ArrayBuffer(30));
		head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(6, 0x0800, true); // names in UTF-8
		head.setUint16(10, time, true); head.setUint16(12, date, true);
		head.setUint32(14, crc, true); head.setUint32(18, data.length, true); head.setUint32(22, data.length, true);
		head.setUint16(26, name.length, true);
		parts.push(head, name, data);
		// its entry in the directory at the end
		const cen = new DataView(new ArrayBuffer(46));
		cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
		cen.setUint16(12, time, true); cen.setUint16(14, date, true);
		cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true);
		cen.setUint16(28, name.length, true);
		cen.setUint32(42, off, true);
		dir.push(cen, name);
		off += 30 + name.length + data.length;
	}
	const size = dir.reduce((n, p) => n + p.byteLength, 0);
	const end = new DataView(new ArrayBuffer(22));
	end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
	end.setUint32(12, size, true); end.setUint32(16, off, true);
	return new Blob([...parts, ...dir, end], { type: 'application/zip' });
}
