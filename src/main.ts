import './ddc-library/settings-styles.scss';
// Global so dark-mode native 笔墨 img invert applies before embed SCSS chunks load.
import './components/shared/ink-svg-preview-theme.scss';
import './styles/ink-workspace-chrome.scss';
import './styles/md-ink.scss';
import './styles/ink-writing-guide-lines.scss';
import './styles/ink-grayscale-screen-chrome.scss';
import { App, Editor, MarkdownView, Menu, Notice, Platform, Plugin, TFile, addIcon } from 'obsidian';
import { DEFAULT_SETTINGS, PluginSettings } from 'src/types/plugin-settings';
import { detectLocale, resolveLocale, setLocale, t } from 'src/i18n';
import { registerSettingsTab } from './components/dom-components/tabs/settings-tab/settings-tab';
import { registerWritingEmbed_v1 } from './components/formats/v1-code-blocks/drawing/widgets/writing-embed-widget'
import { insertExistingWritingFile } from './commands/insert-existing-writing-file';
import { insertNewWritingFile } from './commands/insert-new-writing-file';
import { registerWritingView_v1 } from './components/formats/v1-code-blocks/writing/writing-view/writing-view';
import { insertExistingDrawingFile } from './commands/insert-existing-drawing-file';
import { registerDrawingView_v1 } from './components/formats/v1-code-blocks/drawing/drawing-view/drawing-view';
import { registerDrawingEmbed_v1 } from './components/formats/v1-code-blocks/drawing/widgets/drawing-embed-widget';
import { insertNewDrawingFile } from './commands/insert-new-drawing-file';
import { showWelcomeTips_maybe } from './components/dom-components/welcome-notice';
import { blueskySvgStr, mastodonSvgStr, threadsSvgStr, twitterSvgStr } from './graphics/social-icons/social-icons';
import { showVersionNotice } from './components/dom-components/version-notices';
import { atom } from 'jotai';
import { registerDrawingEmbed } from './components/formats/current/drawing/drawing-embed-extension/drawing-embed-extension';
import { registerWritingEmbed } from './components/formats/current/writing/writing-embed-extension/writing-embed-extension';
import { registerReadingModeInkEmbeds } from './components/formats/current/reading-mode/register-reading-mode-ink-embeds';
import { registerPasteEmbedHandler } from './components/formats/current/utils/paste-embed-handler';
import { setGlobals } from './stores/global-store';
import { registerWritingView } from './components/formats/current/writing/writing-view/writing-view';
import { registerDrawingView } from './components/formats/current/drawing/drawing-view/drawing-view';
import { MigrationModal } from './components/dom-components/modals/migration-modal/migration-modal';
import { TldrawSvgMigrationModal } from './components/dom-components/modals/tldraw-svg-migration-modal/tldraw-svg-migration-modal';
import { FileConversionModal } from './components/dom-components/modals/file-conversion-modal/file-conversion-modal';
import { findNotesContainingFileEmbed, executeFileConversion, removeAllEmbedsOfFileFromNote } from './logic/utils/convert-file-embeds';
import { openRemoveEmbedFlow } from './logic/utils/remove-embed-flow';
import { RemoveEmbedModal } from './components/dom-components/modals/remove-embed-modal/remove-embed-modal';
import { registerUnifiedUndoRedo } from './logic/undo-redo/keyboard-handler';
import { registerUnifiedUndoRedoCommands } from './logic/undo-redo/unified-commands';
import { PromptModal } from './components/dom-components/modals/prompt-modal/prompt-modal';
import { MagicPanel } from './components/dom-components/modals/magic-panel/magic-panel';
import { insertFigureFromPrompt } from './logic/ai/figure-insert';
import {
	activePdfPath,
	countPdfPages,
	ensureFolder,
	insertPdfAnnotations,
} from './logic/pdf/pdf-page-to-image';
import { parsePageSelection } from './logic/pdf/pdf-page-selection';
import { annotationIndexPath, buildNewIndexDocument } from './logic/pdf/annotation-index';
import { buildAnnotationNoteBody, resolveAnnotationNotePath } from './logic/pdf/annotation-target';
import { parsePdfPlusSelection } from './logic/pdf/pdf-plus-link';
import { reloadPlugin } from './logic/utils/reload-plugin';
import { MdInkController } from './logic/md-ink/md-ink-controller';
import { implementMdInkCommands } from './logic/md-ink/md-ink-commands';
import { resolveInkRootFolder } from './logic/pdf/pdf-paths';
import { pickVaultFile } from './components/dom-components/modals/image-picker-modal/image-picker-modal';
import { drawDefaultSvgStr, drawExistingSvgStr, drawPasteSvgStr, linkAccountUserSvgStr, writeDefaultSvgStr, writeExistingSvgStr, writePasteSvgStr } from './graphics/icons/command-icons';
import { BooxConnection } from 'src/connections/boox/boox-connection';
import { migrateOutdatedSettings } from 'src/types/plugin-settings-migrations';
import { logToVault } from 'src/logic/utils/log-to-vault';
import { releaseInkWorkspaceChromeOnPluginUnload } from 'src/logic/utils/ink-workspace-chrome';
import {
	collectInkHostProbe,
	postCursorDebugIngest,
	serializeUnknownError,
} from 'src/logic/utils/cursor-debug-ingest';
import { setDominantHand } from 'src/stores/dominant-hand-store';
import {
	getBooxConnectionEnabled,
	migrateBooxConnectionFromVaultToDevice,
	resetBooxConnectionToDefault,
	resetExperimentalDeviceSettingsToDefault,
	resetFingerDrawingToDefault,
	setBooxConnectionEnabled,
	subscribeDeviceSettingsChanged,
} from 'src/logic/device-settings/device-settings';
import {
	applyHighContrastUserInterfaceBodyClass,
	releaseHighContrastUserInterfaceBodyClassOnPluginUnload,
} from 'src/logic/device-settings/high-contrast-user-interface-body-class';
import {
	initHandwritingTranscriptionQueue,
	shutdownHandwritingTranscriptionQueue,
} from 'src/logic/handwriting-transcription-queue';

