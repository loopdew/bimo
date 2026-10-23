import type InkPlugin from 'src/main';
import { TFile } from 'obsidian';
import { upsertAnnotationIndex } from 'src/logic/pdf/annotation-index';

// The base folder depends on Obsidian's attachment-folder config; pin it so the
// test asserts merging behaviour rather than path resolution.
jest.mock('src/logic/pdf/pdf-paths', () => {
	const actual = jest.requireActual('src/logic/pdf/pdf-paths');
	return {
		...actual,
		resolveInkRootFolder: jest.fn(async () => '_system/attachments/Ink'),
	};
});

//////////
//////////

/**
 * Index merging against an in-memory vault.
 *
 * The pure-function tests cover parsing and rendering; this one covers the part
 * that actually failed in past rounds — reading an existing document, splicing
 * the block, and writing it back without eating the user's own prose.
 */

const PDF_PATH = '讲义/Lecture 3.pdf';

interface FakeVault {
	files: Map<string, string>;
	plugin: InkPlugin;
	pdfFile: TFile;
}

/**
 * Must be a real `TFile` instance: the production code branches on
 * `instanceof TFile`, and a plain object silently takes the "create" path —
 * which overwrote the index and looked like a merge bug during drafting.
 */
function fakeTFile(path: string, basename?: string): TFile {
	const file = new TFile();
	Object.assign(file, { path, basename: basename ?? path.split('/').pop()?.replace(/\.\w+$/, '') ?? path });
	return file;
}

function createFakeVault(): FakeVault {
	const files = new Map<string, string>();
	const pdfFile = fakeTFile(PDF_PATH, 'Lecture 3');
	const vault = {
		read: async (target: TFile) => files.get(target.path) ?? '',
		modify: async (target: TFile, data: string) => { files.set(target.path, data); },
		create: async (path: string, data: string) => {
			files.set(path, data);
			return fakeTFile(path);
		},
		getAbstractFileByPath: (path: string) => {
			if (files.has(path)) return fakeTFile(path);
			if (path === PDF_PATH) return pdfFile;
			return null;
		},
	};
	const plugin = {
		app: {
			vault,
			// The index path is resolved relative to the active note's folder.
			workspace: { getActiveFile: () => null },
		},
	} as unknown as InkPlugin;
	return { files, plugin, pdfFile };
}

function page(n: number) {
	return { page: n, inkFilePath: `Ink/Writing/p${n}.svg` };
}

describe('annotation index file IO', () => {
	it('creates the index on first annotation', async () => {
		const vault = createFakeVault();
		const path = await upsertAnnotationIndex(vault.plugin, vault.pdfFile, [page(1)]);
		expect(path).toMatch(/^_system\/attachments\/Ink\/PDF\/.+index\.md$/);

		const content = vault.files.get(path!)!;
		expect(content).toContain('p1.svg');
		expect(content).toContain(`[[${PDF_PATH}|`);
		expect(content.startsWith('---')).toBe(true);
	});

	it('merges a later page without losing the first', async () => {
		const vault = createFakeVault();
		const path = (await upsertAnnotationIndex(vault.plugin, vault.pdfFile, [page(1)]))!;
		await upsertAnnotationIndex(vault.plugin, vault.pdfFile, [page(2)]);

		const content = vault.files.get(path)!;
		expect(content).toContain('p1.svg');
		expect(content).toContain('p2.svg');
	});

	it('points a re-annotated page at its newest block', async () => {
		const vault = createFakeVault();
		const path = (await upsertAnnotationIndex(vault.plugin, vault.pdfFile, [page(3)]))!;
		await upsertAnnotationIndex(vault.plugin, vault.pdfFile, [
			{ page: 3, inkFilePath: 'Ink/Writing/p3-new.svg' },
		]);

		const content = vault.files.get(path)!;
		expect(content).toContain('p3-new.svg');
		expect(content).not.toContain('[[Ink/Writing/p3.svg|');
	});

	it('preserves prose the user added around the block', async () => {
		const vault = createFakeVault();
		const path = (await upsertAnnotationIndex(vault.plugin, vault.pdfFile, [page(1)]))!;

		// The user writes a summary above and a note below the generated block.
		const withProse = vault.files.get(path)!.replace(
			'<!-- bimo:pdf-index:start -->',
			'这段是我自己总结的重点。\n\n<!-- bimo:pdf-index:start -->',
		) + '\n补充：第三章要重看。\n';
		vault.files.set(path, withProse);

		await upsertAnnotationIndex(vault.plugin, vault.pdfFile, [page(2)]);

		const content = vault.files.get(path)!;
		expect(content).toContain('这段是我自己总结的重点。');
		expect(content).toContain('补充：第三章要重看。');
		expect(content).toContain('p1.svg');
		expect(content).toContain('p2.svg');
	});

	it('does nothing for an empty page list', async () => {
		const vault = createFakeVault();
		const path = await upsertAnnotationIndex(vault.plugin, vault.pdfFile, []);
		expect(path).toBeNull();
		expect(vault.files.size).toBe(0);
	});
});
