import { TLEditorSnapshot } from '@tldraw/tldraw';
import type { InkCanvasSnapshot } from 'src/ink-canvas/types';

///////////////////////////
///////////////////////////

export type InkFileMetadata = {
    pluginVersion: string;
    fileType: "inkDrawing" | "inkWriting";
    tldrawVersion: string;
    previewIsOutdated?: boolean;
    /** Handwriting transcript (markdown) stored in SVG `<metadata><transcript>…</transcript>`. */
    transcript?: string;
    /** Sorted unique bbox-relative 32px occupancy cells at last successful transcription. */
    bboxCellsAtLastTranscription?: string;
    /** ISO-8601 time when bboxCellsAtLastTranscription was written. */
    lastTranscriptionAt?: string;
    /**
     * ISO-8601 time the user last hand-edited the transcript.
     *
     * While this is set, auto-transcription never overwrites the file: a model that
     * misread 「己」 as 「已」 must not silently undo a correction the next time the
     * embed closes. A manual Transcribe clears it, since that is the user explicitly
     * asking for the machine's version again.
     */
    transcriptEditedAt?: string;
    /** Height in pixels of each ruled line. Stored per-file so existing embeds are unaffected by the global setting. */
    writingLineHeight?: number;
};

export type InkFileData = {
    meta: InkFileMetadata;
    tldraw: TLEditorSnapshot;
    /** Present when file uses `<ink-canvas version="…">` metadata (see `isInkCanvasFile`). */
    inkCanvas?: InkCanvasSnapshot;
    svgString: string;
};


