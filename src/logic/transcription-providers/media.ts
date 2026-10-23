import { stripWritingSvgToVisualOnly } from 'src/logic/utils/strip-writing-svg-to-visual-only';
import {
	bakeOpaqueWritingBackground,
	resolveWritingSvgPageTheme,
	transcriptionBackgroundForTheme,
	writingSvgToPngBase64,
} from 'src/logic/utils/writing-svg-to-png-base64';

import type { TranscriptionMediaFormat } from './types';

//////////
//////////

export interface ProviderMedia {
	mediaType: 'image/png' | 'image/svg+xml';
	mediaBase64: string;
}

export interface PrepareProviderMediaOptions {
	/** Injectable for tests — skips Canvg rasterization. */
	pngBase64?: string;
	createCanvas?: () => HTMLCanvasElement;
}

/** UTF-8 SVG string → base64 without a data-URI prefix. */
function encodeUtf8TextToBase64(text: string): string {
	if (typeof Buffer !== 'undefined') {
		return Buffer.from(text, 'utf8').toString('base64');
	}
	const bytes = new TextEncoder().encode(text);
	// Chunked rather than a per-byte `binary += String.fromCharCode(byte)`.
	// That loop is O(n²) on engines that copy the string each time, and a writing
	// SVG carrying a full page of strokes is several megabytes — the difference
	// is imperceptible on desktop and a visible freeze on a tablet.
	// 8 KB keeps the spread argument list well under any engine's stack limit.
	const CHUNK = 0x2000;
	const parts: string[] = [];
	for (let offset = 0; offset < bytes.length; offset += CHUNK) {
		parts.push(String.fromCharCode(...bytes.subarray(offset, offset + CHUNK)));
	}
	return btoa(parts.join(''));
}

/**
 * Turns a full 笔墨 writing SVG file into the payload an OpenAI-style endpoint
 * accepts. The visual-only SVG keeps an opaque theme-aware page so ink/paper
 * contrast survives (dark ink → white page, light ink → black page).
 *
 * `png` rasterises through Canvg; this is required for the official OpenAI API,
 * which rejects `image/svg+xml` as an image input.
 */
export async function prepareProviderMedia(
	writingSvgFileContent: string,
	format: TranscriptionMediaFormat,
	options?: PrepareProviderMediaOptions,
): Promise<ProviderMedia> {
	const visualSvg = stripWritingSvgToVisualOnly(writingSvgFileContent);
	const background = transcriptionBackgroundForTheme(resolveWritingSvgPageTheme(visualSvg));
	const svgWithPage = bakeOpaqueWritingBackground(visualSvg, background);

	if (format === 'svg') {
		return { mediaType: 'image/svg+xml', mediaBase64: encodeUtf8TextToBase64(svgWithPage) };
	}

	const pngBase64 = options?.pngBase64
		?? await writingSvgToPngBase64(visualSvg, { createCanvas: options?.createCanvas });
	if (!pngBase64) {
		throw new Error('Failed to rasterize writing SVG to PNG');
	}
	return { mediaType: 'image/png', mediaBase64: pngBase64 };
}
