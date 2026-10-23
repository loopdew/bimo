//////////
//////////

/**
 * Parses a page selection like `1-3,5` into a sorted, de-duplicated list.
 *
 * Accepts the shapes a person actually types: `3`, `1-5`, `1-3, 7, 9-10`,
 * full-width commas and dashes from a Chinese IME, and stray spaces. Anything
 * outside `1..totalPages` is dropped rather than clamped — silently turning `99`
 * into "the last page" would annotate the wrong page without saying so.
 */
export function parsePageSelection(raw: string, totalPages: number): number[] {
	if (!Number.isFinite(totalPages) || totalPages < 1) return [];

	const normalised = (raw ?? '')
		.replace(/[，、；]/g, ',')
		.replace(/[—–～~]/g, '-')
		.trim();
	if (!normalised) return [1];

	const pages = new Set<number>();

	for (const chunk of normalised.split(',')) {
		const part = chunk.trim();
		if (!part) continue;

		const rangeMatch = /^(\d+)\s*-\s*(\d+)$/.exec(part);
		if (rangeMatch) {
			const start = Number.parseInt(rangeMatch[1], 10);
			const end = Number.parseInt(rangeMatch[2], 10);
			const low = Math.min(start, end);
			const high = Math.max(start, end);
			for (let page = low; page <= high; page += 1) {
				if (page >= 1 && page <= totalPages) pages.add(page);
			}
			continue;
		}

		const singleMatch = /^\d+$/.exec(part);
		if (singleMatch) {
			const page = Number.parseInt(part, 10);
			if (page >= 1 && page <= totalPages) pages.add(page);
		}
	}

	return [...pages].sort((left, right) => left - right);
}

/** Human-readable summary used in the prompt hint. */
export function describePageSelection(pages: number[]): string {
	if (pages.length === 0) return '—';
	if (pages.length <= 4) return pages.join(', ');
	return `${pages.slice(0, 4).join(', ')} … (${pages.length})`;
}
