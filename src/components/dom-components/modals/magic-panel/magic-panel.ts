import './magic-panel.scss';
import { Editor, Modal, Notice } from 'obsidian';
import InkPlugin from 'src/main';
import { t } from 'src/i18n';
import { isAiEndpointUsable, requestAiCompletion } from 'src/logic/ai/client';
import { buildTranscriptContext, MAGIC_PANEL_SYSTEM_PROMPT } from 'src/logic/ai/magic-prompt';
import type { ChatTurn } from 'src/logic/transcription-providers';

//////////
//////////

/** Milliseconds between characters while a reply "writes itself" onto the page. */
const TYPEWRITER_INTERVAL_MS = 16;
const TYPEWRITER_CHARS_PER_TICK = 2;

export interface MagicPanelOptions {
	plugin: InkPlugin;
	/** Note editor to insert into. Optional — the panel still works read-only. */
	editor?: Editor;
	/** Transcript of the handwriting page that opened the panel. */
	contextTranscript?: string;
	sourcePath?: string;
}

interface MessageBubble {
	el: HTMLElement;
	text: string;
}

/**
 * Conversational panel that answers in the voice of a handwritten margin note.
 *
 * Two deliberate choices:
 * - Replies *type themselves on* rather than appearing instantly. A block of text
 *   that materialises is read as "a computer answered"; the same text appearing
 *   stroke by stroke is read as writing. It is the cheapest part of the "magic
 *   journal" feel and costs nothing in correctness.
 * - The panel never modifies the note on its own. Every insertion is an explicit
 *   click, because an assistant that writes into the page unasked is a liability.
 */
export class MagicPanel extends Modal {
	private readonly plugin: InkPlugin;
	private readonly editor?: Editor;
	private readonly systemPrompt: string;
	private readonly history: ChatTurn[] = [];

	private logEl: HTMLElement | null = null;
	private inputEl: HTMLTextAreaElement | null = null;
	private sendButton: HTMLButtonElement | null = null;
	private bubbles: MessageBubble[] = [];
	private isBusy = false;
	private typewriterTimer: number | null = null;

	constructor(options: MagicPanelOptions) {
		super(options.plugin.app);
		this.plugin = options.plugin;
		this.editor = options.editor;
		this.systemPrompt = MAGIC_PANEL_SYSTEM_PROMPT + buildTranscriptContext(options.contextTranscript);
	}

	onOpen() {
		this.modalEl.addClass('ddc_ink_magic-panel');
		this.titleEl.setText(t('Magic margin'));
		this.contentEl.addClass('ddc_ink_magic-panel__content');

		this.logEl = this.contentEl.createDiv('ddc_ink_magic-panel__log');
		this.appendAssistantNote(t('Write a line; I will answer in the margin.'));

		const composer = this.contentEl.createDiv('ddc_ink_magic-panel__composer');
		this.inputEl = composer.createEl('textarea', {
			cls: 'ddc_ink_magic-panel__input',
			attr: { rows: '2', placeholder: t('Ask anything…') },
		});
		this.inputEl.addEventListener('keydown', (event) => {
			// Enter sends; Shift+Enter keeps a newline (a handwritten note can wrap).
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				void this.send();
			}
		});
		window.setTimeout(() => this.inputEl?.focus(), 0);

		const actions = composer.createDiv('ddc_ink_magic-panel__actions');
		this.sendButton = actions.createEl('button', {
			text: t('Send'),
			cls: 'mod-cta',
		});
		this.sendButton.addEventListener('click', () => { void this.send(); });

