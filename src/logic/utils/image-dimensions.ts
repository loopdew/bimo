import type { App } from 'obsidian';

//////////
//////////

export interface ImageDimensions {
	width: number;
	height: number;
}

/**
 * Reads pixel dimensions of a vault image.
 *
 * Needed because the background layer stores the source aspect ratio: without it
 * the page would be stretched to the writing page width and printed text would
 * look wrong. Resolves `null` when the image cannot be decoded (corrupt file,
 * unsupported format) so the caller can refuse instead of storing a bad ratio.
 */
export function readImageDimensions(app: App, vaultPath: string): Promise<ImageDimensions | null> {
	return new Promise((resolve) => {
		let url: string;
		try {
			url = app.vault.adapter.getResourcePath(vaultPath);
		} catch {
			resolve(null);
			return;
		}

		const image = new Image();
		let settled = false;
		const finish = (value: ImageDimensions | null) => {
			if (settled) return;
			settled = true;
			resolve(value);
		};

		image.onload = () => {
			finish(
				image.naturalWidth > 0 && image.naturalHeight > 0
					? { width: image.naturalWidth, height: image.naturalHeight }
					: null,
			);
		};
		image.onerror = () => finish(null);
		image.src = url;

		// A hung decode must not leave the command waiting forever.
		window.setTimeout(() => finish(null), 8000);
	});
}
