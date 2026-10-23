import type { CustomTranscriptionProviderSettings } from 'src/logic/transcription-providers';
import type { ProviderMedia } from 'src/logic/transcription-providers/media';
import { requestAiCompletion } from './client';

//////////
//////////

/**
 * Caption rules.
 *
 * The alt text is the only part of an embed that Obsidian indexes, so the
 * caption has to read like a sentence a human would search for — not like a
 * transcription. Brevity matters: an alt over ~60 characters is truncated in
 * previews.
 */
export const CAPTION_SYSTEM_PROMPT = [
	'你在为一张手写笔记图片写题注。',
	'',
	'规则：',
	'1. 只输出一行题注，不超过 40 个汉字。',
	'2. 说清这张纸写了什么主题，不要逐字复述内容。',
	'3. 不要写「这张图」「图片中」「题注：」之类的前缀。',
	'4. 不要加引号、书名号、井号、星号等任何标记。',
	'5. 如果内容无法辨认，输出「无法辨认的手写内容」。',
].join('\n');

export const CAPTION_USER_INSTRUCTION = '为这张手写图片写一行题注。';

/**
 * Cleans model output into a single-line caption.
 *
 * Models wrap their answer in quotes, add a `题注：` prefix, or answer with a
 * Markdown heading despite being told not to. All three would leak into the
 * image alt where they are pure noise.
 */
export function cleanCaption(raw: string): string {
	let text = (raw ?? '').trim();
	if (!text) return '';

	// Keep the first non-empty line: alt text cannot contain newlines.
	const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0);
	text = firstLine ?? '';

	text = text
		.replace(/^#{1,6}\s*/, '')
		.replace(/^(题注|caption|alt)\s*[:：]\s*/i, '')
		.replace(/^\*\*(.*)\*\*$/, '$1')
		.replace(/^["'“”「『](.*)["'“”」』]$/, '$1')
		.trim();

	// Obsidian image alt breaks on `]` and `|`.
	text = text.replace(/[[\]|]/g, ' ').replace(/\s+/g, ' ').trim();

	if (text.length > 60) {
		text = `${text.slice(0, 59).trimEnd()}…`;
	}
	return text;
}

/** One caption request against the configured endpoint. Returns `''` on a blank answer. */
export async function requestImageCaption(
	media: ProviderMedia,
	settings: CustomTranscriptionProviderSettings,
): Promise<string> {
	const raw = await requestAiCompletion({
		settings,
		systemPrompt: CAPTION_SYSTEM_PROMPT,
		userText: CAPTION_USER_INSTRUCTION,
		media,
	});
	return cleanCaption(raw);
}