////////
////////

/** Posts start/ok/fail breadcrumbs around one onload step so a Windows crash has a last-known step. */
async function runInkOnloadStep(stepName: string, runStep: () => void | Promise<void>): Promise<void> {
	postCursorDebugIngest({
		hypothesisId: 'H-win-onload-step',
		location: `main.ts:onload:${stepName}:start`,
		message: `onload step start: ${stepName}`,
	});
	try {
		await runStep();
	} catch (error) {
		postCursorDebugIngest({
			hypothesisId: 'H-win-onload-step-fail',
			location: `main.ts:onload:${stepName}:fail`,
			message: `onload step failed: ${stepName}`,
			data: serializeUnknownError(error),
		});
		throw error;
	}
	postCursorDebugIngest({
		hypothesisId: 'H-win-onload-step',
		location: `main.ts:onload:${stepName}:ok`,
		message: `onload step ok: ${stepName}`,
	});
}

export default class InkPlugin extends Plugin {
	settings: PluginSettings;

	/** 笔墨 painted directly on Markdown notes, keyed by vault path. Assigned in `onload`. */
	mdInk!: MdInkController;

	/** 笔墨 painted on the pages of open PDFs. Assigned in `onload`. */
	pdfInk!: import('./logic/md-ink/pdf-ink-manager').PdfInkManager;

	/** Boox companion app WebSocket: open only while a drawing editor is active (unlocked). */
	booxConnection: BooxConnection;

	private unsubscribeHighContrastUserInterfaceBodyClass?: () => void;

	/** Sidebar collapsed state captured before opening a dedicated ink view, restored on close. */
	inkViewSidebarState: { leftWasCollapsed: boolean; rightWasCollapsed: boolean } | null = null;

	// Exposed for e2e testing
	readonly FileConversionModal = FileConversionModal;
	readonly findNotesContainingFileEmbed = findNotesContainingFileEmbed;
	readonly executeFileConversion = executeFileConversion;
	readonly RemoveEmbedModal = RemoveEmbedModal;
	readonly removeAllEmbedsOfFileFromNote = removeAllEmbedsOfFileFromNote;
	readonly openRemoveEmbedFlow = openRemoveEmbedFlow;

	openMigrationModal(onPermanentMigrationFinished?: () => void) {
		new MigrationModal(this, onPermanentMigrationFinished).open();
	}

	openTldrawSvgMigrationModal() {
		new TldrawSvgMigrationModal(this).open();
	}

