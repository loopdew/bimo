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

const emptySvg = '<svg xmlns="http://www.w3.org/2000/svg"><metadata></metadata></svg>';
const snapshot: InkCanvasSnapshot = { version: 1, strokes: [], gridEnabled: false };

const existingMeta: InkFileMetadata = {
	pluginVersion: '0.6.1',
	tldrawVersion: '',
	fileType: 'inkWriting',
	transcript: '原件转录',
	bboxCellsAtLastTranscription: '0,0|1,0',
	lastTranscriptionAt: '2026-01-02T03:04:05.000Z',
	transcriptEditedAt: '2026-01-02T04:00:00.000Z',
};

describe('editor save preserves metadata', () => {
	it('keeps the transcription fingerprint when meta is passed through', () => {
		const data = buildInkCanvasWritingFileData({
			inkCanvasSnapshot: snapshot,
			svgString: emptySvg,
			transcript: '原件转录',
			meta: existingMeta,
		});
		expect(data.meta.bboxCellsAtLastTranscription).toBe('0,0|1,0');
		expect(data.meta.lastTranscriptionAt).toBe('2026-01-02T03:04:05.000Z');
	});

	it('keeps the user-edited flag, which gates auto-transcription', () => {
		const data = buildInkCanvasWritingFileData({
			inkCanvasSnapshot: snapshot,
			svgString: emptySvg,
			transcript: '手改过的',
			meta: existingMeta,
		});
		expect(data.meta.transcriptEditedAt).toBe('2026-01-02T04:00:00.000Z');
	});

	it('falls back to the existing transcript when none is supplied', () => {
		const data = buildInkCanvasWritingFileData({
			inkCanvasSnapshot: snapshot,
			svgString: emptySvg,
			meta: existingMeta,
		});
		expect(data.meta.transcript).toBe('原件转录');
	});

	it('lets an explicit transcript win over the stored one', () => {
		const data = buildInkCanvasWritingFileData({
			inkCanvasSnapshot: snapshot,
			svgString: emptySvg,
			transcript: '新的',
			meta: existingMeta,
		});
		expect(data.meta.transcript).toBe('新的');
	});

	it('still enforces file type and version even if meta says otherwise', () => {
		const data = buildInkCanvasDrawingFileData({
			inkCanvasSnapshot: snapshot,
			svgString: emptySvg,
			meta: { ...existingMeta, fileType: 'inkWriting' },
		});
		expect(data.meta.fileType).toBe('inkDrawing');
		expect(data.meta.pluginVersion).not.toBe('0.6.1');
	});
});

describe('metadata round-trips through the SVG file', () => {
	function roundTrip(data: ReturnType<typeof buildInkCanvasWritingFileData>) {
		const text = buildFileStr(data);
		const parsed = extractInkJsonFromSvg(text);
		if (!parsed) throw new Error('file did not parse back');
		return { text, parsed };
	}

	it('writes and reads transcript-edited-at', () => {
		const data = buildInkCanvasWritingFileData({
			inkCanvasSnapshot: snapshot,
			svgString: emptySvg,
			transcript: '手改过的',
			meta: existingMeta,
		});
		const { text, parsed } = roundTrip(data);
		expect(text).toContain('transcript-edited-at="2026-01-02T04:00:00.000Z"');
		expect(parsed.meta.transcriptEditedAt).toBe('2026-01-02T04:00:00.000Z');
	});

	it('round-trips the transcription fingerprint', () => {
		const data = buildInkCanvasWritingFileData({
			inkCanvasSnapshot: snapshot,
			svgString: emptySvg,
			transcript: 'abc',
			meta: existingMeta,
		});
		const { parsed } = roundTrip(data);
		expect(parsed.meta.bboxCellsAtLastTranscription).toBe('0,0|1,0');
		expect(parsed.meta.lastTranscriptionAt).toBe('2026-01-02T03:04:05.000Z');
	});

	it('round-trips a background page and its source PDF', () => {
		const withBackground: InkCanvasSnapshot = {
			...snapshot,
			background: { path: 'Ink/PDF/x/p3@2x.png', width: 800, height: 1000, opacity: 0.45 },
			sourcePdf: { path: '讲义/L3.pdf', page: '3' },
		};
		const data = buildInkCanvasWritingFileData({
			inkCanvasSnapshot: withBackground,
			svgString: emptySvg,
			transcript: 'abc',
			meta: existingMeta,
		});
		const { parsed } = roundTrip(data);
		expect(parsed.inkCanvas?.background?.path).toBe('Ink/PDF/x/p3@2x.png');
		expect(parsed.inkCanvas?.background?.opacity).toBe(0.45);
		expect(parsed.inkCanvas?.sourcePdf?.page).toBe('3');
	});

	it('omits the attribute entirely when the transcript was never hand-edited', () => {
		const data = buildInkCanvasWritingFileData({
			inkCanvasSnapshot: snapshot,
			svgString: emptySvg,
			transcript: 'abc',
			meta: { ...existingMeta, transcriptEditedAt: undefined },
		});
		const { text, parsed } = roundTrip(data);
		expect(text).not.toContain('transcript-edited-at');
		expect(parsed.meta.transcriptEditedAt).toBeUndefined();
	});
});
