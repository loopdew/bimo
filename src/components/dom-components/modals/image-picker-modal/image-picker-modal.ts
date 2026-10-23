import { App, FuzzySuggestModal, TFile } from 'obsidian';
import { t } from 'src/i18n';

//////////
//////////

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'avif']);

export function listVaultImages(app: App): TFile[] {
	return app.vault
		.getFiles()
		.filter((file) => IMAGE_EXTENSIONS.has(file.extension.toLowerCase()));
}

/**
 * Picks any vault file with one of the given extensions.
 *
 * Callback style rather than a promise: `FuzzySuggestModal` gives no reliable
 * "cancelled" signal, and a dangling promise would be worse than simply doing
 * nothing when the user presses Escape.
 */
export function pickVaultFile(
	app: App,
	extensions: string[],
	onPick: (file: TFile) => void,
	options?: { placeholder?: string },
): void {
	const allowed = new Set(extensions.map((extension) => extension.toLowerCase()));
	const files = app.vault
		.getFiles()
		.filter((file) => allowed.has(file.extension.toLowerCase()));

	const modal = new (class extends FuzzySuggestModal<TFile> {
		getItems(): TFile[] {
			return files;
		}

		getItemText(file: TFile): string {
			return file.path;
		}

		onChooseItem(file: TFile): void {
			onPick(file);
		}

		onOpen(): void {
			super.onOpen();
			this.setPlaceholder(options?.placeholder ?? t('Pick a file'));
		}
	})(app);

	modal.open();
}

/** Picks an image from the vault. */
export function pickVaultImage(
	app: App,
	onPick: (file: TFile) => void,
	options?: { placeholder?: string; filter?: (file: TFile) => boolean },
): void {
	const filtered = options?.filter
		? listVaultImages(app).filter(options.filter)
		: listVaultImages(app);

	const modal = new (class extends FuzzySuggestModal<TFile> {
		getItems(): TFile[] {
			return filtered;
		}

		getItemText(file: TFile): string {
			return file.path;
		}

		onChooseItem(file: TFile): void {
			onPick(file);
		}

		onOpen(): void {
			super.onOpen();
			this.setPlaceholder(options?.placeholder ?? t('Pick an image'));
		}
	})(app);

	modal.open();
}