	async onload() {
		setLocale(detectLocale());
		postCursorDebugIngest({
			hypothesisId: 'H-win-onload-enter',
			location: 'main.ts:onload:enter',
			message: 'onload entered',
			data: collectInkHostProbe(),
		});
		try {
			await runInkOnloadStep('loadSettings', async () => {
				await this.loadSettings();
			});
			// Re-apply now that the stored preference is known; the earlier
			// setLocale(detectLocale()) only covers the pre-load window.
			setLocale(resolveLocale(this.settings.uiLanguage));

			await runInkOnloadStep('highContrastUserInterfaceBodyClass', () => {
				applyHighContrastUserInterfaceBodyClass();
				this.unsubscribeHighContrastUserInterfaceBodyClass = subscribeDeviceSettingsChanged(() => {
					applyHighContrastUserInterfaceBodyClass();
				});
			});

			await runInkOnloadStep('booxConnection', () => {
				this.booxConnection = new BooxConnection(() => ({
					booxConnectionEnabled: getBooxConnectionEnabled(),
				}));
			});

			await runInkOnloadStep('setGlobals', () => {
				setGlobals({
					plugin: this,
				});
			});

			await runInkOnloadStep('mdInk', async () => {
				// Before mounting anything: clear DOM a previous instance left in
				// CodeMirror's scroller and the PDF page boxes. Obsidian owns those
				// subtrees, so nothing else removes them, and `disablePlugin()` was
				// measured not to invoke `onunload` at all.
				const { sweepStaleInkDom } = await import('./logic/md-ink/sweep-stale');
				const swept = sweepStaleInkDom(this.app);
				if (swept > 0) console.debug(`[bimo] removed ${swept} stale ink node(s)`);
				this.mdInk = new MdInkController(this.app);
				implementMdInkCommands(this);
				const { createMdInkExtension, watchActiveNotes } = await import('./logic/md-ink/md-ink-extension');
				this.registerEditorExtension([createMdInkExtension(this)]);
				watchActiveNotes(this);
				const { PdfInkManager } = await import('./logic/md-ink/pdf-ink-manager');
				this.pdfInk = new PdfInkManager(this);
				this.pdfInk.start();
				// PDF overlays sit outside the editor extension; the controller feeds
				// them tool switches and setting changes through this sink.
				this.mdInk.pdfSink = this.pdfInk;

				// 笔墨 files are keyed by a hash of the source path, so a rename would
				// strand every stroke under a key nothing ever looks up again. This
				// hook moves the JSON and tells the controller, which is how the
				// editor can tell "renamed" from "a different note in this tab".
				const { MdInkStorage } = await import('./logic/md-ink/md-ink-store');
				const mdInkStorage = new MdInkStorage(this.app);
				this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
					if (!(file instanceof TFile)) return;
					if (file.extension === 'md') {
						this.mdInk.noteRename(oldPath, file.path, mdInkStorage.move(oldPath, file.path));
					} else if (file.extension === 'pdf') {
						void this.pdfInk?.moveInk?.(oldPath, file.path);
					}
				}));

				// Runtime state, not a guess: whatever the layers actually look
				// like after layout settles is written to the vault, so a mount
				// failure can be diagnosed without reading a Notice aloud.
				const { writeRuntimeDiagnostics } = await import('./logic/md-ink/diagnostics');
				// Rewritten on every layout change (debounced) rather than once:
				// a report captured before the note or PDF was opened would show
				// an empty workspace and prove nothing about the failing view.
				let diagTimer: number | null = null;
				const scheduleDiagnostics = () => {
					if (diagTimer !== null) window.clearTimeout(diagTimer);
					diagTimer = window.setTimeout(() => {
						diagTimer = null;
						void writeRuntimeDiagnostics(this);
					}, 3000);
				};
				this.app.workspace.onLayoutReady(scheduleDiagnostics);
				this.registerEvent(this.app.workspace.on('layout-change', scheduleDiagnostics));
				this.registerEvent(this.app.workspace.on('active-leaf-change', scheduleDiagnostics));
				this.addCommand({
					id: 'md-ink-write-diagnostics',
					name: t('Write runtime diagnostics to .bimo/diagnostics.txt'),
					icon: 'bug',
					callback: () => {
						void writeRuntimeDiagnostics(this).then(() => {
							new Notice(t('Diagnostics written to .bimo/diagnostics.txt'));
						});
					},
				});
			});

			await runInkOnloadStep('handwritingTranscriptionQueue', () => {
				initHandwritingTranscriptionQueue(this);
			});

			logToVault(`Plugin loaded. writing=${this.settings.writingEnabled}, drawing=${this.settings.drawingEnabled}, boox=${getBooxConnectionEnabled()}`);

			await runInkOnloadStep('addIcons', () => {
				addIcon('write_default', writeDefaultSvgStr);
				addIcon('write_existing', writeExistingSvgStr);
				addIcon('write_paste', writePasteSvgStr);

				addIcon('draw_default', drawDefaultSvgStr);
				addIcon('draw_existing', drawExistingSvgStr);
				addIcon('draw_paste', drawPasteSvgStr);

				addIcon('bluesky', blueskySvgStr);
				addIcon('mastodon', mastodonSvgStr);
				addIcon('threads', threadsSvgStr);
				addIcon('twitter', twitterSvgStr);
				addIcon('ddc_ink_link_account_user', linkAccountUserSvgStr);
			});

			//: NOTE: For testing only
			// this.app.emulateMobile(true);	// Use this as true or false in console to switch
			// implementHandwrittenNoteAction(this)
			// implementHandDrawnNoteAction(this)
			type InkWindowWithOptionalProcessEnv = Window & {
				process?: { env?: Record<string, string | undefined> };
			};
			const inkProcessEnv = (window as InkWindowWithOptionalProcessEnv).process?.env;
			const emulateMobileRequested = inkProcessEnv?.INK_EMULATE_MOBILE === 'true';
			const mobileEmulationReloadGuardKey = '__inkMobileEmulationReloadInProgress';
			type AppWithOptionalMobileEmulation = App & {
				emulateMobile?: (enabled: boolean) => void;
				isMobile?: boolean;
			};
			const appWithMobileEmulation = this.app as AppWithOptionalMobileEmulation;
			const canEmulateMobile = typeof appWithMobileEmulation.emulateMobile === 'function';
			const alreadyInMobileMode = !!(Platform.isMobile || Platform.isMobileApp || appWithMobileEmulation.isMobile);
			const mobileEmulationReloadInProgress = window.localStorage.getItem(mobileEmulationReloadGuardKey) === 'true';

			if (emulateMobileRequested && canEmulateMobile && !alreadyInMobileMode && !mobileEmulationReloadInProgress) {
				// emulateMobile(true) can reload the app; guard to avoid repeatedly requesting emulation on each reload.
				window.localStorage.setItem(mobileEmulationReloadGuardKey, 'true');
				postCursorDebugIngest({
					hypothesisId: 'H-win-emulate-mobile',
					location: 'main.ts:onload:emulateMobile',
					message: 'requesting emulateMobile(true) and returning',
				});
				const runEmulateMobile = appWithMobileEmulation.emulateMobile;
				if (typeof runEmulateMobile === 'function') {
					runEmulateMobile(true);
				}
				return;
			}

			// Once emulation is active (or not requested), clear the guard for future sessions.
			if (!emulateMobileRequested || alreadyInMobileMode) {
				window.localStorage.removeItem(mobileEmulationReloadGuardKey);
			}

			postCursorDebugIngest({
				hypothesisId: 'H-win-onload-settings',
				location: 'main.ts:onload:settings',
				message: 'settings loaded',
				data: {
					writingEnabled: this.settings.writingEnabled,
					drawingEnabled: this.settings.drawingEnabled,
					booxConnectionEnabled: getBooxConnectionEnabled(),
					debugLoggingEnabled: this.settings.debugLoggingEnabled,
				},
			});

			if (this.settings.writingEnabled) {
				await runInkOnloadStep('registerWriting', () => {
					registerWritingView(this);
					registerWritingEmbed(this);
					registerUnifiedUndoRedo(this);
					registerUnifiedUndoRedoCommands(this);
					implementWritingEmbedCommands(this);
					registerWritingView_v1(this);
					registerWritingEmbed_v1(this);
				});
			}

			if (this.settings.drawingEnabled) {
				await runInkOnloadStep('registerDrawing', () => {
					registerDrawingView(this);
					registerDrawingEmbed(this);
					if (!this.settings.writingEnabled) registerUnifiedUndoRedo(this);
					if (!this.settings.writingEnabled) registerUnifiedUndoRedoCommands(this);
					implementDrawingEmbedCommands(this);
					registerDrawingView_v1(this);
					registerDrawingEmbed_v1(this);
				});
			}

			await runInkOnloadStep('registerAiCommands', () => {
				implementAiCommands(this);
			});

			await runInkOnloadStep('registerPdfCommands', () => {
				implementPdfCommands(this);
			});

			if (this.settings.writingEnabled || this.settings.drawingEnabled) {
				await runInkOnloadStep('registerEditorMenus', () => {
					registerInkEditorMenus(this);
				});
				await runInkOnloadStep('registerEmbeds', async () => {
					const { inkEmbedsExtension } = await import('./components/formats/current/ink-embeds-extension/ink-embeds-extension');
					this.registerEditorExtension([inkEmbedsExtension()]);
					registerPasteEmbedHandler(this);
					registerReadingModeInkEmbeds(this);
				});
			}

			await runInkOnloadStep('registerSettingsTab', () => {
				registerSettingsTab(this);
			});

			await runInkOnloadStep('showOnboardingTips', () => {
				showOnboardingTips_maybe(this);
			});

			postCursorDebugIngest({
				hypothesisId: 'H-win-onload-complete',
				location: 'main.ts:onload:complete',
				message: 'onload completed',
			});
		} catch (error) {
			postCursorDebugIngest({
				hypothesisId: 'H-win-onload-throw',
				location: 'main.ts:onload:catch',
				message: 'onload threw',
				data: serializeUnknownError(error),
			});
			throw error;
		}
	}

	onunload() {
		postCursorDebugIngest({
			hypothesisId: 'H-win-onunload',
			location: 'main.ts:onunload',
			message: 'plugin unloading',
		});
		logToVault('Plugin unloaded');
		releaseInkWorkspaceChromeOnPluginUnload();
		releaseHighContrastUserInterfaceBodyClassOnPluginUnload();
		this.unsubscribeHighContrastUserInterfaceBodyClass?.();
		this.unsubscribeHighContrastUserInterfaceBodyClass = undefined;
		shutdownHandwritingTranscriptionQueue();
		this.booxConnection?.dispose();
		// The ink layers live in foreign DOM (`.cm-scroller`, PDF page boxes), so
		// Obsidian does not clean them up for us. Without this a reload leaves
		// the old SVG behind and the next scan mounts a second one on top.
		try {
			this.pdfInk?.destroy();
		} catch (error) {
			console.debug('[bimo] pdfInk destroy failed', error);
		}
		try {
			this.mdInk?.destroyAll();
		} catch (error) {
			console.debug('[bimo] mdInk destroy failed', error);
		}
	}

	async loadSettings() {
		const loaded = await this.loadData() as Record<string, unknown> | null;
		migrateBooxConnectionFromVaultToDevice(loaded);
		const isNewInstall = !loaded || Object.keys(loaded).length === 0;
		if (isNewInstall) {
			this.settings = Object.assign({}, DEFAULT_SETTINGS);
		} else {
			this.settings = migrateOutdatedSettings(loaded);
			this.stripLegacyBooxFromPluginSettings();
			await this.saveSettings();
		}
		setDominantHand(this.settings.dominantHand);
	}

	/** Removes vault-synced Boox keys after they have been migrated to device storage. */
	private stripLegacyBooxFromPluginSettings(): boolean {
		const settingsRecord = this.settings as unknown as Record<string, unknown>;
		let changed = false;
		if ('booxConnectionEnabled' in settingsRecord) {
			delete settingsRecord.booxConnectionEnabled;
			changed = true;
		}
		if ('einkBridgeEnabled' in settingsRecord) {
			delete settingsRecord.einkBridgeEnabled;
			changed = true;
		}
		return changed;
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async resetSettings() {
		this.settings = structuredClone(DEFAULT_SETTINGS);
		setDominantHand(this.settings.dominantHand);
		resetBooxConnectionToDefault();
		resetFingerDrawingToDefault();
		resetExperimentalDeviceSettingsToDefault();
		this.booxConnection.onSettingsChanged();
		await this.saveSettings();
		new Notice(t('笔墨 plugin settings reset'));
	}

	/** @internal Used by e2e tests to toggle device-local Boox connection. */
	setBooxConnectionEnabledForTests(enabled: boolean): void {
		setBooxConnectionEnabled(enabled);
		this.booxConnection.onSettingsChanged();
	}
}

