import type InkPlugin from 'src/main';
import type { TFile } from 'obsidian';
import { buildInkCanvasWritingFileData } from 'src/components/formats/current/utils/build-file-data';
import { buildFileStr } from 'src/components/formats/current/utils/buildFileStr';
import { extractInkJsonFromSvg } from 'src/logic/utils/extractInkJsonFromSvg';
import { saveWriteFileTranscript } from 'src/components/formats/current/utils/needsTranscriptUpdate';
import type { InkCanvasSnapshot } from 'src/ink-canvas/types';
import type { InkFileMetadata } from 'src/components/formats/current/types/file-data';

//////////
//////////

/**
 * End-to-end data lifecycle against an in-memory vault.
 *
 * Rounds 5–7 each shipped a bug where the in-memory object was correct but the
 * file on disk was not: the background image, the user-edit flag, and the line
 * height were all dropped by one of the read/write layers. Unit tests on each
 * layer could not catch that, because each layer was individually "correct".
 *
 * This test drives the real sequence a user produces — open, draw, save,
 * transcribe, save again — through the real serialisers, and asserts on what the
 * file actually contains afterwards.
 */

jest.mock('src/logic/ink-editor-registry', () => ({
	applyBackgroundToOpenEditors: jest.fn(),
	registerInkEditorForPath: jest.fn(() => () => {}),
}));

jest.mock('src/ink-canvas/bake-background', () => ({
	invalidateBakedBackground: jest.fn(),
	bakeBackgroundForSvg: jest.fn(async () => undefined),
}));

jest.mock('src/logic/utils/image-dimensions', () => ({
	readImageDimensions: jest.fn(async () => ({ width: 800, height: 1000 })),
}));

const FILE_PATH = 'Ink/Writing/test.svg';
const emptySvg = '<svg xmlns="http://www.w3.org/2000/svg"><metadata></metadata></svg>';

interface FakeVault {
	files: Map<string, string>;
	plugin: InkPlugin;
	file: TFile;
}

function createFakeVault(): FakeVault {
	const files = new Map<string, string>();
	const file = {
		path: FILE_PATH,
		// `saveWriteFileTranscript` preserves mtime so a transcript write does not
		// look like a content edit to sync.
		stat: { mtime: 0, ctime: 0, size: 0 },
	} as unknown as TFile;

	const vault = {
		read: async (target: TFile) => {
			const content = files.get(target.path);
			if (content === undefined) throw new Error(`missing file: ${target.path}`);
			return content;
		},
		modify: async (target: TFile, data: string) => {
			files.set(target.path, data);
		},
		getAbstractFileByPath: (path: string) => (files.has(path) ? { path } : null),
	};

	const plugin = { app: { vault } } as unknown as InkPlugin;
	return { files, plugin, file };
}

function readFile(vault: FakeVault) {
	const svg = vault.files.get(FILE_PATH);
	if (!svg) throw new Error('file vanished');
	const data = extractInkJsonFromSvg(svg);
	if (!data) throw new Error('file did not parse');
	return data;
}

/**
 * Mirrors what an editor save does: take the live snapshot, carry the metadata
 * that was loaded earlier, rebuild the file string.
 */
function simulateEditorSave(
	vault: FakeVault,
	snapshot: InkCanvasSnapshot,
	meta: InkFileMetadata | undefined,
	transcript: string | undefined,
): void {
	const current = readFile(vault);
	vault.files.set(FILE_PATH, buildFileStr(buildInkCanvasWritingFileData({
		inkCanvasSnapshot: snapshot,
		svgString: current.svgString || emptySvg,
		transcript,
		meta,
	})));
}

function seedFile(vault: FakeVault): InkCanvasSnapshot {
	const snapshot: InkCanvasSnapshot = {
		version: 1,
		strokes: [],
		gridEnabled: false,
		writingLineHeight: 150,
	};
	vault.files.set(FILE_PATH, buildFileStr(buildInkCanvasWritingFileData({
		inkCanvasSnapshot: snapshot,
		svgString: emptySvg,
		meta: { writingLineHeight: 150 },
	})));
	return snapshot;
}

//////////
//////////

