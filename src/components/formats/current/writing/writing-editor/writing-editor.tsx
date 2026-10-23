import './writing-editor.scss';
import { t } from 'src/i18n';
import * as React from 'react';
import { useRef } from 'react';
import { MarkdownView, Notice, Platform, TFile } from 'obsidian';
import { syncTranscriptBlockInVault } from 'src/logic/transcript-block';
import { MagicPanel } from 'src/components/dom-components/modals/magic-panel/magic-panel';
import { MagicInkCard } from 'src/components/dom-components/magic-ink/magic-ink-card';
import { MagicInkWatcher, replyPlacementForLastStroke } from 'src/logic/ai/magic-ink';
import { isAiEndpointUsable, requestAiCompletion } from 'src/logic/ai/client';
import { buildMagicInkUserPrompt, MAGIC_INK_SYSTEM_PROMPT } from 'src/logic/ai/magic-prompt';
import { prepareProviderMedia } from 'src/logic/transcription-providers';
import { pickVaultImage } from 'src/components/dom-components/modals/image-picker-modal/image-picker-modal';
import { cycleBackgroundOpacity, setInkFileBackgroundWithNotice } from 'src/logic/background/set-background';
import { exportInkFileToExcalidraw } from 'src/logic/export/export-actions';
import { useAtomValue } from 'jotai';
import classNames from 'classnames';
import InkPlugin from 'src/main';
import { InkFileData, InkFileMetadata } from 'src/components/formats/current/types/file-data';
import { buildInkCanvasWritingFileData } from 'src/components/formats/current/utils/build-file-data';
import { buildFileStr } from 'src/components/formats/current/utils/buildFileStr';
import { isInkCanvasFile } from 'src/components/formats/current/utils/ink-file-storage-engine';
import {
	WRITE_SHORT_DELAY_MS,
	WRITE_LONG_DELAY_MS,
	MENUBAR_HEIGHT_PX,
	WRITING_LINE_HEIGHT,
	WRITING_MIN_PAGE_HEIGHT,
	WRITING_PAGE_WIDTH,
} from 'src/constants';
import { PrimaryMenuBar } from 'src/components/jsx-components/primary-menu-bar/primary-menu-bar';
import { InkCanvasDrawingMenu } from 'src/components/jsx-components/drawing-menu/ink-canvas-drawing-menu';
import ExtendedWritingMenu from 'src/components/jsx-components/extended-writing-menu/extended-writing-menu';
import { type MenuOption } from 'src/components/jsx-components/overflow-menu/overflow-menu';
import { SecondaryMenuBar } from 'src/components/jsx-components/secondary-menu-bar/secondary-menu-bar';
import { InkCanvasModifyMenu } from 'src/components/jsx-components/ink-canvas-modify-menu/ink-canvas-modify-menu';
import { ExpandLinesButton } from 'src/components/jsx-components/expand-lines-button/expand-lines-button';
import { verbose } from 'src/logic/utils/universal-dev-logging';
import { logToVault } from 'src/logic/utils/log-to-vault';
import { getBooxConnectionEnabled } from 'src/logic/device-settings/device-settings';
import { buildBooxCornerMarkers } from 'src/connections/boox/boox-corner-markers';
import { useBooxConnectionEnabled } from 'src/logic/device-settings/use-boox-connection-enabled';
import { useFingerDrawingEnabled } from 'src/logic/device-settings/use-finger-drawing-enabled';
import { restoreEmbedCmScrollerScroll } from 'src/logic/utils/restore-embed-cm-scroller-scroll';
import { extractInkJsonFromSvg } from 'src/logic/utils/extractInkJsonFromSvg';
import { embedsInEditModeAtom, type WritingEditorControls } from '../writing-embed/writing-embed';
import { registerDedicatedInkEditor, unregisterDedicatedInkEditor } from 'src/logic/undo-redo/dedicated-ink-editor-registry';
import { register as registerInkEditor, unregister as unregisterInkEditor } from 'src/logic/undo-redo/ink-editor-registry';
import {
	initializeEmbeddedUnifiedUndo,
	recordEmbedCanvasActionOnUnifiedStack,
} from 'src/logic/undo-redo/embedded-unified-undo';
import { InkSvgCanvas } from 'src/ink-canvas/ink-svg-canvas';
import { renderWritingStrokesToSvg } from 'src/ink-canvas/svg-export';
import { needsStrokeColourRewrite } from 'src/ink-canvas/brush-presets';
import { bakeBackgroundForSvg } from 'src/ink-canvas/bake-background';
import { registerInkEditorForPath } from 'src/logic/ink-editor-registry';
import { annotationIndexPath } from 'src/logic/pdf/annotation-index';
import { resolveInkRootFolder } from 'src/logic/pdf/pdf-paths';
import { resolveInkAutosaveDelayMs } from 'src/ink-canvas/autosave-delay';
import { computeApproxContentMaxY } from 'src/ink-canvas/stroke-viewport-culling';
import { migrateWritingFromTldraw } from 'src/ink-canvas/migrate-from-tldraw';
import type { PageBounds } from './page-bounds';
import {
	computeDedicatedWritingPageHeight,
	rescaleDedicatedWritingScrollTop,
	cropWritingStrokeHeightInvitingly,
	cropWritingStrokeHeightTightly,
	shouldResizeForNewHeight,
} from 'src/components/formats/current/utils/tldraw-helpers';
import { showLegacyInkUnlockNotice } from 'src/logic/utils/legacy-ink-notice';
import { useDominantHand } from 'src/stores/dominant-hand-store';
import { useDedicatedInkWorkspaceChrome } from 'src/logic/utils/use-dedicated-ink-workspace-chrome';
import { revealInkFileInExplorer } from 'src/logic/utils/reveal-ink-file-in-explorer';
import { debug } from 'src/logic/utils/universal-dev-logging';
import type { InkCanvasEditor, InkCanvasSnapshot, InkStroke, InkPoint } from 'src/ink-canvas/types';
import { normalizeBooxPenPressureForCapture } from 'src/ink-canvas/constants/pen-input';
import { buildInkStrokeStyleForTreatAs } from 'src/ink-canvas/stroke-presets';
import { inkStrokeTimestampsFromBooxPoints } from 'src/ink-canvas/utils/stroke-timestamps';
import {
	enqueueManualTranscription,
	registerTranscriptionEditorSession,
	replaceTranscriptionEditorSession,
	unregisterTranscriptionEditorSession,
} from 'src/logic/handwriting-transcription-queue';
///////////////////////////
///////////////////////////

interface BooxCanvasPoint {
	pressure: number;
	size: number;
	tiltX: number;
	tiltY: number;
	timestamp: number;
	x: number;
	y: number;
}

interface BooxStrokePayload {
	strokeId?: number;
	points?: BooxCanvasPoint[];
	canvasWidth?: number;
	canvasHeight?: number;
}

interface WritingEditorProps {
	onResize?: (invitingBounds: PageBounds, tightBounds: PageBounds) => void;
	plugin: InkPlugin;
	workspaceLeafId: string;
	embedId?: string;
	writingFile: TFile;
	save: (inkFileData: InkFileData) => void | Promise<void>;
	extendedMenu?: MenuOption[];
	embedded?: boolean;
	closeEditor?: () => void | Promise<void>;
	saveControlsReference?: (controls: WritingEditorControls) => void;
	onOpenInDedicatedView?: () => void;
	/** Embed only: also write the transcript into the note's image alt text. */
	onTranscriptSaved?: (transcript: string) => void;
}

