import { Editor, Notice, TFile, moment } from 'obsidian';
import InkPlugin from 'src/main';
import { t } from 'src/i18n';
import { requestFigureSpec, type FigureSpec } from './figure';
import { isAiEndpointUsable } from './client';
import { buildFigureSvg, sampleFigure } from './expression';
import { resolveInkRootFolder } from 'src/logic/pdf/pdf-paths';

//////////
//////////

/**
 * Where generated plots live: `<ink root>/AI`, resolved through the same
 * attachment helpers as the handwriting folders. Hard-coding `Ink/AI` put plots
 * in the vault root even when writing files lived under `.system/attachments`.
 */
const FIGURE_SUBFOLDER = 'AI';

function slugifyTitle(title: string | undefined): string {
	const base = (title ?? '图').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
	return base.slice(0, 40) || '图';
}

async function ensureFolder(plugin: InkPlugin, folder: string): Promise<boolean> {
	const vault = plugin.app.vault;
	if (vault.getAbstractFileByPath(folder)) return true;
	try {
		await vault.createFolder(folder);
		return true;
	} catch (error) {
		console.debug('笔墨: could not create figure folder', error);
		return false;
	}
}

async function uniqueFigurePath(
	plugin: InkPlugin,
	figureFolder: string,
	title: string | undefined,
): Promise<string> {
	const vault = plugin.app.vault;
	const stamp = moment().format('YYYYMMDD-HHmmss');
	const base = `${figureFolder}/${slugifyTitle(title)} ${stamp}`;
	let candidate = `${base}.svg`;
	let index = 2;
	while (vault.getAbstractFileByPath(candidate)) {
		candidate = `${base} ${index}.svg`;
		index += 1;
	}
	return candidate;
}

export type FigureInsertOutcome =
	| { ok: true; path: string; spec: FigureSpec }
	| { ok: false; reason: string };

/**
 * Turns a natural-language request into an SVG plot and inserts it at the cursor.
 *
 * The model only produces the expression and the domain; sampling and rendering
 * happen locally, so the curve is mathematically exact and the model can never
 * emit malformed SVG. The file is written to the vault and embedded as a normal
 * Obsidian image link, which keeps the note portable.
 */
export async function insertFigureFromPrompt(
	plugin: InkPlugin,
	editor: Editor,
	userText: string,
): Promise<FigureInsertOutcome> {
	const provider = plugin.settings.customTranscriptionProvider;
	if (!isAiEndpointUsable(provider)) {
		return { ok: false, reason: t('Enable a custom API in settings first.') };
	}

	const spec = await requestFigureSpec(provider, userText);
	if (!spec) {
		return { ok: false, reason: t('The model did not return a usable function.') };
	}

	const data = sampleFigure(spec.expression, { domain: spec.domain, count: 480 });
	if (data.segments.length === 0) {
		return { ok: false, reason: t('The function produced no drawable points in this range.') };
	}

	const svg = buildFigureSvg(data, {
		title: spec.title ?? `y = ${spec.expression.replace(/Math\./g, '')}`,
	});

	const inkRoot = await resolveInkRootFolder(plugin, plugin.app.workspace.getActiveFile());
	const figureFolder = `${inkRoot}/${FIGURE_SUBFOLDER}`;
	const hasFolder = await ensureFolder(plugin, figureFolder);
	if (!hasFolder) {
		return { ok: false, reason: t('Could not create the Ink/AI folder.') };
	}

	const targetPath = await uniqueFigurePath(plugin, figureFolder, spec.title);
	await plugin.app.vault.create(targetPath, svg);

	const created = plugin.app.vault.getAbstractFileByPath(targetPath);
	const embedName = created instanceof TFile ? created.basename : targetPath;
	editor.replaceSelection(`![[${targetPath}]]`);
	new Notice(t('Figure inserted') + `: ${embedName}`);

	return { ok: true, path: targetPath, spec };
}
