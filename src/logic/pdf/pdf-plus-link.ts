import type { PdfRect } from './pdf-page-to-image';

//////////
//////////

export interface PdfPlusSelection {
	/** Vault path of the source PDF, exactly as written in the link. */
	pdfPath: string;
	page: number;
	/** Cropped region in PDF user space, or null for a whole-page link. */
	rect: PdfRect | null;
}

/**
 * `![[讲义.pdf#page=3&rect=100,200,300,400]]` — and the same link without the
 * leading `!` or the rect, since PDF++ emits both forms.
 *
 * The `#` fragment is parsed with `URLSearchParams` rather than a hand-written
 * pattern: PDF++ does not guarantee parameter order, and a regex would have to
 * assume `page` comes before `rect`.
 */
const LINK_PATTERN = /!?\[\[([^\]|#]+?\.pdf)#([^\]|]+)(?:\|[^\]]*)?\]\]/i;

export function parsePdfPlusSelection(text: string): PdfPlusSelection | null {
	const match = text.match(LINK_PATTERN);
	if (!match) return null;

	const pdfPath = match[1].trim();
	const params = new URLSearchParams(match[2].replace(/&amp;/g, '&'));
	const page = Number.parseInt(params.get('page') ?? '', 10);
	if (!Number.isFinite(page) || page < 1) return null;

	const rect = parseRect(params.get('rect'));
	return { pdfPath, page, rect };
}

function parseRect(raw: string | null): PdfRect | null {
	if (!raw) return null;
	const parts = raw.split(',').map((part) => Number.parseFloat(part.trim()));
	if (parts.length !== 4 || !parts.every((value) => Number.isFinite(value))) return null;
	const [x1, y1, x2, y2] = parts;
	if (x2 <= x1 || y2 <= y1) return null;
	return [x1, y1, x2, y2];
}
