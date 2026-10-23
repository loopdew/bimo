import { normalizePath, type TFile } from 'obsidian';
import { ATTACHMENT_SUBFOLDER_NAME } from 'src/constants';
import type InkPlugin from 'src/main';
import { getObsidianAttachmentFolderPath } from 'src/logic/utils/obsidian-interfaces';
import { getBaseAttachmentPath } from 'src/logic/utils/getBaseAttachmentPath';
import { getWritingSubfolderPath } from 'src/logic/utils/getSubfolderPaths';
import { parseFilepath } from 'src/logic/utils/parseFilepath';

//////////
//////////

/**
 * Folder that holds everything derived from ink: `<attachment base>/Ink`.
 *
 * Resolved through the same helpers the writing files use, so PDF pages and
 * figure plots land beside the handwriting instead of in the vault root. A vault
 * configured to keep attachments in `_system/attachments` would otherwise get
 * page images in a second, unrelated `Ink/` tree at the top level.
 */
export async function resolveInkRootFolder(
	plugin: InkPlugin,
	instigatingFile: TFile | null,
): Promise<string> {
	const obsAttachmentFolderPath = await getObsidianAttachmentFolderPath(plugin);
	const instigatingFileFolderPath = instigatingFile
		? parseFilepath(instigatingFile.path).folderpath
		: null;

	const base = await getBaseAttachmentPath(plugin, {
		obsAttachmentFolderPath,
		instigatingFileFolderPath,
	});

	// Take the first segment of the writing subfolder (`Ink/Writing` → `Ink`) so
	// page images land beside the writing files. The on-disk folder keeps its
	// historical name on purpose — renaming it would orphan every existing note.
	const subfolder = getWritingSubfolderPath(plugin);
	const inkRoot = subfolder.split('/')[0] || ATTACHMENT_SUBFOLDER_NAME;

	return normalizePath([base, inkRoot].filter(Boolean).join('/')) || ATTACHMENT_SUBFOLDER_NAME;
}

/**
 * Stable 7-char base36 hash of a vault path.
 *
 * Page images and index documents live in a folder derived from the source PDF.
 * Two PDFs can share a basename in different folders, so the folder name includes
 * this hash; a full path in the folder name would be unreadable and could exceed
 * filename limits.
 */
export function stablePathHash(input: string): string {
	let hash = 5381;
	for (let index = 0; index < input.length; index += 1) {
		hash = ((hash << 5) + hash + input.charCodeAt(index)) >>> 0;
	}
	return hash.toString(36).padStart(7, '0').slice(-7);
}

/** `<inkRoot>/PDF/<hash>-<name>` — one folder per source PDF. */
export function pdfCacheFolder(inkRoot: string, pdfFile: TFile): string {
	const safeName = pdfFile.basename.replace(/[\\/:*?"<>|]/g, '').slice(0, 40);
	return normalizePath(`${inkRoot}/PDF/${stablePathHash(pdfFile.path)}-${safeName}`);
}
