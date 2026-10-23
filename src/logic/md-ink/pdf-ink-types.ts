import type { InkPoint, InkStrokeStyle } from 'src/ink-canvas/types';

///////////////////////////
///////////////////////////

/**
 * 笔墨 painted on a PDF page inside Obsidian's viewer.
 *
 * Coordinates are normalised to the page box (0–1) instead of pixels, and so is
 * the stroke size. Zooming, resizing the pane or opening the same PDF on a
 * different screen all resolve to the same picture — a stored pixel would drift
 * the moment the page is rendered at another scale.
 */
export interface PdfInkStroke {
	id: string;
	/** x and y in 0–1 of the page box; pressure unchanged. */
	points: InkPoint[];
	/** `size` is normalised the same way as the points. */
	style: InkStrokeStyle;
	/** 1-based page number, as pdf.js reports it. */
	page: number;
	createdAt: number;
}

export interface PdfInkDocument {
	version: 1;
	/** Vault-relative path of the annotated PDF. */
	pdfPath: string;
	strokes: PdfInkStroke[];
	updatedAt: number;
}

export function createEmptyPdfInkDocument(pdfPath: string): PdfInkDocument {
	return { version: 1, pdfPath, strokes: [], updatedAt: Date.now() };
}

/** Fold a pixel-space stroke into page-relative space. */
export function toPageSpace(
	points: InkPoint[],
	width: number,
	height: number,
): InkPoint[] {
	if (width <= 0 || height <= 0) return [];
	return points.map(([x, y, p]) => [x / width, y / height, p] as InkPoint);
}

/** Inverse of {@link toPageSpace}, at whatever size the page currently is. */
export function fromPageSpace(
	points: InkPoint[],
	width: number,
	height: number,
): InkPoint[] {
	return points.map(([x, y, p]) => [x * width, y * height, p] as InkPoint);
}
