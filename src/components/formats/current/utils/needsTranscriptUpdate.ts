import { TFile } from "obsidian";
import { InkFileData } from "../types/file-data";
import InkPlugin from "src/main";
import { extractInkJsonFromSvg } from "src/logic/utils/extractInkJsonFromSvg";
import { buildFileStr } from "./buildFileStr";
import { serializeBboxCellsAtLastTranscription } from "src/logic/stroke-bbox-cells";
import { normalizeInkTranscriptMarkdown } from "src/logic/normalize-ink-transcript-markdown";

////////
////////

export const needsTranscriptUpdate = (pageData: InkFileData): boolean => {
    // TODO: Also check if the transcript is older than the last file update
    // if(!pageData.meta.transcript) {
    // return true;
    // } else {
    return false;
    // }
};

/**
 * Writes a transcript onto current-format ink SVG metadata (`<transcript>…</transcript>`).
 * Optionally stores bbox occupancy snapshot on `<ink>` after a successful apply.
 * Preserves the file mtime so transcript updates do not look like a content edit.
 */
export const saveWriteFileTranscript = async (
    plugin: InkPlugin,
    fileRef: TFile,
    transcript: string,
    transcriptionFingerprint?: {
        lastTranscriptionAt: string;
        /** 笔墨 that this transcript describes. Omit to fingerprint strokes now on disk. */
        bboxCellsAtLastTranscription?: string;
    },
    options?: {
        /**
         * `true` when the user typed the transcript themselves: future auto-runs skip
         * this file until the user asks for a fresh transcription.
         */
        markUserEdited?: boolean;
    },
) => {
    const v = plugin.app.vault;
    const pageDataStr = await v.read(fileRef);
    const pageData = extractInkJsonFromSvg(pageDataStr);
    if (!pageData) return;

    // Flourish glyphs only. Blank lines stay, because they are real markdown breaks.
    pageData.meta.transcript = normalizeInkTranscriptMarkdown(transcript);
    if (options?.markUserEdited) {
        pageData.meta.transcriptEditedAt = new Date().toISOString();
    } else {
        // A machine transcript (or a manual re-transcribe request) owns the text again.
        delete pageData.meta.transcriptEditedAt;
    }
    if (transcriptionFingerprint) {
        const transcribedBboxCells = transcriptionFingerprint.bboxCellsAtLastTranscription;
        if (transcribedBboxCells) {
            // Held results describe the ink that was sent. Re-fingerprinting strokes
            // saved while the editor stayed open would hide that later change.
            pageData.meta.bboxCellsAtLastTranscription = transcribedBboxCells;
        } else {
            // Occupancy fingerprint only on successful apply — from stroke geometry now on disk.
            pageData.meta.bboxCellsAtLastTranscription = serializeBboxCellsAtLastTranscription(pageData);
        }
        pageData.meta.lastTranscriptionAt = transcriptionFingerprint.lastTranscriptionAt;
    }
    const newPageDataStr = buildFileStr(pageData);

    await v.modify(fileRef, newPageDataStr, { mtime: fileRef.stat.mtime });
};