export const inkPluginAtom = atom<InkPlugin>();

function implementWritingEmbedCommands(plugin: InkPlugin) {

	// Current
	plugin.addCommand({
		id: 'create-handwritten-section',
		name: t('New handwriting section'),
		icon: 'write_default',
		// Default hotkey — Obsidian shows it on the command and lets the user rebind
		// or clear it in Settings → Hotkeys.
		hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'h' }],
		editorCallback: (editor: Editor) => insertNewWritingFile(plugin, editor)
	});
	plugin.addCommand({
		id: 'embed-writing-file',
		name: t('Existing handwriting section'),
		icon: 'write_existing',
		hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'o' }],
		editorCallback: (editor: Editor) => insertExistingWritingFile(plugin, editor)
	});
}

function implementDrawingEmbedCommands(plugin: InkPlugin) {

	// Current
	plugin.addCommand({
		id: 'create-drawing-section',
		name: t('New drawing'),
		icon: 'draw_default',
		hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'd' }],
		editorCallback: (editor: Editor) => insertNewDrawingFile(plugin, editor)
	});
	plugin.addCommand({
		id: 'embed-drawing-file',
		name: t('Existing drawing'),
		icon: 'folder-dot',
		hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'i' }],
		editorCallback: (editor: Editor) => insertExistingDrawingFile(plugin, editor)
	});

}

