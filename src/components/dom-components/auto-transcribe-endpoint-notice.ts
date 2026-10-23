import { createNoticeTemplate, createNoticeCtaBar, launchPersistentNotice } from 'src/components/dom-components/notice-components';
import { t } from 'src/i18n';
import { openInkSettingsTab } from 'src/components/dom-components/tabs/settings-tab/settings-tab';
import {
	AUTO_TRANSCRIBE_ACCOUNT_NOTICE_INK_CLOSE_THRESHOLD,
	incrementInkCloseCount,
	isAutoTranscribeAccountNoticeDismissed,
	markAutoTranscribeAccountNoticeDismissed,
} from 'src/logic/device-settings/device-settings';
import { isCustomTranscriptionProviderUsable } from 'src/logic/transcription-providers';
import InkPlugin from 'src/main';

///////////
///////////

let noticeShowingOrDismissed = false;

/**
 * Counts one saved ink close and may suggest configuring an endpoint.
 *
 * This used to invite the user to link an Almost Useful account. The plugin now
 * has no backend of its own, so the only useful prompt is "put in your own key"
 * — and only when there is not one already.
 */
export function recordInkCloseAndMaybeShowEndpointNotice(plugin: InkPlugin): void {
	if (isCustomTranscriptionProviderUsable(plugin.settings.customTranscriptionProvider)) return;
	if (isAutoTranscribeAccountNoticeDismissed()) return;

	const inkCloseCount = incrementInkCloseCount();
	if (inkCloseCount < AUTO_TRANSCRIBE_ACCOUNT_NOTICE_INK_CLOSE_THRESHOLD) return;

	showAutoTranscribeEndpointNotice(plugin);
}

function showAutoTranscribeEndpointNotice(plugin: InkPlugin): void {
	if (noticeShowingOrDismissed) return;
	noticeShowingOrDismissed = true;

	const { noticeBody, scrollAreaEl, footerEl } = createNoticeTemplate();
	scrollAreaEl.createEl('h1').setText(t('Auto-transcribe your ink'));
	scrollAreaEl.createEl('p').setText(
		t('Writing and drawing embeds can be transcribed automatically every time you close them.'),
	);
	scrollAreaEl.createEl('p').setText(
		t('Add a vision model endpoint in the settings — any OpenAI-compatible API works.'),
	);

	const { primaryBtnEl, tertiaryBtnEl } = createNoticeCtaBar(footerEl, {
		primaryLabel: 'Open bimo settings',
		tertiaryLabel: 'Dismiss',
	});

	const notice = launchPersistentNotice(noticeBody);

	const dismissNotice = (): void => {
		notice.hide();
		markAutoTranscribeAccountNoticeDismissed();
	};

	if (tertiaryBtnEl) {
		tertiaryBtnEl.addEventListener('click', () => {
			dismissNotice();
		});
	}

	if (primaryBtnEl) {
		primaryBtnEl.addEventListener('click', () => {
			dismissNotice();
			openInkSettingsTab(plugin);
		});
	}
}
