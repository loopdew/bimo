import InkPlugin from "src/main";
import { buildInkCanvasWritingFileData } from "src/components/formats/current/utils/build-file-data";
import { getNewTimestampedWritingSvgFilepath } from "src/logic/utils/file-manipulation";
import { createFoldersForFilepath } from "src/logic/utils/createFoldersForFilepath";
import { TFile } from "obsidian";
import { buildFileStr } from "src/components/formats/current/utils/buildFileStr";
import { WRITING_LINE_HEIGHT, WRITING_PAGE_WIDTH } from "src/constants";
import type { InkCanvasSnapshot } from "src/ink-canvas/types";
import { renderWritingStrokesToSvg } from "src/ink-canvas/svg-export";

////////
////////

export const createNewWritingFile = async (plugin: InkPlugin, instigatingFile?: TFile | null) => {
    const filepath = await getNewTimestampedWritingSvgFilepath(plugin, instigatingFile);
    const lineHeight = plugin.settings.writingLineHeight ?? WRITING_LINE_HEIGHT;
    const inkCanvasSnapshot: InkCanvasSnapshot = {
        version: 1,
        strokes: [],
        gridEnabled: false,
        writingLineHeight: lineHeight,
    };
    const svgString = renderWritingStrokesToSvg([], inkCanvasSnapshot, WRITING_PAGE_WIDTH);
    // The line height has always lived in the snapshot; mirroring it into the
    // `<ink>` attribute keeps new files shaped like converted ones, so a reader
    // that only looks at metadata still gets the right value.
    const pageData = buildInkCanvasWritingFileData({
        inkCanvasSnapshot,
        svgString,
        meta: { writingLineHeight: lineHeight },
    });
    await createFoldersForFilepath(plugin, filepath);
    const fileRef = await plugin.app.vault.create(filepath, buildFileStr(pageData));
    return fileRef;
}