/**
 * AI commands. Registered whenever a custom endpoint is configured — the command
 * stays in the palette either way and explains what to enable when it is run,
 * which is more discoverable than a command that silently does not exist.
 */
function implementAiCommands(plugin: InkPlugin) {
	plugin.addCommand({
		id: 'open-magic-panel',
		name: t('Magic margin'),
		icon: 'sparkles',
		hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'm' }],
		callback: () => {
			const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
			new MagicPanel({
				plugin,
				editor: view?.editor,
				sourcePath: view?.file?.path,
			}).open();
		},
	});

	/**
	 * Development only: cycles this plugin so a rebuilt `main.js` is picked up
	 * without restarting Obsidian. Disabling first matters — enabling an already
	 * loaded plugin does nothing, and the old code would keep running.
	 */
	plugin.addCommand({
		id: 'reload-plugin',
		name: t('Reload plugin (development)'),
		icon: 'refresh-cw',
		// Bound by default so the rebuild loop is one keystroke; reassignable in
		// Settings → Hotkeys like any other command.
		hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'r' }],
		callback: () => {
			void reloadPlugin(plugin);
		},
	});

	plugin.addCommand({
		id: 'insert-ai-figure',
		name: t('Plot a function with AI'),
		icon: 'line-chart',
		hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'f' }],
		editorCallback: (editor: Editor) => {
			new PromptModal(plugin.app, {
				title: t('Plot a function'),
				hint: t('Describe the function in words, or write it directly. The model only decides the expression; the curve is drawn locally, so it is exact.'),
				placeholder: 'y = sin(x)/x, -10 to 10',
				onSubmit: (value) => {
					void insertFigureFromPrompt(plugin, editor, value).then((outcome) => {
						if (!outcome.ok) new Notice(outcome.reason);
					}).catch((error: unknown) => {
						console.debug('笔墨: figure insertion failed', error);
						new Notice(t('Could not draw the function'));
					});
				},
			}).open();
		},
	});
}

/**
 * PDF annotation entry point. Registered unconditionally: the command explains
 * what to do when no PDF page is on screen, which is friendlier than a command
 * that only appears in some contexts.
 */