		if (this.editor) {
			const insertButton = actions.createEl('button', { text: t('Insert last reply') });
			insertButton.addEventListener('click', () => this.insertLastReply());
		}
	}

	onClose() {
		if (this.typewriterTimer !== null) {
			window.clearInterval(this.typewriterTimer);
			this.typewriterTimer = null;
		}
		this.contentEl.empty();
		this.logEl = null;
		this.inputEl = null;
		this.sendButton = null;
		this.bubbles = [];
	}

	//////////

	private appendBubble(role: 'user' | 'assistant', text: string): MessageBubble {
		const log = this.logEl;
		if (!log) return { el: document.createElement('div'), text };
		const el = log.createDiv(`ddc_ink_magic-panel__bubble ddc_ink_magic-panel__bubble--${role}`);
		el.setText(text);
		log.scrollTop = log.scrollHeight;
		const bubble: MessageBubble = { el, text };
		this.bubbles.push(bubble);
		return bubble;
	}

	private appendAssistantNote(text: string): void {
		const bubble = this.appendBubble('assistant', text);
		bubble.el.addClass('ddc_ink_magic-panel__bubble--hint');
	}

	/** Types `text` into the bubble two characters at a time. */
	private typeIntoBubble(bubble: MessageBubble, text: string): void {
		if (this.typewriterTimer !== null) {
			window.clearInterval(this.typewriterTimer);
			this.typewriterTimer = null;
		}
		let cursor = 0;
		// Record the full text immediately: the insert button must not depend on
		// whether the animation finished.
		bubble.text = text;
		bubble.el.setText('');
		bubble.el.addClass('ddc_ink_magic-panel__bubble--writing');

		const finish = () => {
			if (this.typewriterTimer !== null) {
				window.clearInterval(this.typewriterTimer);
				this.typewriterTimer = null;
			}
			bubble.el.setText(text);
			bubble.el.removeClass('ddc_ink_magic-panel__bubble--writing');
			this.logEl?.scrollTo({ top: this.logEl.scrollHeight });
		};

		// A click on the bubble skips the animation — nobody wants to wait for text
		// they can already see arriving.
		bubble.el.addEventListener('click', finish, { once: true });

		this.typewriterTimer = window.setInterval(() => {
			cursor = Math.min(text.length, cursor + TYPEWRITER_CHARS_PER_TICK);
			bubble.el.setText(text.slice(0, cursor));
			this.logEl?.scrollTo({ top: this.logEl.scrollHeight });
			if (cursor >= text.length) finish();
		}, TYPEWRITER_INTERVAL_MS);
	}

	private async send(): Promise<void> {
		if (this.isBusy) return;
		const input = this.inputEl?.value.trim() ?? '';
		if (!input) return;

		const provider = this.plugin.settings.customTranscriptionProvider;
		if (!isAiEndpointUsable(provider)) {
			new Notice(t('Enable a custom API in settings first.'));
			return;
		}

		if (this.inputEl) this.inputEl.value = '';
		this.appendBubble('user', input);

		this.isBusy = true;
		if (this.sendButton) this.sendButton.disabled = true;
		const pending = this.appendBubble('assistant', '…');

		try {
			const reply = await requestAiCompletion({
				settings: provider,
				systemPrompt: this.systemPrompt,
				userText: input,
				media: null,
				history: [...this.history],
			});

			this.history.push({ role: 'user', text: input });
			this.history.push({ role: 'assistant', text: reply });
			// Keep the exchange bounded so a long session does not silently grow the
			// prompt until the endpoint rejects it.
			while (this.history.length > 12) this.history.shift();

			this.typeIntoBubble(pending, reply.trim());
		} catch (error) {
			console.debug('笔墨: magic panel request failed', error);
			pending.el.setText(t('Could not reach the endpoint. Check the settings and the key.'));
			pending.el.addClass('ddc_ink_magic-panel__bubble--error');
		} finally {
			this.isBusy = false;
			if (this.sendButton) this.sendButton.disabled = false;
			this.inputEl?.focus();
		}
	}

	private insertLastReply(): void {
		const reply = [...this.bubbles]
			.reverse()
			.find((bubble) => bubble.el.hasClass('ddc_ink_magic-panel__bubble--assistant')
				&& !bubble.el.hasClass('ddc_ink_magic-panel__bubble--hint')
				&& !bubble.el.hasClass('ddc_ink_magic-panel__bubble--error'));
		if (!reply || !this.editor) return;
		this.editor.replaceSelection(reply.text);
		new Notice(t('Inserted into the note'));
		this.close();
	}
}
