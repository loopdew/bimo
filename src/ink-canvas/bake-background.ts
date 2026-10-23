import { Notice, TFile, type App } from 'obsidian';
import { t } from 'src/i18n';
import type { InkCanvasBackground } from './types';
import type { BakedBackground } from './svg-export';

//////////
//////////

/**
 * Longest side kept when re-encoding a page image.
 *
 * A 300 DPI A4 page is ~2500×3500; embedding that as base64 produces a multi-
 * megabyte SVG that slows every autosave. 1400 px keeps printed text legible at
 * normal reading zoom while holding the file to a few hundred kilobytes.
 */
const MAX_PAGE_WIDTH_PX = 1400;

/** JPEG keeps page photos small; transparency is flattened onto white first. */
const JPEG_QUALITY = 0.82;

/** Bounded cache: one entry per (path, mtime) so an edited image re-bakes. */
const CACHE_LIMIT = 8;
const cache = new Map<string, BakedBackground>();

/**
 * Paths already reported as unreadable.
 *
 * A missing page image fails on every save; without this the user would get one
 * notice per keystroke. One notice per path per session is enough to tell them
 * the background is gone, and failures are not cached so a file that arrives
 * later (sync still running) starts working without a reload.
 */
const warnedPaths = new Set<string>();

function warnBackgroundUnreadable(vaultPath: string): void {
	if (warnedPaths.has(vaultPath)) return;
	warnedPaths.add(vaultPath);
	new Notice(t('Page image could not be loaded; saving without it.') + `\n${vaultPath}`, 6000);
}

interface RasterisedPage {
	dataUrl: string;
	/** Intrinsic aspect ratio of the source image, after downscaling. */
	aspectRatio: number;
}

function evictOldest(): void {
	while (cache.size >= CACHE_LIMIT) {
		const oldestKey = cache.keys().next().value;
		if (oldestKey === undefined) return;
		cache.delete(oldestKey);
	}
}

async function decodeBitmap(bytes: ArrayBuffer): Promise<ImageBitmap | HTMLImageElement | null> {
	const blob = new Blob([bytes]);
	try {
		return await createImageBitmap(blob);
	} catch {
		// Fallback for webviews without createImageBitmap.
		return await new Promise<HTMLImageElement | null>((resolve) => {
			const url = URL.createObjectURL(blob);
			const image = new Image();
			image.onload = () => {
				URL.revokeObjectURL(url);
				resolve(image);
			};
			image.onerror = () => {
				URL.revokeObjectURL(url);
				resolve(null);
			};
			image.src = url;
		});
	}
}

function imageSize(source: ImageBitmap | HTMLImageElement): { width: number; height: number } {
	if ('naturalWidth' in source) {
		return { width: source.naturalWidth, height: source.naturalHeight };
	}
	return { width: source.width, height: source.height };
}

async function rasterise(app: App, vaultPath: string): Promise<RasterisedPage | null> {
	const file = app.vault.getAbstractFileByPath(vaultPath);
	if (!(file instanceof TFile)) return null;

	let bytes: ArrayBuffer;
	try {
		bytes = await app.vault.readBinary(file);
	} catch {
		return null;
	}

	const source = await decodeBitmap(bytes);
	if (!source) return null;

	const { width: sourceWidth, height: sourceHeight } = imageSize(source);
	if (sourceWidth <= 0 || sourceHeight <= 0) return null;

	const scale = Math.min(1, MAX_PAGE_WIDTH_PX / sourceWidth);
	const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
	const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

	const canvas = document.createElement('canvas');
	canvas.width = targetWidth;
	canvas.height = targetHeight;
	const context = canvas.getContext('2d');
	if (!context) return null;

	// Flatten onto white: a transparent PNG would otherwise encode as black.
	context.fillStyle = '#ffffff';
	context.fillRect(0, 0, targetWidth, targetHeight);
	context.imageSmoothingQuality = 'high';
	context.drawImage(source as CanvasImageSource, 0, 0, targetWidth, targetHeight);

	if ('close' in source && typeof source.close === 'function') source.close();

	return {
		dataUrl: canvas.toDataURL('image/jpeg', JPEG_QUALITY),
		aspectRatio: sourceHeight / sourceWidth,
	};
}

/**
 * Produces the `<image>` markup for a page background, ready to be spliced into
 * a saved SVG.
 *
 * `displayWidth` is the width the caller wants in canvas units (the writing page
 * width in writing mode, the source width in drawing mode). Returns `undefined`
 * when the image cannot be read — a broken background must never fail a save.
 */
export async function bakeBackgroundForSvg(
	app: App,
	background: InkCanvasBackground,
	displayWidth: number,
): Promise<BakedBackground | undefined> {
	const file = app.vault.getAbstractFileByPath(background.path);
	const mtime = file && 'stat' in file ? (file as { stat?: { mtime?: number } }).stat?.mtime ?? 0 : 0;
	const cacheKey = `${background.path}|${mtime}|${Math.round(displayWidth)}`;

	const cached = cache.get(cacheKey);
	if (cached) {
		return cached;
	}

	try {
		const page = await rasterise(app, background.path);
		if (!page) {
			warnBackgroundUnreadable(background.path);
			return undefined;
		}

		const width = displayWidth > 0 ? displayWidth : MAX_PAGE_WIDTH_PX;
		const height = width * page.aspectRatio;
		const opacity = typeof background.opacity === 'number' && background.opacity < 1
			? ` opacity="${Math.max(0, Math.min(1, background.opacity)).toFixed(3)}"`
			: '';

		const baked: BakedBackground = {
			markup: `<image href="${page.dataUrl}" x="0" y="0" width="${width}" height="${height.toFixed(2)}" preserveAspectRatio="xMidYMin meet"${opacity} />\n`,
			width,
			height,
		};

		evictOldest();
		cache.set(cacheKey, baked);
		return baked;
	} catch (error) {
		console.debug('笔墨: could not bake background image', error);
		warnBackgroundUnreadable(background.path);
		return undefined;
	}
}

/** Drops the cache entry for a path, e.g. after the user replaces the image. */
export function invalidateBakedBackground(vaultPath: string): void {
	for (const key of [...cache.keys()]) {
		if (key.startsWith(`${vaultPath}|`)) cache.delete(key);
	}
}
