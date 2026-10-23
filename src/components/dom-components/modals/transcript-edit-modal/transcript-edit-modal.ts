import '../migration-modal/migration-modal.scss';
import './transcript-edit-modal.scss';
import { Modal, Notice, TFile } from 'obsidian';
import InkPlugin from 'src/main';
import { t } from 'src/i18n';
import { saveWriteFileTranscript } from 'src/components/formats/current/utils/needsTranscriptUpdate';
import { patchInkEmbedTranscriptAltsInVault } from 'src/logic/handwriting-transcription-apply';
import { syncTranscriptBlockInVault } from 'src/logic/transcript-block';
import type { HandwritingTranscriptionFileType } from 'src/logic/handwriting-transcription-queue-store';

//////////
//////////

export interface TranscriptEditModalOptions {
	/** SVG (or legacy .writing/.drawing) file whose metadata holds the transcript. */
	inkFile: TFile;
	fileType: HandwritingTranscriptionFileType;
	/** Current transcript, already normalised for display. */
	initialText: string;
	/** Fired after a successful write so the embed can re-render. */
	onSaved?: (transcript: string) => void;
}

/**
 * Plain textarea editor for a transcript.
 *
 * Transcripts are Markdown, so a textarea is honest: what you type is exactly what
 * gets stored, and Obsidian renders it afterwards. Saving marks the file as
 * user-edited, which stops auto-transcription from overwriting the correction on
 * the next embed close (see `InkFileMetadata.transcriptEditedAt`).
 */
export class TranscriptEditModal extends Modal {
	private readonly plugin: InkPlugin;
	private readonly inkFile: TFile;
	private readonly fileType: HandwritingTranscriptionFileType;
	private readonly initialText: string;
	private readonly onSaved?: (transcript: string) => void;

	private textareaEl: HTMLTextAreaElement | null = null;
	private isSaving = false;

	constructor(plugin: InkPlugin, options: TranscriptEditModalOptions) {
		super(plugin.app);
		this.plugin = plugin;
		this.inkFile = options.inkFile;
		this.fileType = options.fileType;
		this.initialText = options.initialText;
		this.onSaved = options.onSaved;
	}

	onOpen() {
		this.titleEl.setText(t('Edit transcript'));
		this.contentEl.addClass('ddc_ink_migration-modal');
		this.contentEl.addClass('ddc_ink_transcript-edit-modal');

		const hint = this.contentEl.createEl('p', {
			text: t('Markdown is preserved as typed. Saving stops automatic transcription from overwriting your edits; run Transcribe again to let the model take over.'),
		});
		hint.addClass('ddc_ink_transcript-edit-hint');

		this.textareaEl = this.contentEl.createEl('textarea', {
			cls: 'ddc_ink_transcript-edit-textarea',
			text: this.initialText,
		});
		this.textareaEl.addEventListener('keydown', (event) => {
			// Ctrl/Cmd+Enter saves — plain Enter must stay a newline in a text field.
			if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
				event.preventDefault();
				void this.save();
			}
		});
		// Focus after the modal has laid out, otherwise the caret lands at position 0.
		window.setTimeout(() => this.textareaEl?.focus(), 0);

		const buttonRow = this.contentEl.createDiv('ddc_ink_transcript-edit-buttons');

		const cancelButton = buttonRow.createEl('button', { text: t('Cancel') });
		cancelButton.addEventListener('click', () => this.close());

		const saveButton = buttonRow.createEl('button', {
			text: t('Save'),
			cls: 'mod-cta',
		});
		saveButton.addEventListener('click', () => { void this.save(); });
	}

	onClose() {
		this.contentEl.empty();
		this.textareaEl = null;
	}

	private async save(): Promise<void> {
		if (this.isSaving) return;
		const next = this.textareaEl?.value ?? '';
		this.isSaving = true;
		try {
			await saveWriteFileTranscript(
				this.plugin,
				this.inkFile,
				next,
				undefined,
				{ markUserEdited: true },
			);
			await patchInkEmbedTranscriptAltsInVault(
				this.plugin,
				this.inkFile.path,
				this.fileType,
				next,
			);
			if (this.plugin.settings.insertTranscriptBelowEmbed) {
				await syncTranscriptBlockInVault(
					this.plugin,
					this.inkFile.path,
					this.fileType,
					next,
				);
			}
			this.onSaved?.(next);
			new Notice(t('Transcript saved'));
			this.close();
		} catch (error) {
			console.debug('笔墨: transcript save failed', error);
			new Notice(t('Could not save the transcript'));
		} finally {
			this.isSaving = false;
		}
	}
}
