import type { App } from 'obsidian';
import { createEmptyMdInkDocument, type MdInkDocument } from './types';

///////////////////////////
///////////////////////////

/**
 * Persistence for note overlay ink.
 *
 * Storage is a sibling of the plugin's own data, not the note: the whole point
 * of the overlay is that the `.md` file stays a normal Markdown file. Every
 * vault tool — sync, version control, export — keeps working untouched.
 */

export const MD_INK_FOLDER = '.bimo/md-ink';

/** FNV-1a over the note path. Short, stable, no crypto dependency. */
export function mdInkFileKey(notePath: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < notePath.length; i++) {
		hash ^= notePath.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16).padStart(8, '0');
}

export function mdInkFilePath(notePath: string): string {
	return `${MD_INK_FOLDER}/${mdInkFileKey(notePath)}.json`;
}

/** Parse defensively: a hand-edited or half-synced file must not break the editor. */
export function parseMdInkDocument(raw: string, notePath: string): MdInkDocument {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return createEmptyMdInkDocument(notePath);
	}

	if (!parsed || typeof parsed !== 'object') {
		return createEmptyMdInkDocument(notePath);
	}

	const candidate = parsed as Partial<MdInkDocument>;
	const strokes = Array.isArray(candidate.strokes)
		? candidate.strokes.filter(isUsableStroke)
		: [];

	return {
		version: 1,
		notePath,
		paper: candidate.paper === 'ruled' || candidate.paper === 'grid' || candidate.paper === 'dots'
			? candidate.paper
			: 'none',
		strokes,
		updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : Date.now(),
	};
}

function isUsableStroke(value: unknown): value is MdInkDocument['strokes'][number] {
	if (!value || typeof value !== 'object') return false;
	const stroke = value as MdInkDocument['strokes'][number];
	return typeof stroke.id === 'string'
		&& Array.isArray(stroke.points)
		&& stroke.points.length > 0
		&& !!stroke.style
		&& !!stroke.anchor
		&& typeof stroke.anchor.line === 'number';
}

export function serializeMdInkDocument(doc: MdInkDocument): string {
	return JSON.stringify({
		version: 1,
		notePath: doc.notePath,
		paper: doc.paper,
		strokes: doc.strokes,
		updatedAt: doc.updatedAt,
	});
}

export class MdInkStorage {
	constructor(private readonly app: App) {}

	private get adapter() {
		return this.app.vault.adapter;
	}

	async load(notePath: string): Promise<MdInkDocument> {
		const path = mdInkFilePath(notePath);
		try {
			if (!(await this.adapter.exists(path))) {
				return createEmptyMdInkDocument(notePath);
			}
			const raw = await this.adapter.read(path);
			return parseMdInkDocument(raw, notePath);
		} catch (error) {
			console.warn('[bimo] md-ink load failed', notePath, error);
			return createEmptyMdInkDocument(notePath);
		}
	}

	async save(doc: MdInkDocument): Promise<void> {
		doc.updatedAt = Date.now();
		const path = mdInkFilePath(doc.notePath);
		try {
			if (!(await this.adapter.exists(MD_INK_FOLDER))) {
				await this.adapter.mkdir(MD_INK_FOLDER);
			}
			await this.adapter.write(path, serializeMdInkDocument(doc));
		} catch (error) {
			console.warn('[bimo] md-ink save failed', doc.notePath, error);
		}
	}

	async remove(notePath: string): Promise<void> {
		const path = mdInkFilePath(notePath);
		try {
			if (await this.adapter.exists(path)) await this.adapter.remove(path);
		} catch (error) {
			console.warn('[bimo] md-ink remove failed', notePath, error);
		}
	}

	/**
	 * Carry a note's ink across a rename.
	 *
	 * The file key is a hash of the path, so renaming a note otherwise leaves the
	 * strokes behind under a key nothing will ever look up again — the ink looks
	 * deleted to the user while the JSON keeps growing in `.bimo/`. Copy-then-
	 * delete rather than `adapter.rename` because the adapter interface does not
	 * guarantee one, and a partially written target must not destroy the source.
	 *
	 * Idempotent on purpose: the vault rename hook and the editor's own path
	 * check can both fire for one rename, in either order. An existing target is
	 * never overwritten, because whoever wrote it already has newer strokes than
	 * the source file does.
	 */
	async move(fromPath: string, toPath: string): Promise<void> {
		if (fromPath === toPath) return;
		const from = mdInkFilePath(fromPath);
		const to = mdInkFilePath(toPath);
		try {
			if (!(await this.adapter.exists(from))) return;
			if (await this.adapter.exists(to)) return;
			await this.adapter.write(to, await this.adapter.read(from));
			await this.adapter.remove(from);
		} catch (error) {
			console.warn('[bimo] md-ink move failed', fromPath, toPath, error);
		}
	}
}
