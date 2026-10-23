import {
	buildInkCanvasDrawingFileData,
	buildInkCanvasWritingFileData,
} from 'src/components/formats/current/utils/build-file-data';
import { buildFileStr } from 'src/components/formats/current/utils/buildFileStr';
import { extractInkJsonFromSvg } from 'src/logic/utils/extractInkJsonFromSvg';
import type { InkCanvasSnapshot } from 'src/ink-canvas/types';
import type { InkFileMetadata } from 'src/components/formats/current/types/file-data';

//////////
//////////

/**
 * Field-by-field audit of the metadata round trip.
 *
 * Two rounds in a row shipped a feature that stored state in `meta` but never
 * serialised it, so the state vanished on the next save. Every field that is
 * expected to survive a reload is asserted here, one test per field, so a future
 * change to `buildFileStr` or `extractInkJsonFromSvg` fails loudly instead of
 * silently dropping data.
 *
 * Fields that are intentionally memory-only are listed in `MEMORY_ONLY` below
 * with the reason.
 */

const emptySvg = '<svg xmlns="http://www.w3.org/2000/svg"><metadata></metadata></svg>';
const snapshot: InkCanvasSnapshot = { version: 1, strokes: [], gridEnabled: false };

/** Documented as not persisted. Anything else must round-trip. */
const MEMORY_ONLY: Record<string, string> = {
	tldrawVersion: 'legacy tldraw interop marker; recomputed, never read back',
	previewIsOutdated: 'derived from stroke count vs. preview age on load',
};

function fullMeta(): InkFileMetadata {
	return {
		pluginVersion: '0.6.1',
		fileType: 'inkWriting',
		tldrawVersion: '2.0.0',
		transcript: '两行转录\n第二行',
		bboxCellsAtLastTranscription: '0,0|1,0|0,1',
		lastTranscriptionAt: '2026-02-03T04:05:06.000Z',
		transcriptEditedAt: '2026-02-03T05:00:00.000Z',
		writingLineHeight: 150,
	};
}

function roundTrip(meta: InkFileMetadata, fileType: 'inkWriting' | 'inkDrawing') {
	const builder = fileType === 'inkWriting'
		? buildInkCanvasWritingFileData
		: buildInkCanvasDrawingFileData;
	const data = builder({
		inkCanvasSnapshot: snapshot,
		svgString: emptySvg,
		transcript: meta.transcript,
		meta,
	});
	const parsed = extractInkJsonFromSvg(buildFileStr(data));
	if (!parsed) throw new Error('file did not parse back');
	return parsed.meta;
}

describe('metadata fields survive write → read', () => {
	it('pluginVersion', () => {
		expect(roundTrip(fullMeta(), 'inkWriting').pluginVersion).toBeTruthy();
	});

	it('fileType', () => {
		expect(roundTrip(fullMeta(), 'inkWriting').fileType).toBe('inkWriting');
		expect(roundTrip(fullMeta(), 'inkDrawing').fileType).toBe('inkDrawing');
	});

	it('transcript, including newlines', () => {
		expect(roundTrip(fullMeta(), 'inkWriting').transcript).toBe('两行转录\n第二行');
	});

	it('bboxCellsAtLastTranscription', () => {
		expect(roundTrip(fullMeta(), 'inkWriting').bboxCellsAtLastTranscription).toBe('0,0|1,0|0,1');
	});

	it('lastTranscriptionAt', () => {
		expect(roundTrip(fullMeta(), 'inkWriting').lastTranscriptionAt).toBe('2026-02-03T04:05:06.000Z');
	});

	it('transcriptEditedAt', () => {
		expect(roundTrip(fullMeta(), 'inkWriting').transcriptEditedAt).toBe('2026-02-03T05:00:00.000Z');
	});

	it('writingLineHeight', () => {
		expect(roundTrip(fullMeta(), 'inkWriting').writingLineHeight).toBe(150);
	});

	it('covers every declared field, so a new field cannot be forgotten', () => {
		const declared = Object.keys(fullMeta()) as Array<keyof InkFileMetadata>;
		const roundTripped = roundTrip(fullMeta(), 'inkWriting');
		const missing: string[] = [];
		for (const field of declared) {
			if (field in MEMORY_ONLY) continue;
			if (roundTripped[field] === undefined) missing.push(field);
		}
		expect(missing).toEqual([]);
	});
});