function implementPdfCommands(plugin: InkPlugin) {
	plugin.addCommand({
		id: 'annotate-pdf-page',
		name: t('Annotate PDF pages'),
		icon: 'file-plus',
		hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'p' }],
		// Plain `callback`, not `editorCallback`: when a PDF is the active view there
		// is no Markdown editor focused, and Obsidian hides editorCallbacks entirely
		// in that state — which is exactly when this command is most wanted.
		callback: async () => {
			// Resolve the PDF first: when no note is open, the target note is created
			// *beside that PDF*, so the attachment folder and the note agree.
			const active = activePdfPath(plugin.app);
			const target = await ensureMarkdownTarget(plugin, active?.path ?? null);
			if (!target) {
				new Notice(t('Open a note first.'));
				return;
			}
			// The open PDF wins; otherwise ask which file, so the command works from
			// any note instead of requiring the user to split the screen first.
			if (active) {
				openPdfPagePrompt(plugin, target, active.path, active.page);
				return;
			}
			pickVaultFile(plugin.app, ['pdf'], (file) => {
				openPdfPagePrompt(plugin, target, file.path, null);
			}, { placeholder: t('Pick a PDF') });
		},
	});

	/**
	 * The return path: PDF → the annotation index for that PDF.
	 *
	 * Annotations are stored as notes, so without this the only way back from a
	 * lecture PDF to its handwritten pages was to remember where the index lived.
	 * The index is created on first use rather than only existing after the first
	 * annotation, so the entry point is predictable.
	 */
	plugin.addCommand({
		id: 'open-pdf-annotation-index',
		name: t('Open annotation index for this PDF'),
		icon: 'list',
		callback: async () => {
			const active = activePdfPath(plugin.app);
			if (!active) {
				new Notice(t('Open a PDF first.'));
				return;
			}
			const pdfFile = plugin.app.vault.getAbstractFileByPath(active.path);
			if (!(pdfFile instanceof TFile)) {
				new Notice(t('Could not open this PDF.'));
				return;
			}

			const noteTarget = findMarkdownTarget(plugin);
			const inkRoot = await resolveInkRootFolder(plugin, noteTarget?.file ?? pdfFile);
			const path = annotationIndexPath(inkRoot, pdfFile);

			let indexFile = plugin.app.vault.getAbstractFileByPath(path);
			if (!(indexFile instanceof TFile)) {
				if (!(await ensureFolder(plugin, path.split('/').slice(0, -1).join('/')))) {
					new Notice(t('Could not create the Ink/PDF folder.'));
					return;
				}
				const title = `${pdfFile.basename} · ${t('Annotation index')}`;
				indexFile = await plugin.app.vault.create(path, buildNewIndexDocument(pdfFile, title, []));
			}

			if (!(indexFile instanceof TFile)) return;
			await plugin.app.workspace.getLeaf('tab').openFile(indexFile);
		},
	});

	/**
	 * PDF++ → bimo hand-off.
	 *
	 * PDF++ already solves the hard part: it turns a rectangular selection into
	 * `#page=N&rect=x1,y1,x2,y2`, with coordinates in PDF user space. Rather than
	 * reimplementing area selection, this command reads that link from the
	 * clipboard and renders the same region as the background of a handwriting
	 * block — so the selection becomes something you can write on, and the block
	 * still knows which PDF page it came from.
	 *
	 * Clipboard-driven on purpose: PDF++ owns the selection UI, and asking for one
	 * copy is a smaller promise than hooking into its internals.
	 */
	plugin.addCommand({
		id: 'insert-annotation-from-pdf-selection',
		name: t('Create annotation block from PDF selection'),
		icon: 'scissors',
		callback: async () => {
			let clipboard = '';
			try {
				clipboard = await navigator.clipboard.readText();
			} catch {
				new Notice(t('Could not read the clipboard.'));
				return;
			}

			const selection = parsePdfPlusSelection(clipboard);
			if (!selection) {
				new Notice(t('Copy a PDF++ selection first.'));
				return;
			}

			const pdfFile = plugin.app.vault.getAbstractFileByPath(selection.pdfPath);
			if (!(pdfFile instanceof TFile)) {
				new Notice(t('Could not open this PDF.'));
				return;
			}

			const target = await ensureMarkdownTarget(plugin, selection.pdfPath);
			if (!target) {
				new Notice(t('Open a note first.'));
				return;
			}

			const outcome = await insertPdfAnnotations(
				plugin,
				target.editor,
				{ pdfFile, pageNumbers: [selection.page], rect: selection.rect },
				target.file,
			);
			if (!outcome.ok) new Notice(outcome.reason);
		},
	});

}

interface MarkdownTarget {
	editor: Editor;
	file: TFile;
}

/**
 * Finds the note to insert into — and its file, which is not the same thing as
 * the active file.
 *
 * The editor alone is not enough. `insertPdfAnnotations` derives the attachment
 * folder from the file it is handed, and while a PDF view is active
 * `getActiveFile()` returns that PDF. Annotations then landed beside the lecture
 * PDF instead of in `Ink/`. Carrying the file alongside the editor is what keeps
 * the two in sync.
 *
 * Falls back across leaves because the user is often looking at a PDF when they
 * run a PDF command, and the note they want the annotations in is merely open.
 */
