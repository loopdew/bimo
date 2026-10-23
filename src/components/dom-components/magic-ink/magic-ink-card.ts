import './magic-ink-card.scss';
import { Component, MarkdownRenderer } from 'obsidian';
import { getGlobals } from 'src/stores/global-store';
import { t } from 'src/i18n';

//////////
//////////

/** Milliseconds between characters while the reply writes itself in. */
const TYPE_INTERVAL_MS = 26;
const TYPE_CHARS_PER_TICK = 1;

export interface MagicInkCardOptions {
	/** Called when the user asks for the reply to be inserted into the note. */
	onInsert?: (text: string) => void;
	onClose?: () => void;
	/** Called when the user asks for another reply without writing more. */
	onAskAgain?: () => void;
}

/**
 * The margin card that appears where the eye already is: pinned to the writing
 * surface, not a modal, not a sidebar.
 *
 * It deliberately never takes focus. The whole premise is "write, pause, the
 * answer appears, keep writing" — a card that steals the caret would break the
 * one thing the feature exists to protect.
 */
export class MagicInkCard {
	private readonly host: HTMLElement;
	private readonly options: MagicInkCardOptions;
	private el: HTMLDivElement | null = null;
	private bodyEl: HTMLDivElement | null = null;
	private actionsEl: HTMLDivElement | null = null;
	private typeTimer: number | null = null;
	private replyText = '';
	private removeTimer: number | null = null;
	private component = new Component();

	constructor(host: HTMLElement, options: MagicInkCardOptions = {}) {
		this.component.load();
		this.host = host;
		this.options = options;
	}

	get isVisible(): boolean {
		return this.el !== null;
	}

	get currentReply(): string {
		return this.replyText;
	}

	/** Picks the empty half of the page so the answer never covers the last line. */
	setPlacement(placement: 'top' | 'bottom'): void {
		this.ensureElement();
		const el = this.el;
		if (!el) return;
		el.toggleClass('ddc_ink_magic-ink--top', placement === 'top');
	}

	/** "Listening" state: the card is on screen but silent. */
	showPending(): void {
		this.ensureElement();
		this.clearTypewriter();
		this.replyText = '';
		if (this.bodyEl) {
			this.bodyEl.empty();
			this.bodyEl.addClass('ddc_ink_magic-ink__body--pending');
			this.bodyEl.createSpan({ cls: 'ddc_ink_magic-ink__dots', text: '' });
		}
		this.actionsEl?.empty();
		this.el?.addClass('ddc_ink_magic-ink--visible');
	}

	/** Types the reply in, one character at a time. */
	showReply(text: string): void {
		this.ensureElement();
		this.clearTypewriter();
		const trimmed = text.trim();
		this.replyText = trimmed;
		const body = this.bodyEl;
		if (!body) return;

		body.removeClass('ddc_ink_magic-ink__body--pending');
		body.setText('');
		this.el?.addClass('ddc_ink_magic-ink--visible');

		let cursor = 0;
		this.typeTimer = window.setInterval(() => {
			cursor = Math.min(trimmed.length, cursor + TYPE_CHARS_PER_TICK);
			body.setText(trimmed.slice(0, cursor));
			if (cursor >= trimmed.length) {
				this.clearTypewriter();
				this.renderMarkdown(body, trimmed);
				this.renderActions();
			}
		}, TYPE_INTERVAL_MS);

		// A click on the card finishes the animation immediately; nobody wants to
		// wait for text they can already see arriving.
		body.onclick = () => {
			this.clearTypewriter();
			this.renderMarkdown(body, trimmed);
			this.renderActions();
		};
	}

	private renderMarkdown(body: HTMLElement, markdown: string): void {
		try {
			const app = getGlobals().plugin.app;
			body.empty();
			void MarkdownRenderer.render(app, markdown, body, '', this.component);
		} catch {
			body.setText(markdown);
		}
	}

	showError(message: string): void {
		this.ensureElement();
		this.clearTypewriter();
		this.replyText = '';
		const body = this.bodyEl;
		if (!body) return;
		body.removeClass('ddc_ink_magic-ink__body--pending');
		body.setText(message);
		body.addClass('ddc_ink_magic-ink__body--error');
		this.el?.addClass('ddc_ink_magic-ink--visible');
		this.renderActions();
	}

	hide(): void {
		this.clearTypewriter();
		if (this.removeTimer !== null) {
			window.clearTimeout(this.removeTimer);
			this.removeTimer = null;
		}
		const el = this.el;
		if (!el) return;
		el.removeClass('ddc_ink_magic-ink--visible');
		this.removeTimer = window.setTimeout(() => {
			el.remove();
			if (this.el === el) this.el = null;
			this.bodyEl = null;
			this.actionsEl = null;
			this.removeTimer = null;
		}, 220);
	}

	destroy(): void {
		this.clearTypewriter();
		if (this.removeTimer !== null) {
			window.clearTimeout(this.removeTimer);
			this.removeTimer = null;
		}
		this.component.unload();
		this.el?.remove();
		this.el = null;
		this.bodyEl = null;
		this.actionsEl = null;
	}

	//////////

	private ensureElement(): void {
		if (this.el) return;
		if (this.removeTimer !== null) {
			window.clearTimeout(this.removeTimer);
			this.removeTimer = null;
		}
		const el = this.host.createDiv('ddc_ink_magic-ink');
		el.setAttr('role', 'status');
		el.setAttr('aria-live', 'polite');

		const header = el.createDiv('ddc_ink_magic-ink__header');
		header.createSpan({ cls: 'ddc_ink_magic-ink__signature', text: t('Magic margin') });
		const closeButton = header.createEl('button', {
			cls: 'ddc_ink_magic-ink__close',
			attr: { 'aria-label': t('Dismiss') },
			text: '×',
		});
		closeButton.addEventListener('click', () => {
			this.hide();
			this.options.onClose?.();
		});

		this.bodyEl = el.createDiv('ddc_ink_magic-ink__body');
		this.actionsEl = el.createDiv('ddc_ink_magic-ink__actions');
		this.el = el;
	}

	private renderActions(): void {
		const actions = this.actionsEl;
		if (!actions) return;
		actions.empty();

		if (this.replyText && this.options.onInsert) {
			const insertButton = actions.createEl('button', {
				text: t('Insert into note'),
				cls: 'ddc_ink_magic-ink__action',
			});
			insertButton.addEventListener('click', () => {
				this.options.onInsert?.(this.replyText);
			});
		}
		if (this.options.onAskAgain) {
			const againButton = actions.createEl('button', {
				text: t('Answer again'),
				cls: 'ddc_ink_magic-ink__action',
			});
			againButton.addEventListener('click', () => {
				this.options.onAskAgain?.();
			});
		}
	}

	private clearTypewriter(): void {
		if (this.typeTimer !== null) {
			window.clearInterval(this.typeTimer);
			this.typeTimer = null;
		}
		if (this.bodyEl) this.bodyEl.onclick = null;
	}
}
