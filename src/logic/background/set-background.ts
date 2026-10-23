import { Notice, TFile } from 'obsidian';
import InkPlugin from 'src/main';
import { t } from 'src/i18n';
import { extractInkJsonFromSvg } from 'src/logic/utils/extractInkJsonFromSvg';
import { buildFileStr } from 'src/components/formats/current/utils/buildFileStr';
import { readImageDimensions } from 'src/logic/utils/image-dimensions';
import { applyBackgroundToOpenEditors } from 'src/logic/ink-editor-registry';
import { invalidateBakedBackground } from 'src/ink-canvas/bake-background';
import type { InkCanvasBackground } from 'src/ink-canvas/types';

//////////
//////////

export type SetBackgroundResult =
	| { ok: true; background: InkCanvasBackground | null }
	| { ok: false; reason: string };

/**
 * Sets, replaces, or clears the page image under an ink file's strokes.
 *
 * Only the metadata block is rewritten (`buildFileStr` keeps the rendered path
 * markup untouched), so this is cheap even on a long page and cannot damage
 * existing ink. The mtime is preserved so a background change does not look like
 * a content edit to sync.
 *
 * Open editors showing this file are updated in place, so the new page appears
 * immediately instead of after a remount.
 */
export async function setInkFileBackground(
	plugin: InkPlugin,
	inkFile: TFile,
	image: TFile | null,
	/** Set when the background came from a PDF page, so the block can link back. */
	sourcePdf?: { path: string; page: string | null },
): Promise<SetBackgroundResult> {
	try {
		const svg = await plugin.app.vault.read(inkFile);
		const pageData = extractInkJsonFromSvg(svg);
		if (!pageData || !pageData.inkCanvas) {
			return { ok: false, reason: t('This file does not use the current ink-canvas format.') };
		}

		const previousPath = pageData.inkCanvas.background?.path;

		if (!image) {
			if (!pageData.inkCanvas.background && !pageData.inkCanvas.sourcePdf) {
				return { ok: true, background: null };
			}
			delete pageData.inkCanvas.background;
		} else {
			const dimensions = await readImageDimensions(plugin.app, image.path);
			if (!dimensions) {
				return { ok: false, reason: t('Could not read that image.') };
			}
			pageData.inkCanvas.background = {
				path: image.path,
				width: dimensions.width,
				height: dimensions.height,
				opacity: 1,
			};
		}

		if (sourcePdf) {
			pageData.inkCanvas.sourcePdf = sourcePdf;
		} else if (!image) {
			// Clearing the page image clears its provenance too.
			delete pageData.inkCanvas.sourcePdf;
		}

		const nextBackground = pageData.inkCanvas.background ?? null;

		await plugin.app.vault.modify(inkFile, buildFileStr(pageData), { mtime: inkFile.stat.mtime });

		// A replaced image must re-bake; the cache is keyed by path+mtime and the
		// old entry would otherwise keep serving the previous page.
		if (previousPath && previousPath !== nextBackground?.path) {
			invalidateBakedBackground(previousPath);
		}
		if (nextBackground) invalidateBakedBackground(nextBackground.path);

		applyBackgroundToOpenEditors(inkFile.path, nextBackground);

		return { ok: true, background: nextBackground };
	} catch (error) {
		console.debug('笔墨: could not set background', error);
		return { ok: false, reason: t('Could not update this file.') };
	}
}

/** Convenience wrapper that reports through a Notice. */
export async function setInkFileBackgroundWithNotice(
	plugin: InkPlugin,
	inkFile: TFile,
	image: TFile | null,
	sourcePdf?: { path: string; page: string | null },
): Promise<void> {
	const result = await setInkFileBackground(plugin, inkFile, image, sourcePdf);
	if (!result.ok) {
		new Notice(result.reason);
		return;
	}
	new Notice(image ? t('Background set') : t('Background removed'));
}

/**
 * Opacity levels the "fade page image" action cycles through.
 *
 * Fading matters for annotation: a dense printed page and hand ink compete for
 * the same contrast, and dropping the page to ~45% is usually what makes the
 * writing read as "on top of" the text instead of tangled with it.
 */
export const BACKGROUND_OPACITY_STEPS = [1, 0.7, 0.45, 0.25] as const;

export type CycleOpacityResult =
	| { ok: true; opacity: number }
	| { ok: false; reason: string };

/**
 * Steps the page image to the next dimmer level, wrapping back to full.
 *
 * Rewrites only the metadata, and pushes the change into any open editor so the
 * effect is visible immediately.
 */
export async function cycleBackgroundOpacity(
	plugin: InkPlugin,
	inkFile: TFile,
): Promise<CycleOpacityResult> {
	try {
		const svg = await plugin.app.vault.read(inkFile);
		const pageData = extractInkJsonFromSvg(svg);
		const background = pageData?.inkCanvas?.background;
		if (!pageData?.inkCanvas || !background) {
			return { ok: false, reason: t('This block has no page image.') };
		}

		const current = typeof background.opacity === 'number' ? background.opacity : 1;
		const currentIndex = BACKGROUND_OPACITY_STEPS.findIndex((step) => Math.abs(step - current) < 0.01);
		const nextIndex = currentIndex === -1 ? 1 : (currentIndex + 1) % BACKGROUND_OPACITY_STEPS.length;
		const nextOpacity = BACKGROUND_OPACITY_STEPS[nextIndex];

		background.opacity = nextOpacity;
		await plugin.app.vault.modify(inkFile, buildFileStr(pageData), { mtime: inkFile.stat.mtime });

		// Opacity is part of the baked markup, so the cached image must be rebuilt.
		invalidateBakedBackground(background.path);
		applyBackgroundToOpenEditors(inkFile.path, background);

		return { ok: true, opacity: nextOpacity };
	} catch (error) {
		console.debug('笔墨: could not change background opacity', error);
		return { ok: false, reason: t('Could not update this file.') };
	}
}
