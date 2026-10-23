import { MarkdownView, TFile } from 'obsidian';
import { Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import InkPlugin from 'src/main';
import { t } from 'src/i18n';
import {
	buildInkEmbedAnyAltPattern,
	findNotesContainingInkEmbedAnyAlt,
} from 'src/logic/handwriting-transcription-apply';
import type { HandwritingTranscriptionFileType } from 'src/logic/handwriting-transcription-queue-store';

//////////
//////////

/**
 * Markers around the mirrored transcript block.
 *
 * HTML comments survive every Markdown renderer and give the next transcription
 * an exact range to replace. A user who decides they no longer want the mirror
 * can simply delete the block — nothing else references it, and the plugin never
 * recreates it unless `insertTranscriptBelowEmbed` is on.
 */
export const TRANSCRIPT_BLOCK_START = '<!-- bimo:transcript:start -->';
export const TRANSCRIPT_BLOCK_END = '<!-- bimo:transcript:end -->';

interface TextChange {
	from: number;
	to: number;
	insert: string;
}

/**
 * Builds the collapsible callout that mirrors a transcript.
 *
 * Folded by default (`-` after the callout type) so a long transcription never
 * pushes the user's own prose down the page. Blank lines become a bare `>` to
 * stay inside the callout.
 */
export function buildTranscriptBlockMarkup(transcript: string): string {
	const lines = transcript.replace(/\r\n/g, '\n').split('\n');
	const quoted = lines.map((line) => (line.trim().length === 0 ? '>' : `> ${line}`));
	return [
		TRANSCRIPT_BLOCK_START,
		`> [!note]- ${t('Transcript')}`,
		...quoted,
		TRANSCRIPT_BLOCK_END,
	].join('\n');
}

/** Character offset just past the end of the line that contains `offset`. */
function lineEndOffset(markdown: string, offset: number): number {
	const newlineIndex = markdown.indexOf('\n', offset);
	return newlineIndex === -1 ? markdown.length : newlineIndex;
}

/** Index of the first character after `lineEndOffset`, i.e. the start of the next line. */
function nextLineStart(markdown: string, lineEnd: number): number {
	return lineEnd >= markdown.length ? markdown.length : lineEnd + 1;
}

/**
 * Finds the transcript block that already sits directly under an embed line,
 * skipping blank lines. Returns `null` when the next non-empty line is not our
 * start marker.
 */
function findExistingBlockRange(
	markdown: string,
	afterLine: number,
): { from: number; to: number } | null {
	let cursor = nextLineStart(markdown, afterLine);
	let blankLines = 0;
	// Allow a single blank separator line; more than that means the block was
	// moved away and a new insert is the honest behaviour.
	while (cursor < markdown.length && blankLines < 2) {
		const end = lineEndOffset(markdown, cursor);
		const line = markdown.slice(cursor, end).trim();
		if (line.length === 0) {
			blankLines += 1;
			cursor = nextLineStart(markdown, end);
			continue;
		}
		if (line !== TRANSCRIPT_BLOCK_START) return null;
		const endIndex = markdown.indexOf(TRANSCRIPT_BLOCK_END, end);
		if (endIndex === -1) return null;
		return { from: cursor, to: endIndex + TRANSCRIPT_BLOCK_END.length };
	}
	return null;
}

/**
 * Changes that (re)place the transcript mirror for every embed of `svgFilePath`.
 *
 * The embed line itself is left alone — the alt patch owns that range — so these
 * hunks only ever touch text after the line's terminating newline.
 */
export function listTranscriptBlockChanges(
	markdown: string,
	embedLinePattern: RegExp,
	transcript: string,
): TextChange[] {
	const blockMarkup = buildTranscriptBlockMarkup(transcript);
	const changes: TextChange[] = [];
	const globalPattern = new RegExp(embedLinePattern.source, 'gm');

	for (const match of markdown.matchAll(globalPattern)) {
		const matchIndex = match.index;
		if (matchIndex === undefined) continue;
		const lineEnd = lineEndOffset(markdown, matchIndex);
		const existing = findExistingBlockRange(markdown, lineEnd);
		if (existing) {
			changes.push({ from: existing.from, to: existing.to, insert: blockMarkup });
			continue;
		}
		// Insert after the line, keeping one blank line between the embed and the
		// callout so Obsidian does not merge them into the same paragraph.
		const insertAt = lineEnd;
		changes.push({ from: insertAt, to: insertAt, insert: `\n\n${blockMarkup}` });
	}
	return changes;
}

/**
 * Markdown-only rewrite, used for notes that are not open in an editor.
 */
export function syncTranscriptBlockInMarkdown(
	markdown: string,
	embedLinePattern: RegExp,
	transcript: string,
): string {
	const changes = listTranscriptBlockChanges(markdown, embedLinePattern, transcript);
	if (changes.length === 0) return markdown;
	const ordered = [...changes].sort((left, right) => right.from - left.from);
	let output = markdown;
	for (const change of ordered) {
		output = output.slice(0, change.from) + change.insert + output.slice(change.to);
	}
	return output;
}

/**
 * Applies the mirror to every note that embeds this SVG.
 *
 * Open notes go through CodeMirror so the cursor and the live embed widget are
 * not rebuilt; everything else is edited on disk. Failures are swallowed per
 * note — a read-only vault must not turn a successful transcription into an error.
 */
export async function syncTranscriptBlockInVault(
	plugin: InkPlugin,
	svgFilePath: string,
	fileType: HandwritingTranscriptionFileType,
	transcript: string,
): Promise<void> {
	const embedLinePattern = buildInkEmbedAnyAltPattern(svgFilePath, fileType, false);
	const notes = await findNotesContainingInkEmbedAnyAlt(plugin, svgFilePath, fileType);
	for (const note of notes) {
		try {
			const updatedInEditor = syncTranscriptBlockInOpenEditor(
				plugin,
				note,
				embedLinePattern,
				transcript,
			);
			if (updatedInEditor) continue;
			await syncTranscriptBlockInClosedNote(plugin, note, embedLinePattern, transcript);
		} catch (error) {
			console.debug('笔墨: transcript block sync failed for', note.path, error);
		}
	}
}

function syncTranscriptBlockInOpenEditor(
	plugin: InkPlugin,
	note: TFile,
	embedLinePattern: RegExp,
	transcript: string,
): boolean {
	const leaves = plugin.app.workspace.getLeavesOfType('markdown');
	let didFindOpenEditor = false;
	for (const leaf of leaves) {
		const view = leaf.view;
		if (!(view instanceof MarkdownView)) continue;
		if (view.file?.path !== note.path) continue;
		const editor = view.editor;
		if (!editor) continue;
		didFindOpenEditor = true;

		const cmUnknown: unknown = Reflect.get(editor, 'cm');
		if (!cmUnknown || typeof cmUnknown !== 'object' || !('state' in cmUnknown)) {
			const currentText = editor.getValue();
			const changes = listTranscriptBlockChanges(currentText, embedLinePattern, transcript);
			applyChangesThroughObsidianEditor(editor, currentText, changes);
			continue;
		}

		const cmEditorView = cmUnknown as EditorView;
		const currentText = cmEditorView.state.doc.toString();
		const changes = listTranscriptBlockChanges(currentText, embedLinePattern, transcript);
		if (changes.length === 0) continue;
		cmEditorView.dispatch({
			changes,
			annotations: [Transaction.addToHistory.of(false)],
		});
	}
	return didFindOpenEditor;
}

function applyChangesThroughObsidianEditor(
	editor: { replaceRange: (text: string, from: unknown, to?: unknown) => void },
	currentText: string,
	changes: TextChange[],
): void {
	const ordered = [...changes].sort((left, right) => right.from - left.from);
	for (const change of ordered) {
		editor.replaceRange(
			change.insert,
			offsetToEditorPos(currentText, change.from),
			offsetToEditorPos(currentText, change.to),
		);
	}
}

function offsetToEditorPos(markdown: string, offset: number): { line: number; ch: number } {
	let line = 0;
	let lineStart = 0;
	const bounded = Math.min(Math.max(offset, 0), markdown.length);
	for (let index = 0; index < bounded; index += 1) {
		if (markdown.charCodeAt(index) === 10) {
			line += 1;
			lineStart = index + 1;
		}
	}
	return { line, ch: bounded - lineStart };
}

async function syncTranscriptBlockInClosedNote(
	plugin: InkPlugin,
	note: TFile,
	embedLinePattern: RegExp,
	transcript: string,
): Promise<void> {
	const vault = plugin.app.vault;
	if (typeof vault.process === 'function') {
		await vault.process(note, (data) => syncTranscriptBlockInMarkdown(data, embedLinePattern, transcript));
		return;
	}
	const currentText = await vault.read(note);
	const updated = syncTranscriptBlockInMarkdown(currentText, embedLinePattern, transcript);
	if (updated === currentText) return;
	await vault.modify(note, updated);
}
