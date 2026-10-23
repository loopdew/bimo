import { createNoticeTemplate, createNoticeCtaBar, launchPersistentNotice } from 'src/components/dom-components/notice-components';
import { t } from 'src/i18n';
import { isIpad } from 'src/logic/utils/isIpad';
import InkPlugin from "src/main";

///////////
///////////

export function showWelcomeTips_maybe(plugin: InkPlugin): boolean {
    // Bail if it's already been shown enough times
    if(plugin.settings.onboardingTips.welcomeTipRead) return false;
    void showWelcomeTips(plugin);
    return true;
}

let tipsShowingOrDismissed: boolean = false;
export async function showWelcomeTips(plugin: InkPlugin) {
    if(tipsShowingOrDismissed) return;
    tipsShowingOrDismissed = true;

    const { noticeBody, scrollAreaEl, footerEl } = createNoticeTemplate(1,3);
    scrollAreaEl.createEl('h1').setText(t(`Welcome to ink`));
    scrollAreaEl.createEl('p').setText(t(`笔墨 is all about enabling pen use directly in your Markdown notes.`));
    scrollAreaEl.createEl('p').setText(t(`Here's a quick rundown to help you get started...`));
    
    const {
        primaryBtnEl,
        tertiaryBtnEl
    } = createNoticeCtaBar(footerEl, {
        primaryLabel: `Read now`,
        tertiaryLabel: 'Remind me later',
    })
    
    const notice = launchPersistentNotice(noticeBody);

    if(tertiaryBtnEl) {
        tertiaryBtnEl.addEventListener('click', () => {
            notice.hide();
        });
    }
    if(primaryBtnEl) {
        primaryBtnEl.addEventListener('click', () => {
            notice.hide();
            showHandwritingWelcomeTip(plugin);
        });
    }

}

function showHandwritingWelcomeTip(plugin: InkPlugin) {
    const { noticeBody, scrollAreaEl, footerEl } = createNoticeTemplate();
    scrollAreaEl.createEl('h1').setText(t(`Inserting handwriting sections...`));
    scrollAreaEl.createEl('p').setText(t(`In any Markdown note, run the following command to begin writing where your Cursor is.`));
    // Keep command-name casing as shown in the command palette.
    scrollAreaEl.createEl('blockquote').setText(t(`"笔墨: new handwriting section"`));
    scrollAreaEl.createEl('p').setText(t(`( Cmd+P or swipe down )`));
    
    const {
        primaryBtnEl,
    } = createNoticeCtaBar(footerEl, {
        primaryLabel: 'Continue',
        tertiaryLabel: 'Dismiss for now',
    })

    const notice = launchPersistentNotice(noticeBody);

    if(primaryBtnEl) {
        primaryBtnEl.addEventListener('click', () => {
            notice.hide();
            showDrawingWelcomeTip(plugin);
        });
    }
    
}

function showDrawingWelcomeTip(plugin: InkPlugin) {
    const { noticeBody, scrollAreaEl, footerEl } = createNoticeTemplate();
    scrollAreaEl.createEl('h1').setText(t(`Drawing sections...`));
    scrollAreaEl.createEl('p').setText(t(`These can be added too and can be resized right in your Markdown file. Use the purple lock icon to save framing, or the standard lock icon to save the drawing but revert the framing.`));
    // Keep command-name casing as shown in the command palette.
    scrollAreaEl.createEl('blockquote').setText(t(`"笔墨: new drawing"`));

    const {
        primaryBtnEl,
    } = createNoticeCtaBar(footerEl, {
        primaryLabel: 'Continue',
        tertiaryLabel: 'Dismiss for now',
    })

    const notice = launchPersistentNotice(noticeBody);

    if(primaryBtnEl) {
        primaryBtnEl.addEventListener('click', () => {
            notice.hide();
            // if(isIpad()) {
            //     showiPadWelcomeTip(plugin);
            // } else {
                showSyncingWelcomeTip(plugin);
            // }
        });
    }
    
}

function showiPadWelcomeTip(plugin: InkPlugin) {
    const { noticeBody, scrollAreaEl, footerEl } = createNoticeTemplate();
    scrollAreaEl.createEl('h1').setText(`Placeholder...`);
    scrollAreaEl.createEl('p').setText(`Placeholder.`);

    const {
        primaryBtnEl,
    } = createNoticeCtaBar(footerEl, {
        primaryLabel: 'Continue',
        tertiaryLabel: 'Dismiss for now',
    })

    const notice = launchPersistentNotice(noticeBody);

    if(primaryBtnEl) {
        primaryBtnEl.addEventListener('click', () => {
            notice.hide();
            showSyncingWelcomeTip(plugin);
        });
    }
    
}

function showSyncingWelcomeTip(plugin: InkPlugin) {
    const { noticeBody, scrollAreaEl, footerEl } = createNoticeTemplate();
    scrollAreaEl.createEl('h1').setText(t(`Syncing with your vault...`));
    scrollAreaEl.createEl('p').setText(t(`笔墨 files live in your vault and can sync with it to other devices.`));
    scrollAreaEl.createEl('p').setText(t(`If using Obsidian Sync, turn on "sync all other types" in the Obsidian Sync settings.`));

    const {
        primaryBtnEl,
    } = createNoticeCtaBar(footerEl, {
        primaryLabel: 'Continue',
        tertiaryLabel: 'Dismiss for now',
    })

    const notice = launchPersistentNotice(noticeBody);

    if(primaryBtnEl) {
        primaryBtnEl.addEventListener('click', () => {
            notice.hide();
            plugin.settings.onboardingTips.welcomeTipRead = true;
            plugin.settings.onboardingTips.lastVersionTipRead = plugin.manifest.version;
            void plugin.saveSettings();
        });
    }
    
}


