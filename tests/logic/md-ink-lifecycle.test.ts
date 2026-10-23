import { MdInkController } from 'src/logic/md-ink/md-ink-controller';
import { MdInkStorage, mdInkFilePath } from 'src/logic/md-ink/md-ink-store';
import {
	createEmptyMdInkDocument,
	resolvePaperStyle,
	type MdInkStroke,
} from 'src/logic/md-ink/types';

//////////
//////////

/**
 * The ink file key is a hash of the path, so renaming a note used to leave its
 * strokes behind under a key nothing would look up again. These tests cover the
 * three pieces that make a rename survivable: moving the file, telling the
 * controller it *was* a rename, and waiting for that copy before reading.
 */

function memoryVault() {
	const files = new Map<string, string>();
	const adapter = {
		exists: async (path: string) => files.has(path),
		read: async (path: string) => {
			const value = files.get(path);
			if (value === undefined) throw new Error(`missing ${path}`);
			return value;
		},
		write: async (path: string, data: string) => {
			files.set(path, data);
		},
		remove: async (path: string) => {
			files.delete(path);
		},
		mkdir: async () => undefined,
	};
	return {
		files,
		app: { vault: { adapter } } as never,
	};
}

function stroke(): MdInkStroke {
	return {
		id: 's1',
		points: [[0, 0, 0.5], [10, 10, 0.5]],
		style: { size: 4, thinning: 0.5, smoothing: 0.5, streamline: 0.5, simulatePressure: true, color: 'currentColor' },
		anchor: { line: 1, lineText: 'first' },
		offset: { x: 0, y: 0 },
		createdAt: 0,
	};
}

describe('MdInkStorage.move', () => {
	it('carries the ink file to the new key and removes the old one', async () => {
		const { app, files } = memoryVault();
		const storage = new MdInkStorage(app);

		const doc = createEmptyMdInkDocument('Old.md');
		doc.strokes.push(stroke());
		files.set(mdInkFilePath('Old.md'), JSON.stringify(doc));

		await storage.move('Old.md', 'New.md');

		expect(files.has(mdInkFilePath('Old.md'))).toBe(false);
		const moved = JSON.parse(files.get(mdInkFilePath('New.md')) ?? '{}');
		expect(moved.strokes).toHaveLength(1);
	});

	it('never overwrites a target that already holds ink', async () => {
		const { app, files } = memoryVault();
		const storage = new MdInkStorage(app);

		files.set(mdInkFilePath('Old.md'), JSON.stringify({ version: 1, strokes: [stroke()] }));
		files.set(mdInkFilePath('New.md'), JSON.stringify({ version: 1, strokes: [] }));

		await storage.move('Old.md', 'New.md');

		// The existing target is always newer than the source: a live overlay
		// wrote it after the rename started.
		const target = JSON.parse(files.get(mdInkFilePath('New.md')) ?? '{}');
		expect(target.strokes).toHaveLength(0);
		expect(files.has(mdInkFilePath('Old.md'))).toBe(true);
	});

	it('does nothing when the source has no ink', async () => {
		const { app, files } = memoryVault();
		const storage = new MdInkStorage(app);

		await storage.move('Empty.md', 'Other.md');

		expect(files.has(mdInkFilePath('Other.md'))).toBe(false);
	});

	it('is a no-op for an unchanged path', async () => {
		const { app, files } = memoryVault();
		const storage = new MdInkStorage(app);
		files.set(mdInkFilePath('Same.md'), '{"version":1,"strokes":[]}');

		await storage.move('Same.md', 'Same.md');

		expect(files.has(mdInkFilePath('Same.md'))).toBe(true);
	});
});

describe('MdInkController rename bookkeeping', () => {
	const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

	it('recognises the pair it was told about', () => {
		const controller = new MdInkController({} as never);
		controller.noteRename('A.md', 'B.md', Promise.resolve());

		expect(controller.wasRenamed('A.md', 'B.md')).toBe(true);
	});

	it('does not treat an unrelated path pair as a rename', () => {
		const controller = new MdInkController({} as never);
		controller.noteRename('A.md', 'B.md', Promise.resolve());

		// Tab switched to a different note — strokes must not follow.
		expect(controller.wasRenamed('A.md', 'C.md')).toBe(false);
		expect(controller.wasRenamed('B.md', 'A.md')).toBe(false);
	});

	it('expires so a stale mark cannot resurrect ink onto another note', () => {
		const controller = new MdInkController({} as never);
		const now = Date.now();
		const spy = jest.spyOn(Date, 'now').mockReturnValue(now);
		try {
			controller.noteRename('A.md', 'B.md', Promise.resolve());
			spy.mockReturnValue(now + 60_000);
			expect(controller.wasRenamed('A.md', 'B.md')).toBe(false);
		} finally {
			spy.mockRestore();
		}
	});

	it('waits for the file move before answering', async () => {
		const controller = new MdInkController({} as never);
		let done = false;
		const move = flush().then(() => {
			done = true;
		});
		controller.noteRename('A.md', 'B.md', move);

		await controller.awaitMove('B.md');
		expect(done).toBe(true);
	});

	it('resolves immediately for a path with no pending move', async () => {
		const controller = new MdInkController({} as never);
		await expect(controller.awaitMove('Nowhere.md')).resolves.toBeUndefined();
	});
});

describe('resolvePaperStyle', () => {
	it('keeps the configured default for an untouched document', () => {
		expect(resolvePaperStyle(createEmptyMdInkDocument('N.md'), 'ruled')).toBe('ruled');
	});

	it('honours the paper a note was saved with', () => {
		const doc = { ...createEmptyMdInkDocument('N.md'), paper: 'grid' as const };
		expect(resolvePaperStyle(doc, 'none')).toBe('grid');
	});

	it('honours an explicit "none" once the note has ink', () => {
		const doc = createEmptyMdInkDocument('N.md');
		doc.strokes.push(stroke());
		expect(resolvePaperStyle(doc, 'dots')).toBe('none');
	});
});
