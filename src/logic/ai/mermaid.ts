import { Editor, Notice, TFile } from 'obsidian';
import InkPlugin from 'src/main';
import { t } from 'src/i18n';
import { prepareProviderMedia } from 'src/logic/transcription-providers';
import { isAiEndpointUsable, requestAiCompletion } from './client';

//////////
//////////

/**
 * Diagram-reading rules.
 *
 * The model is asked to *interpret*, not to convert: ink geometry cannot be
 * mapped to a flowchart deterministically, because the same box-and-arrow drawing
 * could be three different diagrams. Interpreting is the only approach that works,
 * which is also why the output is editable code and not an image.
 */
export const MERMAID_SYSTEM_PROMPT = [
	'你看一张手绘的示意图，把它翻译成 Mermaid 代码。',
	'',
	'规则：',
	'1. 只输出 Mermaid 代码本身，不要 ``` 围栏，不要解释。',
	'2. 第一行必须是图表类型，例如 flowchart TD、sequenceDiagram、mindmap、classDiagram、graph LR。',
	'3. 节点文字用简体中文，与手写内容一致。',
	'4. 认不出的文字用「?」，不要编造内容。',
	'5. 如果图中没有可表达的图表结构（只是涂鸦或算式），只输出一行：NOT_A_DIAGRAM',
].join('\n');

export const MERMAID_USER_INSTRUCTION = '把这张手绘图转成 Mermaid 代码。';

/**
 * Strips a ```mermaid fence and any prose around the code.
 *
 * Models routinely answer "好的，这是代码：\n```mermaid\n...\n```\n希望对你有帮助" —
 * every one of those decorations breaks a Mermaid block when pasted.
 */
export function cleanMermaidCode(raw: string): string | null {
	let text = (raw ?? '').trim();
	if (!text) return null;
	if (/^NOT_A_DIAGRAM\b/i.test(text)) return null;

	const fence = /```(?:mermaid)?\s*([\s\S]*?)```/i.exec(text);
	if (fence) text = fence[1];

	const lines = text
		.split(/\r?\n/)
		.map((line) => line.replace(/\s+$/, ''))
		.filter((line) => line.trim().length > 0);

	// Drop leading prose: the first line must look like a diagram declaration.
	const declarationIndex = lines.findIndex((line) =>
		/^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|mindmap|timeline|quadrantChart|gitGraph|C4Context)\b/.test(line.trim()),
	);
	if (declarationIndex === -1) return null;

	const code = lines.slice(declarationIndex).join('\n').trim();
	return code.length > 0 ? code : null;
}

export type MermaidOutcome =
	| { ok: true; code: string }
	| { ok: false; reason: string };

/**
 * Reads an ink file's drawing and asks the model for Mermaid code.
 *
 * Always runs the image through the same PNG rasteriser as transcription: the
 * endpoint that stores the key may only accept PNG/JPEG/WebP/GIF.
 */
export async function generateMermaidFromInkFile(
	plugin: InkPlugin,
	inkFile: TFile,
): Promise<MermaidOutcome> {
	const provider = plugin.settings.customTranscriptionProvider;
	if (!isAiEndpointUsable(provider)) {
		return { ok: false, reason: t('Enable a custom API in settings first.') };
	}

	try {
		const svg = await plugin.app.vault.read(inkFile);
		const media = await prepareProviderMedia(svg, 'png');
		const raw = await requestAiCompletion({
			settings: provider,
			systemPrompt: MERMAID_SYSTEM_PROMPT,
			userText: MERMAID_USER_INSTRUCTION,
			media,
		});
		const code = cleanMermaidCode(raw);
		if (!code) {
			return { ok: false, reason: t('The model did not find a diagram structure in this drawing.') };
		}
		return { ok: true, code };
	} catch (error) {
		console.debug('笔墨: Mermaid generation failed', error);
		return { ok: false, reason: t('Could not reach the endpoint.') };
	}
}

/** Generates and inserts a Mermaid block at the cursor. */
export async function insertMermaidFromDrawing(
	plugin: InkPlugin,
	inkFile: TFile,
	editor: Editor,
): Promise<void> {
	const outcome = await generateMermaidFromInkFile(plugin, inkFile);
	if (!outcome.ok) {
		new Notice(outcome.reason);
		return;
	}
	editor.replaceSelection(`\n\`\`\`mermaid\n${outcome.code}\n\`\`\`\n`);
	new Notice(t('Mermaid block inserted'));
}
