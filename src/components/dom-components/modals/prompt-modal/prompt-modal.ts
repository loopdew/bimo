import './prompt-modal.scss';
import { Modal } from 'obsidian';
import type { App } from 'obsidian';
import { t } from 'src/i18n';

//////////
//////////

export interface PromptModalOptions {
	title: string;
	placeholder?: string;
	initialValue?: string;
	/** Description shown above the field. */
	hint?: string;
	submitLabel?: string;
	/** Returned value is trimmed; empty input is rejected and the modal stays open. */
	onSubmit: (value: string) => void;
}

/**
 * Single-line text prompt.
 *
 * Obsidian has a modal for confirmations but none for text entry, and every AI
 * entry point in 笔墨 needs exactly one question before it can run.
 */
export class PromptModal extends Modal {
	private readonly options: PromptModalOptions;
	private inputEl: HTMLInputElement | null = null;

	constructor(app: App, options: PromptModalOptions) {
		super(app);
		this.options = options;
	}

	onOpen() {
		this.titleEl.setText(this.options.title);
		this.contentEl.addClass('ddc_ink_prompt-modal');

		if (this.options.hint) {
			const hint = this.contentEl.createEl('p', {
				text: this.options.hint,
				cls: 'ddc_ink_prompt-modal__hint',
			});
			hint.addClass('ddc_ink_transcript-edit-hint');
		}

		this.inputEl = this.contentEl.createEl('input', {
			type: 'text',
			cls: 'ddc_ink_prompt-modal__input',
		});
		this.inputEl.value = this.options.initialValue ?? '';
		this.inputEl.placeholder = this.options.placeholder ?? '';

		this.inputEl.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				this.submit();
			} else if (event.key === 'Escape') {
				event.preventDefault();
				this.close();
			}
		});

		const buttonRow = this.contentEl.createDiv('ddc_ink_prompt-modal__buttons');
		const cancelButton = buttonRow.createEl('button', { text: t('Cancel') });
		cancelButton.addEventListener('click', () => this.close());
		const submitButton = buttonRow.createEl('button', {
			text: this.options.submitLabel ?? t('OK'),
			cls: 'mod-cta',
		});
		submitButton.addEventListener('click', () => this.submit());

		window.setTimeout(() => {
			this.inputEl?.focus();
			this.inputEl?.select();
		}, 0);
	}

	onClose() {
		this.contentEl.empty();
		this.inputEl = null;
	}

	private submit(): void {
		const value = (this.inputEl?.value ?? '').trim();
		if (!value) return;
		this.close();
		this.options.onSubmit(value);
	}
}
