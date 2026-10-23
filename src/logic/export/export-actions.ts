import { Notice, TFile } from 'obsidian';
import InkPlugin from 'src/main';
import { t } from 'src/i18n';
import { extractInkJsonFromSvg } from 'src/logic/utils/extractInkJsonFromSvg';
import { buildExcalidrawScene } from './excalidraw-export';

//////////
//////////

/** `Ink/Writing/foo.svg` → `Ink/Writing/foo.excalidraw`. */
function excalidrawPathFor(svgPath: string): string {
	const withoutExtension = svgPath.replace(/\.svg$/i, '');
	return `${withoutExtension}.excalidraw`;
}

/** Never clobber an earlier export; Excalidraw files are user-editable. */
async function uniqueVaultPath(plugin: InkPlugin, desired: string): Promise<string> {
	const vault = plugin.app.vault;
	if (!vault.getAbstractFileByPath(desired)) return desired;
	const base = desired.replace(/\.excalidraw$/i, '');
	for (let index = 2; index < 500; index += 1) {
		const candidate = `${base} ${index}.excalidraw`;
		if (!vault.getAbstractFileByPath(candidate)) return candidate;
	}
	return `${base} ${Date.now()}.excalidraw`;
}

/**
 * Writes the ink file's strokes as an Excalidraw scene next to the SVG.
 *
 * Excalidraw renders freedraw with its own stroke model, so the result is not
 * pixel-identical to 笔墨 — but every stroke stays an independently selectable,
 * movable element, which is what makes the round trip useful.
 */
export async function exportInkFileToExcalidraw(
	plugin: InkPlugin,
	inkFile: TFile,
): Promise<void> {
	try {
		const svg = await plugin.app.vault.read(inkFile);
		const pageData = extractInkJsonFromSvg(svg);
		const strokes = pageData?.inkCanvas?.strokes ?? [];

		if (strokes.length === 0) {
			new Notice(t('Nothing to export: this file has no ink-canvas strokes.'));
			return;
		}

		const sceneJson = buildExcalidrawScene(strokes);
		const targetPath = await uniqueVaultPath(plugin, excalidrawPathFor(inkFile.path));
		await plugin.app.vault.create(targetPath, sceneJson);

		const exported = plugin.app.vault.getAbstractFileByPath(targetPath);
		const name = exported instanceof TFile ? exported.basename : targetPath;
		new Notice(t('Exported to Excalidraw') + `: ${name}`);
	} catch (error) {
		console.debug('笔墨: Excalidraw export failed', error);
		new Notice(t('Export to Excalidraw failed'));
	}
}