export const WritingEditorWrapper: React.FC<WritingEditorProps> = (props) => {
	const embedsInEditMode = useAtomValue(embedsInEditModeAtom);
	const editorActive = !!props.embedId && embedsInEditMode.has(props.embedId);
	if (editorActive) return <WritingEditor {...props} />;
	return <></>;
};

export function WritingEditor(props: WritingEditorProps) {
	const dominantHand = useDominantHand();
	const workspaceChrome = useDedicatedInkWorkspaceChrome(props.workspaceLeafId, !props.embedded);
	const isBooxConnectionEnabled = useBooxConnectionEnabled();
	const isFingerDrawingGloballyEnabled = useFingerDrawingEnabled();
	const [isFingerDrawingActive, setIsFingerDrawingActive] = React.useState(false);
	const [initialSnapshot, setInitialSnapshot] = React.useState<InkCanvasSnapshot>();
	const [booxConnected, setBooxConnected] = React.useState(false);
	const resizePostProcessTimeoutRef = useRef<number>();
	const shortDelayTimerRef = useRef<number>();
	const canvasInteractionActiveRef = useRef(false);
	const hasUnsavedChangesRef = useRef(false);
	const latestInvitingHeightRef = useRef(0);
	const editorRef = useRef<InkCanvasEditor>();
	const editorWrapperRefEl = useRef<HTMLDivElement>(null);
	const websocketConnectedRef = useRef(false);
	const [isBooxInputLocked, setIsBooxInputLocked] = React.useState(false);
	const activateWritingSessionRef = useRef<(() => void) | null>(null);
	const adjustThrottleRef = useRef<number | null>(null);
	const setBooxOverlayActiveTimerRef = useRef<number | null>(null);
	const isViewActiveRef = useRef(true);
	const pendingNewOverlayRef = useRef(false);
	const isAndroidDrawingAreaResizingRef = useRef(false);
	const queuedBooxStrokePayloadsRef = useRef<BooxStrokePayload[]>([]);
	const writingLineHeightRef = useRef(WRITING_LINE_HEIGHT);
	/** Survives canvas autosaves so a later transcribe is not wiped by stroke writes. */
	const transcriptRef = useRef<string | undefined>(undefined);
	/** Metadata from the file as loaded; merged into every save. */
	const inkMetaRef = useRef<InkFileMetadata | undefined>(undefined);
	const transcriptionSessionRegisteredRef = useRef(false);
	const [hasTranscript, setHasTranscript] = React.useState(false);
	/** "Magic pen": pause after writing and a margin reply writes itself in. */
	const [isMagicInkActive, setIsMagicInkActive] = React.useState(false);
	const magicInkWatcherRef = useRef<MagicInkWatcher | null>(null);
	const magicInkCardRef = useRef<MagicInkCard | null>(null);
	const magicInkBusyRef = useRef(false);
	/** Applied embed/page inviting height — drives shouldResizeForNewHeight. */
	const curHeightRef = useRef<number | null>(null);
	const isLegacyInkFileRef = useRef(false);
	/** Dedicated writing: native tall-page scroller (not camera pan). */
	const dedicatedScrollerRef = useRef<HTMLDivElement>(null);
	const dedicatedPageRef = useRef<HTMLDivElement>(null);
	const [dedicatedPageCssHeightPx, setDedicatedPageCssHeightPx] = React.useState<number | null>(null);
	/** Last width-fit zoom applied to dedicated page CSS — used only when zoom changes. */
	const dedicatedLastZoomRef = useRef<number | null>(null);

	React.useEffect(() => {
		if (!isFingerDrawingGloballyEnabled) setIsFingerDrawingActive(false);
	}, [isFingerDrawingGloballyEnabled]);

	React.useEffect(() => {
		verbose('INK CANVAS WRITING EDITOR mounted');
		logToVault('笔墨 canvas writing editor mounted: ' + props.writingFile.path + (props.embedded ? ' [embed]' : ' [dedicated]'));
		void fetchFileData();
		return () => {
			verbose('INK CANVAS WRITING EDITOR unmounting');
			logToVault('笔墨 canvas writing editor unmounted: ' + props.writingFile.path);
			transcriptionSessionRegisteredRef.current = false;
			// Note/tab close never calls saveAndHalt. Finish the last save then unregister
			// so a held transcript is written before enqueueAuto reads disk strokes.
			void Promise.resolve(completeSave()).finally(() => {
				return unregisterTranscriptionEditorSession(props.writingFile.path);
			});
		};
	}, []);

	React.useEffect(() => {
		if (!initialSnapshot || !isLegacyInkFileRef.current) return;
		showLegacyInkUnlockNotice({
			plugin: props.plugin,
			legacyFile: props.writingFile,
			isEmbedded: props.embedded,
		});
	}, [initialSnapshot]);

	React.useEffect(() => {
		return () => resetTimers();
	}, []);

	React.useEffect(() => {
		if (!initialSnapshot) return;
		if (!getBooxConnectionEnabled()) return;

		const { unregister, activate } = props.plugin.booxConnection.registerDrawingSession({
			onStrokeStart: () => {
				cancelDelayedBooxResizePostProcess();
			},
			onStroke: (strokeData: unknown) => {
				const payload = strokeData as BooxStrokePayload;
				const strokePayload: BooxStrokePayload = {
					strokeId: payload.strokeId,
					points: payload.points ?? (strokeData as BooxCanvasPoint[]),
					canvasWidth: payload.canvasWidth,
					canvasHeight: payload.canvasHeight,
				};
				if (isAndroidDrawingAreaResizingRef.current) {
					queuedBooxStrokePayloadsRef.current.push(strokePayload);
					return;
				}
				const created = createStrokeFromBoox(strokePayload);
				if (created && strokePayload.strokeId !== undefined) {
					props.plugin.booxConnection.sendStrokeRendered(strokePayload.strokeId);
				}
			},
			onDrawingAreaReady: () => {
				if (!isAndroidDrawingAreaResizingRef.current && queuedBooxStrokePayloadsRef.current.length === 0) return;
				isAndroidDrawingAreaResizingRef.current = false;
				flushQueuedBooxStrokesAfterResize();
			},
			onSocketOpen: () => {
				// No Obsidian Notice here — Boox chrome, expand-lines, and input lock already show companion mode.
				websocketConnectedRef.current = true;
				setBooxConnected(true);
				setIsBooxInputLocked(true);
				debug('笔墨 canvas writing: Connected to Boox companion app WebSocket');
				const sent = newAndroidDrawingArea();
				if (sent) {
					pendingNewOverlayRef.current = false;
					const editor = editorRef.current;
					if (editor) {
						props.plugin.booxConnection.sendUpdateTool('draw', getBooxStrokeSizeCssPx(editor));
					}
				} else {
					pendingNewOverlayRef.current = true;
				}
			},
			onReactivate: () => {
				if (!websocketConnectedRef.current) return;
				if (setBooxOverlayActiveTimerRef.current) window.clearTimeout(setBooxOverlayActiveTimerRef.current);
				setBooxOverlayActiveTimerRef.current = window.setTimeout(() => {
					setBooxOverlayActiveTimerRef.current = null;
					if (!websocketConnectedRef.current) return;
					activateWritingSessionRef.current?.();
					const sent = newAndroidDrawingArea();
					if (sent) {
						pendingNewOverlayRef.current = false;
						const editor = editorRef.current;
						if (editor) props.plugin.booxConnection.sendUpdateTool('draw', getBooxStrokeSizeCssPx(editor));
					} else {
						pendingNewOverlayRef.current = true;
					}
				}, 0);
			},
		});
		activateWritingSessionRef.current = activate;

		return () => {
			websocketConnectedRef.current = false;
			setBooxConnected(false);
			setIsBooxInputLocked(false);
			pendingNewOverlayRef.current = false;
			isAndroidDrawingAreaResizingRef.current = false;
			queuedBooxStrokePayloadsRef.current = [];
			if (adjustThrottleRef.current) window.clearTimeout(adjustThrottleRef.current);
			if (setBooxOverlayActiveTimerRef.current) window.clearTimeout(setBooxOverlayActiveTimerRef.current);
			activateWritingSessionRef.current = null;
			unregister();
		};
	}, [initialSnapshot]);

	React.useEffect(() => {
		if (!initialSnapshot) return;
		if (!getBooxConnectionEnabled()) return;
		if (!editorWrapperRefEl.current) return;

		// Embed: Obsidian note scroller. Dedicated: tall writing page scroller.
		const scrollEl = props.embedded
			? editorWrapperRefEl.current.closest('.cm-scroller')
			: dedicatedScrollerRef.current;
		if (!scrollEl) return;

		const onScroll = () => {
			if (!isViewActiveRef.current) return;
			restoreEmbedCmScrollerScroll(editorWrapperRefEl.current);
			adjustAndroidDrawingAreaThrottled();
		};
		scrollEl.addEventListener('scroll', onScroll, { passive: true });

		const visualViewport = typeof window !== 'undefined' ? window.visualViewport : null;
		const onVisualViewportChange = () => {
			if (!isViewActiveRef.current) return;
			restoreEmbedCmScrollerScroll(editorWrapperRefEl.current);
			adjustAndroidDrawingAreaThrottled();
		};
		visualViewport?.addEventListener('scroll', onVisualViewportChange);
		visualViewport?.addEventListener('resize', onVisualViewportChange);

		return () => {
			scrollEl.removeEventListener('scroll', onScroll);
			visualViewport?.removeEventListener('scroll', onVisualViewportChange);
			visualViewport?.removeEventListener('resize', onVisualViewportChange);
		};
	}, [initialSnapshot, props.embedded]);

	React.useEffect(() => {
		if (!initialSnapshot) return;
		if (!editorWrapperRefEl.current) return;

		const resizeObserver = new ResizeObserver(() => {
			if (!props.embedded) {
				syncDedicatedPageCssHeight({ preservePageScroll: true });
			}
			if (pendingNewOverlayRef.current && isViewActiveRef.current && websocketConnectedRef.current) {
				const sent = newAndroidDrawingArea();
				if (sent) {
					pendingNewOverlayRef.current = false;
					const editor = editorRef.current;
					if (editor) {
						props.plugin.booxConnection.sendUpdateTool('draw', getBooxStrokeSizeCssPx(editor));
					}
					return;
				}
				return;
			}
			if (websocketConnectedRef.current && isViewActiveRef.current) {
				sendAdjustmentImmediate();
			}
		});
		const observeTarget = props.embedded
			? editorWrapperRefEl.current
			: (dedicatedScrollerRef.current ?? editorWrapperRefEl.current);
		resizeObserver.observe(observeTarget);
		return () => resizeObserver.disconnect();
	}, [initialSnapshot, props.embedded]);

	/**
	 * Map writing pageHeight (page units) → CSS px for the tall dedicated page.
	 * zoom = scrollerWidth / WRITING_PAGE_WIDTH (same width-fit as the canvas camera).
	 *
	 * Height growth must not change scrollTop — that would jump ink under the pen.
	 * Only rescale scrollTop when width-fit zoom actually changes, and leave a
	 * scroll that is still inside the menubar padding where it is. Jumping that
	 * position down to the padding height hides the gap above the first line
	 * as soon as the sidebars collapse on open.
	 */
	function syncDedicatedPageCssHeight(options?: {
		pageHeight?: number;
		preservePageScroll?: boolean;
	}) {
		if (props.embedded) return;
		const scroller = dedicatedScrollerRef.current;
		const editor = editorRef.current;
		if (!scroller) return;

		const zoom = Math.max(scroller.clientWidth, 1) / WRITING_PAGE_WIDTH;
		const pageHeight = options?.pageHeight
			?? editor?.getPageHeight()
			?? WRITING_MIN_PAGE_HEIGHT;
		const nextCssHeight = pageHeight * zoom;
		const prevScrollTop = scroller.scrollTop;
		const prevZoom = dedicatedLastZoomRef.current;

		setDedicatedPageCssHeightPx(nextCssHeight);
		dedicatedLastZoomRef.current = zoom;

		if (
			options?.preservePageScroll
			&& prevZoom != null
			&& Math.abs(prevZoom - zoom) > 1e-6
		) {
			window.requestAnimationFrame(() => {
				const el = dedicatedScrollerRef.current;
				if (!el) return;
				// Stay at the top gap when the view opens. Snapping to the pad
				// hid the space above the first line as soon as zoom changed.
				el.scrollTop = rescaleDedicatedWritingScrollTop(
					prevScrollTop,
					prevZoom,
					zoom,
					MENUBAR_HEIGHT_PX,
				);
			});
		}
	}

	function handleEditorReady(editor: InkCanvasEditor) {
		editorRef.current = editor;
		const leafId = props.workspaceLeafId;

		// Lets "set page image" reach this editor without a remount.
		registerInkEditorForPath(props.writingFile.path, editor);

		if (props.embedded && props.embedId && leafId) {
			initializeEmbeddedUnifiedUndo(props.plugin, leafId, props.embedId, editor);
			registerInkEditor(
				props.embedId,
				editor,
				editor.getContainerElement()!,
				leafId,
			);
		}
		if (!props.embedded && leafId) {
			registerDedicatedInkEditor(leafId, editor);
		}

		if (editorWrapperRefEl.current) {
			editorWrapperRefEl.current.classList.remove('ddc_ink_editor-wrapper--loading');
		}

		// One-time colour repair. Pages saved before the highlighter fix still
		// hold `fill="black"` at 32% opacity — a grey wash. The export path is
		// already correct, so rewriting the file once fixes every old stroke on
		// that page. Deferred so it cannot race the initial load or a migration.
		window.setTimeout(() => {
			const current = editorRef.current;
			if (!current) return;
			if (!needsStrokeColourRewrite(current.getSnapshot().strokes)) return;
			verbose('Rewriting page: brushes now bake their own colour');
			void incrementalSave();
		}, 700);

		const controls = {
			save: () => void completeSave(),
			saveAndHalt: async () => {
				await completeSave();
				unmountActions();
				// Close the transcription session before embed lock calls enqueueAuto.
				// React unmount is async; leaving the session open makes kick skip the job.
				transcriptionSessionRegisteredRef.current = false;
				await unregisterTranscriptionEditorSession(props.writingFile.path);
			},
			eraseAll: async () => {
				editor.eraseAll();
				await completeSave();
			},
			setBooxOverlayActive: (isActive: boolean) => {
				isViewActiveRef.current = isActive;
				if (!isActive) {
					pendingNewOverlayRef.current = false;
					props.plugin.booxConnection.sendCloseDrawingArea();
				} else {
					activateWritingSessionRef.current?.();
					const sent = newAndroidDrawingArea();
					if (!sent) pendingNewOverlayRef.current = true;
				}
			},
		};
		if (props.saveControlsReference) {
			props.saveControlsReference(controls);
		}
		const transcriptionSession = {
			filePath: props.writingFile.path,
			fileType: 'inkWriting' as const,
			saveAndHalt: controls.saveAndHalt,
			onTranscriptApplied: (transcript: string) => {
				transcriptRef.current = transcript;
				setHasTranscript(true);
				props.onTranscriptSaved?.(transcript);
			},
		};
		if (transcriptionSessionRegisteredRef.current) {
			replaceTranscriptionEditorSession(transcriptionSession);
		} else {
			registerTranscriptionEditorSession(transcriptionSession);
			transcriptionSessionRegisteredRef.current = true;
		}

		if (getBooxConnectionEnabled() && props.plugin.booxConnection.isConnected()) {
			websocketConnectedRef.current = true;
			setBooxConnected(true);
			setIsBooxInputLocked(true);
			activateWritingSessionRef.current?.();
			newAndroidDrawingArea();
			const editor = editorRef.current;
			if (editor) {
				props.plugin.booxConnection.sendUpdateTool('draw', getBooxStrokeSizeCssPx(editor));
			}
		}

		if (props.embedded) {
			applyInitialEmbedSizing();
		} else {
			applyPageHeightChange(0, false);
		}
	}

	function getInvitingHeightFromEditor(editor: InkCanvasEditor): number {
		const lineHeight = writingLineHeightRef.current;
		const bufferLines = props.plugin.settings.writingBufferLines;
		const strokes = editor.getSnapshot().strokes;
		const contentHeight = strokes.length > 0
			? computeApproxContentMaxY(strokes)
			: 0;
		return cropWritingStrokeHeightInvitingly(contentHeight, bufferLines, lineHeight);
	}

	function applyInitialEmbedSizing() {
		if (!props.embedded) return;

		const tryApply = (): boolean => {
			const editor = editorRef.current;
			const resizeContainer = editorWrapperRefEl.current?.closest('.ddc_ink_resize-container');
			if (!editor || !resizeContainer) return false;
			if (!resizeContainer.getBoundingClientRect().width) return false;
			applyPageHeightChange(0, true);
			return true;
		};

		window.requestAnimationFrame(() => {
			if (tryApply()) return;
			const resizeContainer = editorWrapperRefEl.current?.closest('.ddc_ink_resize-container');
			if (!resizeContainer) return;
			const observer = new ResizeObserver(() => {
				if (tryApply()) observer.disconnect();
			});
			observer.observe(resizeContainer);
		});
	}

	function unmountActions() {
		resetTimers();
		const leafId = props.workspaceLeafId;
		if (props.embedded && props.embedId) {
			unregisterInkEditor(props.embedId);
		}
		if (!props.embedded && leafId) {
			unregisterDedicatedInkEditor(leafId, editorRef.current!);
		}
	}

	React.useEffect(() => () => {
		magicInkWatcherRef.current?.stop();
		magicInkWatcherRef.current = null;
		magicInkCardRef.current?.destroy();
		magicInkCardRef.current = null;
	}, []);

	function handleStoreChange() {
		hasUnsavedChangesRef.current = true;
		queueSaves();
		if (props.embedded) {
			debouncedEmbedResizePostProcess();
		}
		// Restarts the "you stopped writing" timer. Counting strokes is cheap
		// (the snapshot shares the stroke array) and lets the watcher skip a page
		// where only the eraser ran.
		if (magicInkWatcherRef.current) {
			const strokeCount = editorRef.current?.getSnapshot().strokes.length ?? 0;
			magicInkWatcherRef.current.touch(strokeCount);
		}
	}

	//////////
	// Magic pen — write, pause, the answer writes itself into the margin.
	//////////

	function toggleMagicInk() {
		if (isMagicInkActive) {
			magicInkWatcherRef.current?.stop();
			magicInkWatcherRef.current = null;
			magicInkCardRef.current?.destroy();
			magicInkCardRef.current = null;
			setIsMagicInkActive(false);
			new Notice(t('Magic margin off'));
			return;
		}

		if (!isAiEndpointUsable(props.plugin.settings.customTranscriptionProvider)) {
			new Notice(t('Enable a custom API in settings first.'));
			return;
		}

		const host = editorWrapperRefEl.current;
		if (!host) return;

		const card = new MagicInkCard(host, {
			onInsert: (text) => { void insertMagicInkReply(text); },
			onAskAgain: () => { void askMagicInk(); },
			onClose: () => {
				magicInkWatcherRef.current?.stop();
				magicInkWatcherRef.current = null;
				setIsMagicInkActive(false);
			},
		});
		magicInkCardRef.current = card;

		const watcher = new MagicInkWatcher(() => { void askMagicInk(); }, {
			idleMs: props.plugin.settings.magicInkIdleMs,
			minNewStrokes: props.plugin.settings.magicInkMinStrokes,
		});
		magicInkWatcherRef.current = watcher;
		watcher.start(editorRef.current?.getSnapshot().strokes.length ?? 0);
		setIsMagicInkActive(true);
		new Notice(t('Magic margin on: pause and the reply appears'));
	}

	async function askMagicInk() {
		const card = magicInkCardRef.current;
		const editor = editorRef.current;
		if (!card || !editor || magicInkBusyRef.current) return;

		const provider = props.plugin.settings.customTranscriptionProvider;
		if (!isAiEndpointUsable(provider)) {
			new Notice(t('Enable a custom API in settings first.'));
			return;
		}

		magicInkBusyRef.current = true;
		const snapshot = editor.getSnapshot();
		card.setPlacement(replyPlacementForLastStroke(snapshot.strokes));
		card.showPending();
		try {
			// 笔墨 only: a page background would let the model read printed text as
			// if the writer had written it.
			const svg = renderWritingStrokesToSvg(
				snapshot.strokes,
				{ ...snapshot, background: undefined, sourcePdf: undefined },
				WRITING_PAGE_WIDTH,
			);
			const media = await prepareProviderMedia(svg, 'png');
			const reply = await requestAiCompletion({
				settings: provider,
				systemPrompt: MAGIC_INK_SYSTEM_PROMPT,
				userText: buildMagicInkUserPrompt(transcriptRef.current),
				media,
			});
			const cleaned = reply.trim();
			// The prompt asks for a bare "。" on a blank page. Treat it, and empty
			// output, as silence rather than drawing an empty card.
			if (!cleaned || cleaned === '。' || cleaned === '.') {
				card.hide();
				return;
			}
			card.showReply(cleaned);
		} catch (error) {
			verbose(['Magic ink request failed', error]);
			card.showError(t('Could not reach the endpoint. Check the settings and the key.'));
		} finally {
			magicInkBusyRef.current = false;
		}
	}

	async function insertMagicInkReply(text: string) {
		const view = props.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			new Notice(t('Open a note first.'));
			return;
		}
		view.editor.replaceSelection(text);
		new Notice(t('Inserted into the note'));
		magicInkCardRef.current?.hide();
	}

	function handleCanvasInteractionChange(active: boolean) {
		// Pause autosave while the pen is down so large SVG serialize cannot hitch mid-stroke.
		canvasInteractionActiveRef.current = active;
		if (active) {
			resetTimers();
			return;
		}
		if (hasUnsavedChangesRef.current) queueSaves();
	}

	function handleEmbedUndoStackPush() {
		if (props.embedded && props.embedId && props.workspaceLeafId) {
			recordEmbedCanvasActionOnUnifiedStack(props.workspaceLeafId, props.embedId);
		}
	}

	function cancelDelayedBooxResizePostProcess() {
		if (resizePostProcessTimeoutRef.current !== undefined) {
			window.clearTimeout(resizePostProcessTimeoutRef.current);
			resizePostProcessTimeoutRef.current = undefined;
		}
	}

	/** Boox toggle on: no automatic embed resize (erase/select close the overlay but keep this rule). */
	function shouldSkipBooxEmbedAutoResize(): boolean {
		return getBooxConnectionEnabled();
	}

	function debouncedEmbedResizePostProcess() {
		cancelDelayedBooxResizePostProcess();
		resizePostProcessTimeoutRef.current = window.setTimeout(() => {
			resizePostProcessTimeoutRef.current = undefined;
			const editor = editorRef.current;
			if (!editor || !props.embedded) return;
			if (shouldSkipBooxEmbedAutoResize()) return;
			const invitingHeight = latestInvitingHeightRef.current || getInvitingHeightFromEditor(editor);
			if (!shouldResizeForNewHeight(
				invitingHeight,
				curHeightRef.current,
				props.plugin.settings.writingBufferLines,
				writingLineHeightRef.current,
			)) return;
			curHeightRef.current = invitingHeight;
			editor.setWritingPageHeight(invitingHeight);
			notifyEmbedResize(invitingHeight);
		}, WRITE_SHORT_DELAY_MS);
	}

	function handlePageHeightChange(candidateHeightPx: number) {
		latestInvitingHeightRef.current = candidateHeightPx;
		applyPageHeightChange(candidateHeightPx, false);
	}

	function applyPageHeightChange(candidateHeightPx: number, isInitialMount: boolean) {
		const editor = editorRef.current;
		if (!editor) return;

		const lineHeight = writingLineHeightRef.current;
		const bufferLines = props.plugin.settings.writingBufferLines;
		const invitingFromContent = candidateHeightPx > 0
			? candidateHeightPx
			: getInvitingHeightFromEditor(editor);
		latestInvitingHeightRef.current = invitingFromContent;

		if (props.embedded) {
			// Initial mount must still sync height when Boox skip is on; skip only blocks stroke-driven resize.
			const skipAutoResize = !isInitialMount && shouldSkipBooxEmbedAutoResize();
			if (skipAutoResize) return;

			if (isInitialMount) {
				const heightToApply = invitingFromContent;
				curHeightRef.current = heightToApply;
				editor.setWritingPageHeight(heightToApply);
				notifyEmbedResize(heightToApply);
				return;
			}

			const shouldResize = shouldResizeForNewHeight(
				candidateHeightPx,
				curHeightRef.current,
				bufferLines,
				lineHeight,
			);
			if (!shouldResize) return;

			curHeightRef.current = candidateHeightPx;
			editor.setWritingPageHeight(candidateHeightPx);
			notifyEmbedResize(candidateHeightPx);
			return;
		}

		// Dedicated view: grow tall HTML page for viewport bottom + content (never shrink).
		// scrollTop is offset by MENUBAR padding above the canvas content.
		const scroller = dedicatedScrollerRef.current;
		const viewportHeightPx = scroller?.clientHeight ?? 0;
		const scrollTopPx = Math.max(0, (scroller?.scrollTop ?? 0) - MENUBAR_HEIGHT_PX);
		const zoom = Math.max(scroller?.clientWidth ?? 1, 1) / WRITING_PAGE_WIDTH;
		const targetHeight = computeDedicatedWritingPageHeight(
			scrollTopPx,
			viewportHeightPx,
			zoom,
			invitingFromContent,
			lineHeight,
		);
		if (targetHeight > editor.getPageHeight()) {
			editor.setWritingPageHeight(targetHeight);
			curHeightRef.current = targetHeight;
			syncDedicatedPageCssHeight({
				pageHeight: targetHeight,
				preservePageScroll: true,
			});
		} else if (isInitialMount || dedicatedPageCssHeightPx === null) {
			curHeightRef.current = editor.getPageHeight();
			syncDedicatedPageCssHeight({
				pageHeight: editor.getPageHeight(),
				preservePageScroll: false,
			});
			// Open at the top of the menubar padding so the gap above the first
			// line is already on screen. Later zoom changes keep this position.
			if (scroller) scroller.scrollTop = 0;
		}
	}

	function notifyEmbedResize(pageHeight: number) {
		if (!props.embedded || !props.onResize) return;
		const pw = WRITING_PAGE_WIDTH;
		const invitingBounds: PageBounds = { x: 0, y: 0, w: pw, h: pageHeight };
		const strokes = editorRef.current?.getSnapshot().strokes ?? [];
		const lineHeight = writingLineHeightRef.current;
		const tightHeight = strokes.length > 0
			? cropWritingStrokeHeightTightly(computeApproxContentMaxY(strokes), lineHeight)
			: WRITING_MIN_PAGE_HEIGHT;
		const tightBounds: PageBounds = { x: 0, y: 0, w: pw, h: tightHeight };
		if (getBooxConnectionEnabled() && websocketConnectedRef.current) {
			isAndroidDrawingAreaResizingRef.current = true;
		}
		props.onResize(invitingBounds, tightBounds);
		sendAdjustmentImmediate();
	}

	function queueSaves() {
		resetTimers();
		// One quiet-period save only — ink-canvas incremental/complete bodies are identical;
		// a second long-delay timer would re-serialize the full SVG for free.
		if (canvasInteractionActiveRef.current) return;
		const delayMs = resolveInkAutosaveDelayMs(Platform, WRITE_SHORT_DELAY_MS, WRITE_LONG_DELAY_MS);
		shortDelayTimerRef.current = window.setTimeout(() => {
			void incrementalSave();
		}, delayMs);
	}

	/**
	 * Renders the page, baking in the background image when one is set.
	 *
	 * The bake is awaited once per save: the rasterised JPEG is cached per
	 * (path, mtime), so only the first save after changing the page pays for it.
	 * A failed bake degrades to an ink-only SVG rather than blocking the save.
	 */
	async function renderSnapshotSvg(snapshot: ReturnType<InkCanvasEditor['getSnapshot']>): Promise<string> {
		const baked = snapshot.background
			? await bakeBackgroundForSvg(props.plugin.app, snapshot.background, WRITING_PAGE_WIDTH)
			: undefined;
		return renderWritingStrokesToSvg(snapshot.strokes, snapshot, WRITING_PAGE_WIDTH, 0, baked);
	}

	async function incrementalSave() {
		if (canvasInteractionActiveRef.current) {
			queueSaves();
			return;
		}
		const editor = editorRef.current;
		if (!editor) return;
		verbose('incrementalSave (ink-canvas writing)');
		const snapshot = editor.getSnapshot();
		const svgString = await renderSnapshotSvg(snapshot);
		hasUnsavedChangesRef.current = false;
		await props.save(buildInkCanvasWritingFileData({
			inkCanvasSnapshot: snapshot,
			svgString,
			transcript: transcriptRef.current,
			meta: inkMetaRef.current,
		}));
	}

	async function completeSave(): Promise<void> {
		const editor = editorRef.current;
		if (!editor) return;
		verbose('completeSave (ink-canvas writing)');
		const snapshot = editor.getSnapshot();
		const svgString = await renderSnapshotSvg(snapshot);
		hasUnsavedChangesRef.current = false;
		await props.save(buildInkCanvasWritingFileData({
			inkCanvasSnapshot: snapshot,
			svgString,
			transcript: transcriptRef.current,
			meta: inkMetaRef.current,
		}));
	}

	function resetTimers() {
		cancelDelayedBooxResizePostProcess();
		window.clearTimeout(shortDelayTimerRef.current);
	}

	async function fetchFileData() {
		const svg = await props.writingFile.vault.read(props.writingFile);
		const data = extractInkJsonFromSvg(svg);
		if (!data) return;

		isLegacyInkFileRef.current = !isInkCanvasFile(data);

		let snapshot: InkCanvasSnapshot;
		if (isInkCanvasFile(data) && data.inkCanvas) {
			snapshot = data.inkCanvas;
		} else {
			const fallbackLineHeight = data.meta.writingLineHeight ?? WRITING_LINE_HEIGHT;
			snapshot = migrateWritingFromTldraw(
				data.tldraw,
				fallbackLineHeight,
			);
		}
		writingLineHeightRef.current = snapshot.writingLineHeight ?? WRITING_LINE_HEIGHT;
		transcriptRef.current = data.meta.transcript;
		// Carried into every save: an editor save rebuilds the file from the
		// snapshot, so anything omitted here is erased (see build-file-data.ts).
		inkMetaRef.current = data.meta;
		setHasTranscript(!!data.meta.transcript);
		setInitialSnapshot(snapshot);
	}

	/**
	 * Manual overflow action: enqueue live-canvas SVG. Not gated by auto-transcribe settings.
	 */
	async function handleTranscribe() {
		const editor = editorRef.current;
		if (!editor) return;
		const snapshot = editor.getSnapshot();
		// Deliberately ink-only: when this page sits on a PDF background, sending
		// the page image would make the model transcribe the printed text as if it
		// were handwriting. Transcription must see only what the user wrote.
		const svgString = renderWritingStrokesToSvg(snapshot.strokes, snapshot, WRITING_PAGE_WIDTH);
		const writingSvgFileContent = buildFileStr(buildInkCanvasWritingFileData({
			inkCanvasSnapshot: snapshot,
			svgString,
			transcript: transcriptRef.current,
			meta: inkMetaRef.current,
		}));
		// Capture live canvas before lock unmounts the editor; lock so preview + queue UI show while transcribing.
		if (props.embedded && props.closeEditor) {
			await props.closeEditor();
		}
		await enqueueManualTranscription({
			file: props.writingFile,
			fileType: 'inkWriting',
			svgFileContent: writingSvgFileContent,
		});
	}

	function getEditor(): InkCanvasEditor | undefined {
		return editorRef.current;
	}

	function clampToVisibleViewport(embedRect: DOMRect) {
		const visibleTop = Math.max(0, embedRect.y);
		const visibleBottom = Math.min(window.innerHeight, embedRect.y + embedRect.height);
		const visibleLeft = Math.max(0, embedRect.x);
		const visibleRight = Math.min(window.innerWidth, embedRect.x + embedRect.width);
		return {
			x: Math.round(visibleLeft),
			y: Math.round(visibleTop),
			width: Math.round(Math.max(0, visibleRight - visibleLeft)),
			height: Math.round(Math.max(0, visibleBottom - visibleTop)),
		};
	}

	/** Boox overlay + stroke mapping surface (matches drawing editor: container in dedicated view). */
	function getBooxWritingSurfaceRects(): { raw: DOMRect; clamped: DOMRect | null } | null {
		const wrapper = editorWrapperRefEl.current;
		if (!wrapper) return null;
		let raw: DOMRect;
		if (props.embedded) {
			raw = wrapper.getBoundingClientRect();
		} else {
			const editor = editorRef.current;
			const container = editor?.getContainerElement();
			if (container) {
				const containerRect = container.getBoundingClientRect();
				raw = containerRect.width > 1 && containerRect.height > 1
					? containerRect
					: wrapper.getBoundingClientRect();
			} else {
				raw = wrapper.getBoundingClientRect();
			}
		}
		const visible = clampToVisibleViewport(raw);
		if (visible.width <= 0 || visible.height <= 0) {
			return { raw, clamped: null };
		}
		return {
			raw,
			clamped: new DOMRect(visible.x, visible.y, visible.width, visible.height),
		};
	}

	function getMenuExcludeRects(wrapperEl: HTMLDivElement): Array<{ x: number; y: number; width: number; height: number }> {
		const rects: Array<{ x: number; y: number; width: number; height: number }> = [];
		const menuBarEl = wrapperEl.querySelector('.ink_primary-menu-bar');
		if (menuBarEl) {
			const rect = menuBarEl.getBoundingClientRect();
			if (rect.width > 0 && rect.height > 0) {
				rects.push({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) });
			}
		}
		const secondaryBarEl = wrapperEl.querySelector('.ink_secondary-menu-bar');
		if (secondaryBarEl) {
			const rect = secondaryBarEl.getBoundingClientRect();
			if (rect.width > 0 && rect.height > 0) {
				rects.push({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) });
			}
		}
		return rects;
	}

	function flushQueuedBooxStrokesAfterResize() {
		const queuedStrokePayloads = queuedBooxStrokePayloadsRef.current;
		queuedBooxStrokePayloadsRef.current = [];
		for (const queuedStrokePayload of queuedStrokePayloads) {
			if (createStrokeFromBoox(queuedStrokePayload) && queuedStrokePayload.strokeId !== undefined) {
				props.plugin.booxConnection.sendStrokeRendered(queuedStrokePayload.strokeId);
			}
		}
	}

	function newAndroidDrawingArea(): boolean {
		if (!editorWrapperRefEl.current) return false;
		if (!getBooxConnectionEnabled()) return false;

		const surfaceRects = getBooxWritingSurfaceRects();
		if (!surfaceRects?.clamped) {
			pendingNewOverlayRef.current = true;
			return false;
		}
		const visible = {
			x: Math.round(surfaceRects.clamped.x),
			y: Math.round(surfaceRects.clamped.y),
			width: Math.round(surfaceRects.clamped.width),
			height: Math.round(surfaceRects.clamped.height),
		};
		pendingNewOverlayRef.current = false;

		props.plugin.booxConnection.sendNewDrawingArea({
			x: visible.x,
			y: visible.y,
			canvasWidth: visible.width,
			canvasHeight: visible.height,
			appWidth: window.innerWidth,
			appHeight: window.innerHeight,
			cornerMarkers: buildBooxCornerMarkers({
				wrapper: editorWrapperRefEl.current,
				isDedicatedView: !props.embedded,
			}),
			excludeRects: getMenuExcludeRects(editorWrapperRefEl.current),
		});
		return true;
	}

	function repositionBooxOverlayAfterEmbedGeometryChange() {
		restoreEmbedCmScrollerScroll(editorWrapperRefEl.current);
		if (!websocketConnectedRef.current || !isViewActiveRef.current) return;
		if (!getBooxConnectionEnabled()) return;

		if (props.embedded) {
			activateWritingSessionRef.current?.();
			const sent = newAndroidDrawingArea();
			if (sent) {
				pendingNewOverlayRef.current = false;
				const editor = editorRef.current;
				if (editor) {
					props.plugin.booxConnection.sendUpdateTool('draw', getBooxStrokeSizeCssPx(editor));
				}
			} else {
				pendingNewOverlayRef.current = true;
			}
			return;
		}
		sendAdjustment(false);
	}

	/** Throttled — scroll events (matches release_0.5 / Bridge docs). */
	function adjustAndroidDrawingAreaThrottled() {
		if (!isViewActiveRef.current) return;
		if (adjustThrottleRef.current) window.clearTimeout(adjustThrottleRef.current);
		adjustThrottleRef.current = window.setTimeout(() => {
			adjustThrottleRef.current = null;
			repositionBooxOverlayAfterEmbedGeometryChange();
		}, 200);
	}

	function sendAdjustmentImmediate() {
		if (adjustThrottleRef.current) window.clearTimeout(adjustThrottleRef.current);
		adjustThrottleRef.current = window.setTimeout(() => {
			adjustThrottleRef.current = null;
			sendAdjustment(true);
		}, 50);
	}

	function sendAdjustment(immediate: boolean) {
		if (!editorWrapperRefEl.current) return;
		if (!websocketConnectedRef.current) return;
		if (!isViewActiveRef.current) return;
		if (!getBooxConnectionEnabled()) return;

		const surfaceRects = getBooxWritingSurfaceRects();
		if (!surfaceRects?.clamped) {
			pendingNewOverlayRef.current = true;
			return;
		}
		const visible = {
			x: Math.round(surfaceRects.clamped.x),
			y: Math.round(surfaceRects.clamped.y),
			width: Math.round(surfaceRects.clamped.width),
			height: Math.round(surfaceRects.clamped.height),
		};
		pendingNewOverlayRef.current = false;

		props.plugin.booxConnection.sendUpdateDrawingArea({
			x: visible.x,
			y: visible.y,
			canvasWidth: visible.width,
			canvasHeight: visible.height,
			appWidth: window.innerWidth,
			appHeight: window.innerHeight,
			cornerMarkers: buildBooxCornerMarkers({
				wrapper: editorWrapperRefEl.current,
				isDedicatedView: !props.embedded,
			}),
			immediate,
			excludeRects: getMenuExcludeRects(editorWrapperRefEl.current),
		});
	}

	function getBooxStrokeSizeCssPx(editor: InkCanvasEditor): number {
		const BOOX_STROKE_SIZE_SCALE = 2;
		const style = editor.getStrokeStyle();
		const zoom = editor.getCamera().zoom;
		return style.size * zoom * BOOX_STROKE_SIZE_SCALE;
	}

	function handleBooxActivateTool(activatedTool: 'draw' | 'erase' | 'select') {
		if (!getBooxConnectionEnabled()) return;

		const isNonDrawTool = activatedTool === 'erase' || activatedTool === 'select';
		const isBooxConnected = props.plugin.booxConnection.isConnected();

		if (isNonDrawTool && websocketConnectedRef.current) {
			websocketConnectedRef.current = false;
			setBooxConnected(false);
			setIsBooxInputLocked(false);
			pendingNewOverlayRef.current = false;
			if (adjustThrottleRef.current) window.clearTimeout(adjustThrottleRef.current);
			props.plugin.booxConnection.sendCloseDrawingArea();
		} else if (activatedTool === 'draw' && !websocketConnectedRef.current) {
			if (isBooxConnected) {
				websocketConnectedRef.current = true;
				setBooxConnected(true);
				setIsBooxInputLocked(true);
				activateWritingSessionRef.current?.();
				const sent = newAndroidDrawingArea();
				if (sent) {
					pendingNewOverlayRef.current = false;
					const editor = editorRef.current;
					if (editor) {
						props.plugin.booxConnection.sendUpdateTool('draw', getBooxStrokeSizeCssPx(editor));
					}
				} else {
					pendingNewOverlayRef.current = true;
				}
			} else {
				void props.plugin.booxConnection.ensureConnected().catch((error) => {
					verbose(['BooxConnection: reconnect from writing draw tool failed', error]);
				});
			}
		}
	}

	function createStrokeFromBoox(strokePayload: BooxStrokePayload | BooxCanvasPoint[]): boolean {
		const payload = Array.isArray(strokePayload)
			? { points: strokePayload }
			: strokePayload;
		const canvasRelativePoints = payload.points ?? [];
		if (!editorWrapperRefEl.current) return false;
		const editor = editorRef.current;
		if (!editor) return false;

		const surfaceRects = getBooxWritingSurfaceRects();
		if (!surfaceRects?.clamped) return false;
		const surfaceRect = surfaceRects.clamped;

		const sourceCanvasWidth = payload.canvasWidth && payload.canvasWidth > 0
			? payload.canvasWidth
			: surfaceRect.width;
		const sourceCanvasHeight = payload.canvasHeight && payload.canvasHeight > 0
			? payload.canvasHeight
			: surfaceRect.height;
		if (sourceCanvasWidth <= 0 || sourceCanvasHeight <= 0) return false;

		const inkPoints: InkPoint[] = canvasRelativePoints.map(pt => {
			const sx = surfaceRect.left + (pt.x / sourceCanvasWidth) * surfaceRect.width;
			const sy = surfaceRect.top + (pt.y / sourceCanvasHeight) * surfaceRect.height;
			const page = editor.screenToPage(sx, sy);
			return [
				page.x,
				page.y,
				normalizeBooxPenPressureForCapture(pt.pressure),
			] as InkPoint;
		});

		const stroke: InkStroke = {
			id: crypto.randomUUID(),
			authoringSource: 'boox',
			points: inkPoints,
			style: {
				...buildInkStrokeStyleForTreatAs(editor.getStrokeStyle(), 'pen', editor.getCamera().zoom),
				simulatePressure: false,
			},
			offset: { x: 0, y: 0 },
			...inkStrokeTimestampsFromBooxPoints(canvasRelativePoints),
		};

		editor.addStroke(stroke);
		return true;
	}

	function expandWritingLinesByOne() {
		const editor = editorRef.current;
		if (!editor) return;
		const lineHeight = writingLineHeightRef.current;
		const bufferLines = props.plugin.settings.writingBufferLines;
		// Boox manual grow: resize inline via notifyEmbedResize — not applyPageHeightChange (no bypass flags).
		const newHeight = editor.getPageHeight() + bufferLines * lineHeight;
		curHeightRef.current = newHeight;
		latestInvitingHeightRef.current = newHeight;
		editor.setWritingPageHeight(newHeight);
		notifyEmbedResize(newHeight);
	}

	if (!initialSnapshot) return <></>;

	const canvas = (
		<InkSvgCanvas
			initialSnapshot={initialSnapshot}
			writingMode={true}
			pageWidth={WRITING_PAGE_WIDTH}
			writingBufferLines={props.plugin.settings.writingBufferLines}
			onEditorReady={handleEditorReady}
			onChange={handleStoreChange}
			onInteractionChange={handleCanvasInteractionChange}
			onEmbedUndoStackPush={handleEmbedUndoStackPush}
			onPageHeightChange={handlePageHeightChange}
			isEmbedded={props.embedded}
			isBooxInputLocked={isBooxInputLocked}
			isFingerDrawingActive={isFingerDrawingActive}
			// Writing always pins its scroll parent on pen (note scroller or dedicated scroller).
			blockObsidianPenGestures={true}
			onBooxEmbedGeometryChange={
				isBooxInputLocked
					? repositionBooxOverlayAfterEmbedGeometryChange
					: undefined
			}
		/>
	);

	async function handleInsertTranscriptBelow() {
		const transcript = transcriptRef.current;
		if (!transcript) return;
		try {
			await syncTranscriptBlockInVault(
				props.plugin,
				props.writingFile.path,
				'inkWriting',
				transcript,
			);
			new Notice(t('Transcript inserted below'));
		} catch (error) {
			verbose(['Insert transcript below failed', error]);
			new Notice(t('Could not insert transcript below'));
		}
	}

	const transcribeMenuOption: MenuOption = {
		text: hasTranscript ? t('Update transcript') : t('Transcribe'),
		action: () => { void handleTranscribe(); },
	};
	const insertTranscriptOption: MenuOption = {
		text: t('Insert transcript below'),
		action: () => { void handleInsertTranscriptBelow(); },
	};
	const magicPanelOption: MenuOption = {
		text: t('Ask the margin'),
		action: () => {
			const view = props.plugin.app.workspace.getActiveViewOfType(MarkdownView);
			new MagicPanel({
				plugin: props.plugin,
				editor: view?.editor,
				contextTranscript: transcriptRef.current,
				sourcePath: props.writingFile.path,
			}).open();
		},
	};
	const setBackgroundOption: MenuOption = {
		text: t('Set page image…'),
		action: () => {
			pickVaultImage(props.plugin.app, (file) => {
				void setInkFileBackgroundWithNotice(props.plugin, props.writingFile, file);
			});
		},
	};
	const removeBackgroundOption: MenuOption = {
		text: t('Remove page image'),
		action: () => {
			void setInkFileBackgroundWithNotice(props.plugin, props.writingFile, null);
		},
	};
	const fadeBackgroundOption: MenuOption = {
		text: t('Fade page image'),
		action: () => {
			void cycleBackgroundOpacity(props.plugin, props.writingFile).then((result) => {
				if (!result.ok) new Notice(result.reason);
			});
		},
	};
	const openSourcePdfOption: MenuOption = {
		text: t('Open source PDF'),
		action: () => {
			const sourcePdf = editorRef.current?.getSnapshot().sourcePdf;
			if (!sourcePdf) {
				new Notice(t('This block was not created from a PDF.'));
				return;
			}
			void props.plugin.app.workspace.openLinkText(
				sourcePdf.path,
				props.writingFile.path,
				false,
			);
		},
	};
	const openIndexOption: MenuOption = {
		text: t('Open annotation index'),
		action: () => {
			const sourcePdf = editorRef.current?.getSnapshot().sourcePdf;
			if (!sourcePdf) {
				new Notice(t('This block was not created from a PDF.'));
				return;
			}
			const pdfFile = props.plugin.app.vault.getAbstractFileByPath(sourcePdf.path);
			if (!(pdfFile instanceof TFile)) {
				new Notice(t('Could not open this PDF.'));
				return;
			}
			// The index lives in the PDF's cache folder; it only exists once at
			// least one page of that PDF has been annotated. The folder base is
			// resolved the same way the writer resolves it, so a vault with custom
			// attachment folders still finds the file.
			void (async () => {
				const inkRoot = await resolveInkRootFolder(props.plugin, props.writingFile);
				await props.plugin.app.workspace.openLinkText(
					annotationIndexPath(inkRoot, pdfFile),
					props.writingFile.path,
					false,
				);
			})();
		},
	};
	const exportExcalidrawOption: MenuOption = {
		text: t('Export to Excalidraw'),
		action: () => { void exportInkFileToExcalidraw(props.plugin, props.writingFile); },
	};
	const overflowMenuOptions: MenuOption[] = [
		transcribeMenuOption,
		...(hasTranscript ? [insertTranscriptOption, magicPanelOption] : []),
		setBackgroundOption,
		fadeBackgroundOption,
		openSourcePdfOption,
		openIndexOption,
		removeBackgroundOption,
		exportExcalidrawOption,
		...(props.extendedMenu ?? []),
	];

	return <>
		<div
			ref={editorWrapperRefEl}
			className={classNames([
				'ddc_ink_writing-editor',
				'ddc_ink_editor-wrapper--loading',
				!props.embedded && 'ddc_ink_dedicated-editor',
				dominantHand === 'left' && 'ink_dominant-hand_left',
			])}
			style={{ height: '100%', position: 'relative' }}
			tabIndex={props.embedded ? undefined : 0}
			onKeyDownCapture={(e) => {
				if (props.embedded) return;
				const editor = editorRef.current;
				if (!editor) return;
				const modKey = e.metaKey || e.ctrlKey;
				const key = (e.key ?? '').toLowerCase();
				if (modKey && !e.shiftKey && key === 'z') {
					e.preventDefault();
					editor.undo();
					return;
				}
				if (modKey && ((e.shiftKey && key === 'z') || key === 'y')) {
					e.preventDefault();
					editor.redo();
				}
			}}
		>
			{props.embedded ? canvas : (
				<div
					ref={dedicatedScrollerRef}
					className="ddc_ink_writing-dedicated-scroller"
				>
					{/* padding-top clears the fixed primary menu (replaces old camera Y offset). */}
					<div
						ref={dedicatedPageRef}
						className="ddc_ink_writing-dedicated-page"
						style={{
							height: dedicatedPageCssHeightPx ?? '100%',
							paddingTop: MENUBAR_HEIGHT_PX,
							boxSizing: 'content-box',
						}}
					>
						{canvas}
					</div>
				</div>
			)}

			<PrimaryMenuBar>
				<InkCanvasDrawingMenu
					getEditor={getEditor}
					onStoreChange={handleStoreChange}
					onActivateTool={handleBooxActivateTool}
					onExpandClick={props.embedded ? props.onOpenInDedicatedView : undefined}
					onEnterWorkspaceChrome={props.embedded ? undefined : workspaceChrome.onEnterWorkspaceChrome}
					onExitWorkspaceChrome={props.embedded ? undefined : workspaceChrome.onExitWorkspaceChrome}
					isWorkspaceChromeHidden={workspaceChrome.isWorkspaceChromeHidden}
					onLocateFile={props.embedded ? undefined : () => revealInkFileInExplorer(props.writingFile)}
					showFingerDrawingToggle={isFingerDrawingGloballyEnabled}
					isFingerDrawingActive={isFingerDrawingActive}
					onFingerDrawingToggle={() => setIsFingerDrawingActive((active) => !active)}
					embedId={props.embedded && props.embedId ? props.embedId : undefined}
					workspaceLeafId={props.embedded && props.workspaceLeafId ? props.workspaceLeafId : undefined}
					plugin={props.embedded ? props.plugin : undefined}
					magicInk={{
						active: isMagicInkActive,
						available: isAiEndpointUsable(props.plugin.settings.customTranscriptionProvider),
						onToggle: toggleMagicInk,
					}}
				/>
				{props.embedded && (
					<ExtendedWritingMenu
						onLockClick={() => props.closeEditor?.()}
						menuOptions={overflowMenuOptions}
					/>
				)}
				{!props.embedded && (
					<ExtendedWritingMenu menuOptions={overflowMenuOptions} />
				)}
			</PrimaryMenuBar>

			<SecondaryMenuBar>
				<InkCanvasModifyMenu
					getEditor={getEditor}
					onStoreChange={handleStoreChange}
					embedId={props.embedded && props.embedId ? props.embedId : undefined}
					workspaceLeafId={props.embedded && props.workspaceLeafId ? props.workspaceLeafId : undefined}
					plugin={props.embedded ? props.plugin : undefined}
				/>
				{props.embedded && isBooxConnectionEnabled && (
					<ExpandLinesButton onExpandLines={expandWritingLinesByOne} />
				)}
			</SecondaryMenuBar>
		</div>
	</>;
}