function findMarkdownTarget(plugin: InkPlugin): MarkdownTarget | null {
	const focused = plugin.app.workspace.getActiveViewOfType(MarkdownView);
	if (focused?.editor && focused.file) {
		return { editor: focused.editor, file: focused.file };
	}

	for (const leaf of plugin.app.workspace.getLeavesOfType('markdown')) {
		const view = leaf.view;
		if (view instanceof MarkdownView && view.editor && view.file) {
			return { editor: view.editor, file: view.file };
		}
	}
	return null;
}

/**
 * Resolves the note that receives the annotation blocks, creating one when
 * nothing suitable is open.
 *
 * Order matters. An open note wins only when it is the *active* view: falling
 * back to "any open Markdown leaf" first meant that with several notes open the
 * annotations could land in whichever tab was created earliest. When a PDF is in
 * front, a companion note beside that PDF is a far better guess than an
 * unrelated tab — and annotating a lecture no longer requires opening a second
 * note by hand first, which is the step that made the command feel broken.
 */
async function ensureMarkdownTarget(
	plugin: InkPlugin,
	pdfPath: string | null,
): Promise<MarkdownTarget | null> {
	const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
	if (activeView?.editor && activeView.file) {
		return { editor: activeView.editor, file: activeView.file };
	}

	const pdfFile = pdfPath ? plugin.app.vault.getAbstractFileByPath(pdfPath) : null;
	if (pdfFile instanceof TFile) {
		const companion = await openCompanionAnnotationNote(plugin, pdfFile);
		if (companion) return companion;
	}

	return findMarkdownTarget(plugin);
}

/**
 * Opens — or creates — `{PDF name} - Annotations.md` beside the PDF.
 *
 * Opened inactive on purpose: the user is looking at the PDF and expects to stay
 * there. Opening the note in the foreground would move them away from the page
 * they just asked to annotate.
 */
async function openCompanionAnnotationNote(
	plugin: InkPlugin,
	pdfFile: TFile,
): Promise<MarkdownTarget | null> {
	const settings = plugin.settings;
	const date = new Date().toISOString().slice(0, 10);

	// Fixed mode wins when configured. A typo or a not-yet-created file must not
	// silently fall back to a second note, or the user ends up with one note per
	// lecture plus a stray one beside it.
	let notePath = '';
	if (settings.pdfAnnotationNoteMode === 'fixed') {
		const fixed = (settings.pdfAnnotationFixedNotePath ?? '').trim();
		if (fixed) notePath = fixed.toLowerCase().endsWith('.md') ? fixed : `${fixed}.md`;
	}
	if (!notePath) {
		notePath = resolveAnnotationNotePath(pdfFile, settings.pdfAnnotationNoteTemplate, date);
	}

	let noteFile: TFile;
	const existingNote = plugin.app.vault.getAbstractFileByPath(notePath);
	if (existingNote instanceof TFile) {
		noteFile = existingNote;
	} else {
		// A configured note that lives in a folder which does not exist yet must
		// still be created — otherwise "always use one note" fails on first use
		// with no explanation.
		const parentFolder = notePath.split('/').slice(0, -1).join('/');
		if (parentFolder && !(await ensureFolder(plugin, parentFolder))) return null;
		try {
			noteFile = await plugin.app.vault.create(notePath, buildAnnotationNoteBody(pdfFile, date));
		} catch (error) {
			console.debug('笔墨: could not create the annotation note', error);
			return null;
		}
	}

	// Reuse the tab if the note is already open; otherwise open one in the
	// background so the PDF keeps focus.
	for (const leaf of plugin.app.workspace.getLeavesOfType('markdown')) {
		const view = leaf.view;
		if (view instanceof MarkdownView && view.file?.path === noteFile.path && view.editor) {
			return { editor: view.editor, file: noteFile };
		}
	}

	const leaf = plugin.app.workspace.getLeaf('tab');
	// `foreground` is the default because the whole point of creating the note is
	// to write in it; leaving it behind the PDF hides the thing we just made.
	await leaf.openFile(noteFile, { active: settings.pdfAnnotationOpenMode === 'foreground' });

	// `editor` is populated asynchronously by the view; poll briefly instead of
	// failing the whole command on the first tick.
	for (let attempt = 0; attempt < 10; attempt += 1) {
		const view = leaf.view;
		if (view instanceof MarkdownView && view.editor) {
			return { editor: view.editor, file: noteFile };
		}
		await new Promise((resolve) => window.setTimeout(resolve, 30));
	}
	return null;
}

/**
 * Asks for a page selection, then builds one annotation block per page.
 *
 * The page count is read before prompting so out-of-range input can be rejected
 * with a real number instead of silently producing nothing.
 */
