import { Notice } from 'obsidian';

import { t } from 'src/i18n';
export async function copyEmbedMarkdownToClipboard(embedStr: string): Promise<boolean> {
	if (!embedStr) {
		new Notice(t('Nothing to copy'));
		return false;
	}

	try {
		await navigator.clipboard.writeText(embedStr);
		new Notice(t('Embed copied to clipboard'));
		return true;
	} catch {
		new Notice(t('Failed to copy embed to clipboard'));
		return false;
	}
}
