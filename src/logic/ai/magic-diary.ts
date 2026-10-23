import type { App, TFile } from 'obsidian';
import {
	normalizeCustomTranscriptionProvider,
	prepareProviderMedia,
	type ChatTurn,
	type CustomTranscriptionProviderSettings,
} from 'src/logic/transcription-providers';
import { isAiEndpointUsable, requestAiCompletion } from './client';

export const MAGIC_DIARY_FRONTMATTER_KEY = 'bimo-magic-page';
export const MAGIC_DIARY_PAUSE_MS = 1900;

export const MAGIC_DIARY_SYSTEM_PROMPT = [
	'You are an enchanted, perceptive companion living inside the pages of a handwritten notebook ("魔法书页" / Magic Diary Page, inspired by Tom Riddle\'s Diary and the Marauder\'s Map, but warm, wise, witty, and helpful).',
	'The user has just written or sketched something by hand on the page (attached as an image).',
	'First, read their handwriting or sketch accurately. Then reply directly to them in the same language they used (defaulting to Chinese if unclear).',
	'Keep your reply concise (1 to 3 sentences), natural, and conversational — as if ink is seeping back through the parchment in a "you write a line, I write a line" ("你写一句，我回一句") dialogue.',
	'Format your response as:',
	'HEARD: <1-line transcription of what the user wrote>',
	'REPLY: <your in-character, insightful or helpful response>',
].join('\n');

export interface MagicDiaryTurnResult {
	heard: string;
	reply: string;
}

/**
 * Parse the structured `HEARD:` / `REPLY:` response from the model, falling
 * back gracefully if the model returned plain text.
 */
export function parseMagicDiaryResponse(raw: string): MagicDiaryTurnResult {
	const trimmed = raw.trim();
	if (!trimmed) {
		return { heard: '', reply: '' };
	}

	const heardMatch = trimmed.match(/^HEARD\s*[:：]\s*(.+)$/im);
	const replyMatch = trimmed.match(/^REPLY\s*[:：]\s*([\s\S]+)$/im);

	if (replyMatch) {
		const heard = heardMatch ? heardMatch[1].trim() : '';
		const reply = replyMatch[1].trim();
		return { heard, reply };
	}

	return {
		heard: '',
		reply: trimmed,
	};
}

/**
 * Inspect raw markdown text or Obsidian frontmatter to see if a note is marked
 * as a Magic Diary Page (`bimo-magic-page: true` or `cssclasses: [bimo-magic-diary-note]`).
 */
export function hasMagicDiaryFrontmatter(rawMarkdown: string): boolean {
	if (!rawMarkdown.startsWith('---')) return false;
	const endIdx = rawMarkdown.indexOf('\n---', 3);
	if (endIdx === -1) return false;
	const frontmatter = rawMarkdown.slice(3, endIdx);
	if (/^\s*bimo-magic-page\s*:\s*(true|yes|1)\s*$/im.test(frontmatter)) {
		return true;
	}
	if (/bimo-magic-diary-note/i.test(frontmatter)) {
		return true;
	}
	return false;
}

export function isFileMagicDiaryPage(app: App, file: TFile | null): boolean {
	if (!file) return false;
	const cache = app.metadataCache?.getFileCache?.(file);
	const fm = cache?.frontmatter;
	if (fm) {
		const flag = fm[MAGIC_DIARY_FRONTMATTER_KEY];
		if (flag === true || flag === 'true' || flag === 1) return true;
		const classes = fm.cssclasses ?? fm.cssclass;
		if (Array.isArray(classes) && classes.includes('bimo-magic-diary-note')) return true;
		if (typeof classes === 'string' && classes.includes('bimo-magic-diary-note')) return true;
	}
	return false;
}

/**
 * Build the initial markdown content for a brand-new Magic Diary Page note.
 */
export function buildMagicDiaryNoteContent(title?: string): string {
	const heading = title ? `# ✦ ${title}\n\n` : '';
	return [
		'---',
		`${MAGIC_DIARY_FRONTMATTER_KEY}: true`,
		'cssclasses:',
		'  - bimo-magic-diary-note',
		'---',
		heading,
	].join('\n');
}

export interface MagicDiaryRequestOptions {
	svg: string;
	rawSettings: CustomTranscriptionProviderSettings | undefined;
	history: ChatTurn[];
}

export async function requestMagicDiaryTurn(
	options: MagicDiaryRequestOptions,
): Promise<MagicDiaryTurnResult> {
	const provider = normalizeCustomTranscriptionProvider(options.rawSettings);
	if (!isAiEndpointUsable(provider)) {
		return {
			heard: '',
			reply: '✦ 书页微微泛起金光，但尚未连接灵识之源（请先在「笔墨设置 → AI 识别与对话」中配置 API Key，即可开启「你写一句，AI回一句」的魔法共鸣）。',
		};
	}

	const media = await prepareProviderMedia(options.svg, provider.mediaFormat);
	const raw = await requestAiCompletion({
		settings: provider,
		systemPrompt: MAGIC_DIARY_SYSTEM_PROMPT,
		userText: 'Read the newly written ink on this page and reply in character.',
		media,
		history: options.history,
	});
	return parseMagicDiaryResponse(raw);
}