describe('ink file lifecycle', () => {
	it('survives a full open → background → save → transcribe → save cycle', async () => {
		const vault = createFakeVault();
		let snapshot = seedFile(vault);

		// 1. A freshly created file carries its line height in both places.
		expect(readFile(vault).meta.writingLineHeight).toBe(150);

		// 2. "Set page image" writes metadata only.
		{
			const current = readFile(vault);
			current.inkCanvas!.background = {
				path: 'Ink/PDF/abc/p1@2x.png',
				width: 800,
				height: 1000,
				opacity: 1,
			};
			current.inkCanvas!.sourcePdf = { path: '讲义/L1.pdf', page: '1' };
			vault.files.set(FILE_PATH, buildFileStr(current));
		}
		snapshot = readFile(vault).inkCanvas!;
		expect(snapshot.background?.path).toBe('Ink/PDF/abc/p1@2x.png');

		// 3. The user draws a stroke: snapshot now comes from the live editor.
		snapshot = {
			...snapshot,
			strokes: [{
				id: 's1',
				points: [[10, 10, 0.5], [30, 30, 0.6]],
				style: {
					size: 4,
					thinning: 0.6,
					smoothing: 0.1,
					streamline: 0,
					simulatePressure: false,
					color: 'currentColor',
				},
				offset: { x: 0, y: 0 },
			}],
		};
		let meta = readFile(vault).meta;
		simulateEditorSave(vault, snapshot, meta, undefined);

		// The bug from round 5: the background used to disappear here.
		const afterFirstSave = readFile(vault);
		expect(afterFirstSave.inkCanvas?.background?.path).toBe('Ink/PDF/abc/p1@2x.png');
		expect(afterFirstSave.inkCanvas?.sourcePdf?.page).toBe('1');
		expect(afterFirstSave.inkCanvas?.strokes).toHaveLength(1);

		// 4. Transcription writes text, fingerprint, and the user-edit flag.
		await saveWriteFileTranscript(
			vault.plugin,
			vault.file,
			'第一行\n第二行',
			{
				lastTranscriptionAt: '2026-03-01T00:00:00.000Z',
				bboxCellsAtLastTranscription: '0,0|1,0',
			},
			{ markUserEdited: true },
		);

		const afterTranscript = readFile(vault);
		expect(afterTranscript.meta.transcript).toBe('第一行\n第二行');
		expect(afterTranscript.meta.transcriptEditedAt).toBeTruthy();
		expect(afterTranscript.meta.bboxCellsAtLastTranscription).toBe('0,0|1,0');

		// 5. Another stroke, another save — the user's edit must survive.
		meta = afterTranscript.meta;
		simulateEditorSave(
			vault,
			afterTranscript.inkCanvas!,
			meta,
			afterTranscript.meta.transcript,
		);

		const afterSecondSave = readFile(vault);
		// The bug from round 6: the flag and fingerprint used to vanish here,
		// which silently re-enabled auto-transcription over the correction.
		expect(afterSecondSave.meta.transcriptEditedAt).toBeTruthy();
		expect(afterSecondSave.meta.bboxCellsAtLastTranscription).toBe('0,0|1,0');
		expect(afterSecondSave.meta.lastTranscriptionAt).toBe('2026-03-01T00:00:00.000Z');
		expect(afterSecondSave.meta.transcript).toBe('第一行\n第二行');
		expect(afterSecondSave.inkCanvas?.background?.path).toBe('Ink/PDF/abc/p1@2x.png');
	});

	it('clears the user-edit flag when the model transcribes again', async () => {
		const vault = createFakeVault();
		seedFile(vault);

		await saveWriteFileTranscript(vault.plugin, vault.file, '手改', undefined, { markUserEdited: true });
		expect(readFile(vault).meta.transcriptEditedAt).toBeTruthy();

		// A manual Transcribe passes no options: the machine owns the text again.
		await saveWriteFileTranscript(vault.plugin, vault.file, '机器版本', {
			lastTranscriptionAt: '2026-03-02T00:00:00.000Z',
		});
		const after = readFile(vault);
		expect(after.meta.transcript).toBe('机器版本');
		expect(after.meta.transcriptEditedAt).toBeUndefined();
	});

	it('keeps the rendered SVG markup across saves instead of rebuilding it', async () => {
		const vault = createFakeVault();
		const snapshot = seedFile(vault);
		const before = vault.files.get(FILE_PATH)!;
		expect(before).toContain('<svg');

		simulateEditorSave(vault, snapshot, readFile(vault).meta, undefined);
		const after = vault.files.get(FILE_PATH)!;

		// The `svgString` from disk is spliced back in; a save must never replace
		// the whole document with a stub.
		expect(after.match(/<svg/g)).toHaveLength(1);
		expect(after).toContain('<ink-canvas');
	});
});
