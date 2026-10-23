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

export type MagicDiaryPreset = 'chat' | 'explain' | 'brainstorm' | 'solver' | 'custom';

export interface MagicDiaryPresetInfo {
	id: MagicDiaryPreset;
	name: string;
	icon: string;
	desc: string;
	prompt: string;
}

export const MAGIC_DIARY_PRESETS: Record<MagicDiaryPreset, MagicDiaryPresetInfo> = {
	chat: {
		id: 'chat',
		name: '对话伴侣 (Companion)',
		icon: 'message-circle',
		desc: '沉浸式笔友，你写一句，书页回一句，自然温润',
		prompt: [
			'You are an enchanted, perceptive companion living inside the pages of a handwritten notebook ("魔法书页" / Magic Diary Page, inspired by Tom Riddle\'s Diary and the Marauder\'s Map, but warm, wise, witty, and helpful).',
			'The user has just written or sketched something by hand on the page (attached as an image).',
			'First, read their handwriting or sketch accurately. Then reply directly to them in the same language they used (defaulting to Chinese if unclear).',
			'Keep your reply concise (1 to 3 sentences), natural, and conversational — as if ink is seeping back through the parchment in a "you write a line, I write a line" ("你写一句，我回一句") dialogue.',
		].join('\n'),
	},
	explain: {
		id: 'explain',
		name: '深度解析 (Explain & Teach)',
		icon: 'graduation-cap',
		desc: '拆解手写知识点、公式定理或外语生词，条理清晰',
		prompt: [
			'You are a wise, pedagogical scholar and mentor residing inside the handwritten notebook.',
			'The user has just written, derived, or sketched a concept, theorem, formula, foreign vocabulary, or note on the page (attached as an image).',
			'First, read their handwriting or diagram accurately.',
			'Then, provide a crystal-clear, structured explanation or educational walkthrough of what they wrote. Highlight key intuition, definitions, or core principles. Use markdown formatting and KaTeX math if helpful.',
			'Keep your response focused, accessible, and insightful (2 to 4 concise paragraphs or bullet points).',
		].join('\n'),
	},
	brainstorm: {
		id: 'brainstorm',
		name: '灵感补全 (Brainstorm & Refine)',
		icon: 'sparkles',
		desc: '捕捉手写灵感火花、大纲或片段，发散创意与润色',
		prompt: [
			'You are a brilliant creative muse and brainstorm partner embedded in the parchment.',
			'The user has just jotted down a handwritten idea, fragment, brainstorm, outline, or doodle (attached as an image).',
			'First, read their handwriting or sketch accurately.',
			'Then, expand upon their thought: offer 2 or 3 compelling perspectives, alternative angles, literary refinements, or next-step expansions to ignite further thinking.',
			'Keep your tone inspiring, thoughtful, and crisp.',
		].join('\n'),
	},
	solver: {
		id: 'solver',
		name: '批改解题 (Problem Solver)',
		icon: 'check-circle-2',
		desc: '检查手写算式推导、代码草稿或错题，点拨关键步骤',
		prompt: [
			'You are an exacting, helpful academic tutor and problem solver living in the notes.',
			'The user has handwritten a math derivation, calculation, logic problem, code snippet, or puzzle (attached as an image).',
			'First, decipher their handwriting and step-by-step logic carefully.',
			'Check for any algebraic slips, logical gaps, or bugs. If correct, confirm and show an elegant alternative perspective or verification. If there is a mistake, gently point out where the step diverged and provide the correct step.',
			'Use clear KaTeX math notation for formulas and compact markdown.',
		].join('\n'),
	},
	custom: {
		id: 'custom',
		name: '自定义 (Custom Prompt)',
		icon: 'settings',
		desc: '使用您在设置中自定义的专属系统提示词',
		prompt: '',
	},
};

const FORMAT_INSTRUCTIONS = [
	'Format your response strictly as:',
	'HEARD: <1-line transcription of what the user wrote or sketched>',
	'REPLY: <your formatted response in markdown>',
].join('\n');

export function resolveMagicDiarySystemPrompt(
	preset: MagicDiaryPreset = 'chat',
	customPrompt?: string,
): string {
	let base = '';
	if (preset === 'custom' && customPrompt?.trim()) {
		base = customPrompt.trim();
	} else if (preset in MAGIC_DIARY_PRESETS && preset !== 'custom') {
		base = MAGIC_DIARY_PRESETS[preset].prompt;
	} else if (customPrompt?.trim()) {
		base = customPrompt.trim();
	} else {
		base = MAGIC_DIARY_PRESETS.chat.prompt;
	}

	return `${base}\n\n${FORMAT_INSTRUCTIONS}`;
}

export const MAGIC_DIARY_SYSTEM_PROMPT = resolveMagicDiarySystemPrompt('chat');

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
	preset?: MagicDiaryPreset;
	customPrompt?: string;
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

	const systemPrompt = resolveMagicDiarySystemPrompt(options.preset ?? 'chat', options.customPrompt);
	const media = await prepareProviderMedia(options.svg, provider.mediaFormat);
	const raw = await requestAiCompletion({
		settings: provider,
		systemPrompt,
		userText: 'Read the newly written ink on this page and reply in character.',
		media,
		history: options.history,
	});
	return parseMagicDiaryResponse(raw);
}
