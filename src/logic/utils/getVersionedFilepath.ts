import { Notice } from "obsidian";
import { t } from 'src/i18n';
import InkPlugin from "src/main";
import { parseFilepath } from "./parseFilepath";

////////
////////

export const getVersionedFilepath = async (plugin: InkPlugin, seedFilepath: string): Promise<string> => {
    try {
        const {
            folderpath, basename, ext
        } = parseFilepath(seedFilepath);
        let pathAndBasename = folderpath + '/' + basename;

        let pathAndVersionedBasename = pathAndBasename;
        let version = 1;
        while (await plugin.app.vault.adapter.exists(`${pathAndVersionedBasename}.${ext}`)) {
            version++;
            pathAndVersionedBasename = pathAndBasename + ' (' + version + ')';
        }

        return `${pathAndVersionedBasename}.${ext}`;
    } catch (err) {
        console.warn(err);
        new Notice(t(`There was an error finding a non-conflicting filename.`), 0);
        return '';
    }
};
