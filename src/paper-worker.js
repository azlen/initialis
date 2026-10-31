// The paper tile, made off the page's thread (it takes a tenth of a second at 2×, right while the
// first initials are coming in): one request, the tile back as a PNG blob.
import { paperTile } from './paper.js?v=a8136959';

self.onmessage = async ({ data: { css, dpr } }) => {
	const blob = await paperTile({ css, dpr }).convertToBlob({ type: 'image/png' });
	self.postMessage(blob);
	self.close();
};