function openPdfPagePrompt(
	plugin: InkPlugin,
	target: MarkdownTarget,
	pdfPath: string,
	defaultPage: number | null,
) {
	const file = plugin.app.vault.getAbstractFileByPath(pdfPath);
	if (!(file instanceof TFile)) {
		new Notice(t('Could not open this PDF.'));
		return;
	}

	void countPdfPages(file).then((total) => {
		if (!total) {
			new Notice(t('Could not open this PDF.'));
			return;
		}
		new PromptModal(plugin.app, {
			title: t('Annotate PDF pages'),
			hint: `${t('This PDF has {n} pages.').replace('{n}', String(total))}${t('Enter pages, e.g. 1-3,5')}`,
			initialValue: String(defaultPage ?? 1),
			submitLabel: t('Create annotation pages'),
			onSubmit: (value) => {
				const pages = parsePageSelection(value, total);
				if (pages.length === 0) {
					new Notice(t('No valid page numbers.'));
					return;
				}
				void insertPdfAnnotations(plugin, target.editor, { pdfFile: file, pageNumbers: pages }, target.file)
					.then((outcome) => {
						if (!outcome.ok) new Notice(outcome.reason);
					})
					.catch((error: unknown) => {
						console.debug('笔墨: PDF annotation failed', error);
						new Notice(t('Could not prepare this PDF page'));
					});
			},
		}).open();
	});
}

/**
 * Right-click menu inside any Markdown editor.
 *
 * The four insert commands are `editorCallback` commands, so Obsidian only lists
 * them in the command palette while a note has focus. That leaves no discoverable
 * entry point when the cursor is in a note but the user does not know the name to
 * search for — this menu is that entry point. Items are grouped under a separator
 * so they never mix with the core Cut/Copy/Paste block.
 */
function registerInkEditorMenus(plugin: InkPlugin) {
	plugin.registerEvent(plugin.app.workspace.on('editor-menu', (menu: Menu, editor: Editor) => {
		if (!plugin.settings.writingEnabled && !plugin.settings.drawingEnabled) return;

		menu.addSeparator();
		if (plugin.settings.writingEnabled) {
			menu.addItem((item) => {
				item.setTitle(t('New handwriting section'))
					.setIcon('write_default')
					.setSection('ink-insert')
					.onClick(() => { insertNewWritingFile(plugin, editor); });
			});
			menu.addItem((item) => {
				item.setTitle(t('Existing handwriting section'))
					.setIcon('write_existing')
					.setSection('ink-insert')
					.onClick(() => { insertExistingWritingFile(plugin, editor); });
			});
		}
		if (plugin.settings.drawingEnabled) {
			menu.addItem((item) => {
				item.setTitle(t('New drawing'))
					.setIcon('draw_default')
					.setSection('ink-insert')
					.onClick(() => { insertNewDrawingFile(plugin, editor); });
			});
			menu.addItem((item) => {
				item.setTitle(t('Existing drawing'))
					.setIcon('folder-dot')
					.setSection('ink-insert')
					.onClick(() => { insertExistingDrawingFile(plugin, editor); });
			});
		}

		// AI entry points belong here too: the command palette is where features go
		// to be forgotten, and the right-click menu is where writing actually happens.
		menu.addSeparator();
		menu.addItem((item) => {
			item.setTitle(t('Magic margin'))
				.setIcon('sparkles')
				.setSection('ink-ai')
				.onClick(() => { new MagicPanel({ plugin, editor }).open(); });
		});
		menu.addItem((item) => {
			item.setTitle(t('Plot a function with AI'))
				.setIcon('line-chart')
				.setSection('ink-ai')
				.onClick(() => {
					new PromptModal(plugin.app, {
						title: t('Plot a function'),
						hint: t('Describe the function in words, or write it directly. The model only decides the expression; the curve is drawn locally, so it is exact.'),
						placeholder: 'y = sin(x)/x, -10 to 10',
						onSubmit: (value) => {
							void insertFigureFromPrompt(plugin, editor, value).then((outcome) => {
								if (!outcome.ok) new Notice(outcome.reason);
							}).catch((error: unknown) => {
								console.debug('笔墨: figure insertion failed', error);
								new Notice(t('Could not draw the function'));
							});
						},
					}).open();
				});
		});
	}));
}

// function implementHandwrittenNoteAction(plugin: InkPlugin) {
// 	plugin.addCommand({
// 		id: 'create-writing-file',
// 		name: 'Create new handwritten note',
// 		callback: async () => {
// 			const fileRef = await createNewWritingFile(plugin);
// 			openInkFile(plugin, fileRef);
// 		}
// 	});
// 	plugin.addRibbonIcon("pencil", "New handwritten note", async () => {
// 		const fileRef = await createNewWritingFile(plugin);
// 		openInkFile(plugin, fileRef);
// 	});
// }

// function implementHandDrawnNoteAction(plugin: InkPlugin) {
// 	plugin.addCommand({
// 		id: 'create-drawing-file',
// 		name: 'Create new drawing',
// 		callback: async () => {
// 			const fileRef = await createNewDrawingFile(plugin);
// 			openInkFile(plugin, fileRef);
// 		}
// 	});
// 	plugin.addRibbonIcon("pencil", "New hand drawn note", async () => {
// 		const fileRef = await createNewDrawingFile(plugin);
// 		openInkFile(plugin, fileRef);
// 	});
// }

function showOnboardingTips_maybe(plugin: InkPlugin) {
	const newInstall = showWelcomeTips_maybe(plugin);

	if (!newInstall) {
		showVersionNotice(plugin);
	}
}
