/** @jest-environment jsdom */
import { describe, expect, jest, test } from '@jest/globals';
import { DuplicateStrokesCommand, RestyleStrokesCommand } from 'src/ink-canvas/commands';
import { buildSelectionStrokeContextMenuOptions } from 'src/ink-canvas/selection-context-menu';
import { StrokeStore } from 'src/ink-canvas/stroke-store';
import { DEFAULT_STROKE_STYLE, type InkPoint, type InkStroke } from 'src/ink-canvas/types';
import { UndoManager } from 'src/ink-canvas/undo-manager';
import {
	buildMagicDiaryNoteContent,
	hasMagicDiaryFrontmatter,
	MAGIC_DIARY_PRESETS,
	parseMagicDiaryResponse,
	requestMagicDiaryTurn,
	resolveMagicDiarySystemPrompt,
} from 'src/logic/ai/magic-diary';
import { renderStrokesToSvg } from 'src/ink-canvas/svg-export';
import { MdInkOverlay } from 'src/logic/md-ink/md-ink-overlay';
import { PdfInkOverlay } from 'src/logic/md-ink/pdf-ink-overlay';
import { createEmptyPdfInkDocument } from 'src/logic/md-ink/pdf-ink-types';
import { createPillStylePopover } from 'src/logic/md-ink/pill-style-popover';
import { attachTouchTapUndo } from 'src/logic/md-ink/touch-tap-undo';
import { createEmptyMdInkDocument, snapStrokePoints, snapToEllipse } from 'src/logic/md-ink/types';

function makeStroke(id: string, color = '#111111'): InkStroke {
	return {
		id,
		points: [
			[10, 10, 0.5],
			[40, 25, 0.6],
		],
		style: { ...DEFAULT_STROKE_STYLE, color },
		offset: { x: 0, y: 0 },
	};
}

describe('snapToEllipse & snapStrokePoints', () => {
	test('snaps a hand-drawn closed circle/ellipse into a smooth 37-point loop', () => {
		const raw: InkPoint[] = [];
		const cx = 120;
		const cy = 90;
		const rx = 50;
		const ry = 35;
		for (let i = 0; i <= 28; i += 1) {
			const angle = (i / 28) * Math.PI * 2;
			const jitter = (i % 2 === 0 ? 1 : -1) * 1.5;
			raw.push([
				cx + (rx + jitter) * Math.cos(angle),
				cy + (ry - jitter) * Math.sin(angle),
				0.55,
			]);
		}

		const ellipse = snapToEllipse(raw, 8);
		expect(ellipse).not.toBeNull();
		expect(ellipse).toHaveLength(37);
		expect(ellipse![0][0]).toBeCloseTo(ellipse![36][0], 4);
		expect(ellipse![0][1]).toBeCloseTo(ellipse![36][1], 4);

		const viaDispatcher = snapStrokePoints(raw, 8);
		expect(viaDispatcher).toHaveLength(37);
	});

	test('does not snap an open curve into an ellipse', () => {
		const openArc: InkPoint[] = [];
		for (let i = 0; i <= 20; i += 1) {
			const angle = (i / 20) * Math.PI; // half circle only
			openArc.push([100 + 50 * Math.cos(angle), 100 + 50 * Math.sin(angle), 0.5]);
		}
		expect(snapToEllipse(openArc, 8)).toBeNull();
	});
});

describe('attachTouchTapUndo (2-finger Undo / 3-finger Redo)', () => {
	function dispatchTouch(
		el: HTMLElement,
		type: 'touchstart' | 'touchmove' | 'touchend',
		touches: Array<{ identifier: number; clientX: number; clientY: number }>,
		changedTouches: Array<{ identifier: number; clientX: number; clientY: number }>,
	): void {
		const ev = new Event(type, { bubbles: true });
		Object.defineProperty(ev, 'touches', { value: touches });
		Object.defineProperty(ev, 'changedTouches', { value: changedTouches });
		el.dispatchEvent(ev);
	}

	test('triggers onUndo on quick 2-finger tap and onRedo on quick 3-finger tap', () => {
		const el = document.createElement('div');
		const onUndo = jest.fn();
		const onRedo = jest.fn();
		const handle = attachTouchTapUndo(el, { onUndo, onRedo });

		const f1 = { identifier: 1, clientX: 100, clientY: 100 };
		const f2 = { identifier: 2, clientX: 140, clientY: 105 };
		dispatchTouch(el, 'touchstart', [f1, f2], [f1, f2]);
		dispatchTouch(el, 'touchend', [], [f1, f2]);
		expect(onUndo).toHaveBeenCalledTimes(1);
		expect(onRedo).not.toHaveBeenCalled();

		const f3 = { identifier: 3, clientX: 180, clientY: 110 };
		dispatchTouch(el, 'touchstart', [f1, f2, f3], [f1, f2, f3]);
		dispatchTouch(el, 'touchend', [], [f1, f2, f3]);
		expect(onRedo).toHaveBeenCalledTimes(1);

		handle.destroy();
	});

	test('ignores 2-finger pan/pinch when finger movement exceeds threshold', () => {
		const el = document.createElement('div');
		const onUndo = jest.fn();
		const onRedo = jest.fn();
		const handle = attachTouchTapUndo(el, { onUndo, onRedo });

		const f1 = { identifier: 1, clientX: 100, clientY: 100 };
		const f2 = { identifier: 2, clientX: 140, clientY: 105 };
		dispatchTouch(el, 'touchstart', [f1, f2], [f1, f2]);
		const f1Moved = { identifier: 1, clientX: 100, clientY: 140 };
		dispatchTouch(el, 'touchmove', [f1Moved, f2], [f1Moved]);
		dispatchTouch(el, 'touchend', [], [f1Moved, f2]);
		expect(onUndo).not.toHaveBeenCalled();

		handle.destroy();
	});
});

describe('DuplicateStrokesCommand & RestyleStrokesCommand', () => {
	test('duplicates and restyles strokes with full undo/redo support', () => {
		const store = new StrokeStore();
		const undo = new UndoManager();
		const original = makeStroke('s1', '#111111');
		store.add(original);

		const clone: InkStroke = {
			...original,
			id: 's1_copy',
			offset: { x: 18, y: 18 },
		};
		undo.execute(new DuplicateStrokesCommand(store, [clone]));
		expect(store.getAll()).toHaveLength(2);
		expect(store.getById('s1_copy')?.offset).toEqual({ x: 18, y: 18 });

		undo.execute(new RestyleStrokesCommand(store, ['s1', 's1_copy'], { color: '#e03131' }));
		expect(store.getById('s1')?.style.color).toBe('#e03131');
		expect(store.getById('s1_copy')?.style.color).toBe('#e03131');

		undo.undo();
		expect(store.getById('s1')?.style.color).toBe('#111111');
		expect(store.getById('s1_copy')?.style.color).toBe('#111111');

		undo.undo();
		expect(store.getAll()).toHaveLength(1);

		undo.redo();
		expect(store.getAll()).toHaveLength(2);
	});

	test('buildSelectionStrokeContextMenuOptions includes Duplicate, Apply brush colour, and Delete', () => {
		const onDelete = jest.fn();
		const onDuplicate = jest.fn();
		const onColour = jest.fn();
		const items = buildSelectionStrokeContextMenuOptions(onDelete, {
			duplicateSelectedStrokes: onDuplicate,
			applyCurrentColourToSelection: onColour,
		});
		expect(items).toHaveLength(3);
		for (const item of items) { if ('action' in item) item.action(); }
		expect(onDuplicate).toHaveBeenCalledTimes(1);
		expect(onColour).toHaveBeenCalledTimes(1);
		expect(onDelete).toHaveBeenCalledTimes(1);
	});
});

describe('Magic Diary Page ("魔法书页 · 你写一句，AI写一句")', () => {
	test('detects magic diary frontmatter and builds initial note content', () => {
		const content = buildMagicDiaryNoteContent('霍格沃茨日记');
		expect(hasMagicDiaryFrontmatter(content)).toBe(true);
		expect(hasMagicDiaryFrontmatter('---\ntitle: normal\n---\nHello')).toBe(false);
	});

	test('parses structured HEARD / REPLY responses and plain text fallbacks', () => {
		const structured = parseMagicDiaryResponse('HEARD: 你好，日记本\nREPLY: 你好，执笔之人。今夜有何心事？');
		expect(structured.heard).toBe('你好，日记本');
		expect(structured.reply).toBe('你好，执笔之人。今夜有何心事？');

		const fallback = parseMagicDiaryResponse('纸页间浮现出一行微光。');
		expect(fallback.heard).toBe('');
		expect(fallback.reply).toBe('纸页间浮现出一行微光。');
	});

	test('returns enchanted offline hint when AI endpoint is not configured', async () => {
		const res = await requestMagicDiaryTurn({
			svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"></svg>',
			rawSettings: undefined,
			history: [],
		});
		expect(res.reply).toContain('✦');
	});
});

describe('PillStylePopover fingerDraws toggle & PdfInkOverlay selection mutations', () => {
	test('pill style popover toggles fingerDraws and updates active class', () => {
		const pill = document.createElement('div');
		let fingerDraws = false;
		const handle = createPillStylePopover({
			pill,
			showPaper: true,
			getState: () => ({
				brush: 'pen',
				colour: 'currentColor',
				size: 4,
				paper: 'ruled',
				fingerDraws,
			}),
			onChange: (patch) => {
				if (patch.fingerDraws !== undefined) fingerDraws = patch.fingerDraws;
			},
		});

		const toggleBtn = handle.popover.querySelector<HTMLButtonElement>('[data-md-ink-finger-draws="toggle"]');
		expect(toggleBtn).not.toBeNull();
		expect(toggleBtn!.classList.contains('is-active')).toBe(false);
		toggleBtn!.click();
		expect(fingerDraws).toBe(true);
		expect(toggleBtn!.classList.contains('is-active')).toBe(true);
		handle.destroy();
	});

	test('PdfInkOverlay supports recolourSelected, deleteSelected, and undo/redo', () => {
		const container = document.createElement('div');
		const page = document.createElement('div');
		page.className = 'page';
		page.dataset.pageNumber = '1';
		Object.defineProperty(page, 'getBoundingClientRect', {
			value: () => ({ left: 0, top: 0, width: 600, height: 800, right: 600, bottom: 800 }),
		});
		container.appendChild(page);

		const doc = createEmptyPdfInkDocument('test.pdf');
		doc.strokes.push({
			id: 'p1',
			page: 1,
			points: [
				[0.1, 0.1, 0.5],
				[0.3, 0.2, 0.5],
			],
			style: { ...DEFAULT_STROKE_STYLE, color: '#111111', size: 0.01 },
			createdAt: Date.now(),
		});

		const overlay = new PdfInkOverlay(
			{} as never,
			container,
			'test.pdf',
			{
				brush: 'pen',
				size: 4,
				colour: '#111111',
				mouseDrawing: true,
				fingerDraws: false,
				eraserRadius: 14,
				shapeSnap: true,
				tool: 'lasso',
			},
			doc,
		);

		// Select stroke p1 via internal set or lasso simulation
		(overlay as unknown as { selectedIds: Set<string> }).selectedIds.add('p1');
		expect(overlay.recolourSelected('#1971c2')).toBe(true);
		expect(overlay.getDocument().strokes[0].style.color).toBe('#1971c2');

		expect(overlay.undo()).toBe(true);
		expect(overlay.getDocument().strokes[0].style.color).toBe('#111111');
		expect(overlay.redo()).toBe(true);
		expect(overlay.getDocument().strokes[0].style.color).toBe('#1971c2');

		expect(overlay.deleteSelected()).toBe(true);
		expect(overlay.getDocument().strokes).toHaveLength(0);
		expect(overlay.undo()).toBe(true);
		expect(overlay.getDocument().strokes).toHaveLength(1);

		overlay.destroy();
	});

	test('MdInkOverlay expands blank note canvas, supports duplicate/recolour selection, and awakens Magic Diary Page', async () => {
		const dom = document.createElement('div');
		const scroller = document.createElement('div');
		const contentDOM = document.createElement('div');
		Object.defineProperty(scroller, 'clientWidth', { value: 720 });
		Object.defineProperty(scroller, 'clientHeight', { value: 640 });
		Object.defineProperty(contentDOM, 'scrollWidth', { value: 720 });
		Object.defineProperty(contentDOM, 'scrollHeight', { value: 28 }); // 1-line blank note
		Object.defineProperty(contentDOM, 'clientHeight', { value: 28 });
		scroller.appendChild(contentDOM);
		dom.appendChild(scroller);
		document.body.appendChild(dom);

		const docText = buildMagicDiaryNoteContent('Tom Riddle');
		const lines = docText.split('\n');
		const fakeView = {
			dom,
			contentDOM,
			documentTop: 0,
			state: {
				doc: {
					lines: lines.length,
					toString: () => docText,
					line: (n: number) => ({
						number: n,
						from: 0,
						text: lines[n - 1] ?? '',
					}),
					lineAt: () => ({ number: 1, from: 0, text: lines[0] ?? '' }),
				},
				selection: { main: { head: 0 } },
			},
			posAtCoords: () => 0,
			coordsAtPos: () => ({ top: 10 }),
			lineBlockAt: () => ({ top: 0 }),
			dispatch: jest.fn(),
		};

		const mdDoc = createEmptyMdInkDocument('magic.md');
		mdDoc.strokes.push({
			id: 'm1',
			points: [
				[40, 800, 0.5],
				[180, 820, 0.6],
			],
			style: { ...DEFAULT_STROKE_STYLE, color: '#111111' },
			anchor: { line: 1, lineText: '---' },
			offset: { x: 0, y: 0 },
			createdAt: Date.now(),
		});

		const overlay = new MdInkOverlay(
			fakeView as never,
			'magic.md',
			{
				brush: 'pen',
				size: 4,
				colour: '#111111',
				mouseDrawing: true,
				fingerDraws: false,
				paper: 'ruled',
				eraserRadius: 14,
				shapeSnap: true,
			},
			mdDoc,
		);

		// Auto-detected Magic Diary Page from frontmatter
		expect(overlay.isMagicDiaryMode()).toBe(true);

		// Blank note auto-expansion: stroke at y=820 expands layer height well beyond 28px!
		const layerEl = scroller.querySelector<HTMLElement>('.bimo-md-ink-layer');
		expect(layerEl).not.toBeNull();
		expect(parseInt(layerEl!.style.height, 10)).toBeGreaterThanOrEqual(820 + 360);

		// Select stroke m1, recolour and duplicate
		(overlay as unknown as { selectedIds: Set<string> }).selectedIds.add('m1');
		expect(overlay.recolourSelected('#e03131')).toBe(true);
		expect(overlay.getDocument().strokes[0].style.color).toBe('#e03131');

		expect(overlay.duplicateSelected()).toBe(true);
		expect(overlay.getDocument().strokes).toHaveLength(2);

		// Trigger Magic Diary Page turn manually and verify reply card materializes on page
		await overlay.triggerMagicDiaryTurn(true);
		const replyCard = scroller.querySelector('.bimo-magic-diary-reply');
		expect(replyCard).not.toBeNull();

		overlay.destroy();
		dom.remove();
	});

	test('preserves note paper style and restores previous paper on magic diary deactivation', () => {
		const dom = document.createElement('div');
		const scroller = document.createElement('div');
		scroller.className = 'cm-scroller';
		const content = document.createElement('div');
		content.className = 'cm-content';
		scroller.appendChild(content);
		dom.appendChild(scroller);
		document.body.appendChild(dom);

		const fakeView = {
			dom,
			scrollDOM: scroller,
			contentDOM: content,
			state: {
				doc: {
					lines: 1,
					toString: () => 'Normal note content',
					line: () => ({ number: 1, from: 0, text: 'Normal note content' }),
					lineAt: () => ({ number: 1, from: 0, text: 'Normal note content' }),
				},
				selection: { main: { head: 0 } },
			},
			posAtCoords: () => 0,
			coordsAtPos: () => ({ top: 0 }),
			lineBlockAt: () => ({ top: 0 }),
			dispatch: jest.fn(),
		};

		const mdDoc = createEmptyMdInkDocument('normal.md');
		mdDoc.paper = 'none';

		const overlay = new MdInkOverlay(
			fakeView as never,
			'normal.md',
			{
				brush: 'pen',
				size: 4,
				colour: '#111111',
				mouseDrawing: true,
				fingerDraws: false,
				paper: 'none',
				eraserRadius: 14,
				shapeSnap: true,
			},
			mdDoc,
		);

		expect(overlay.getDocument().paper).toBe('none');

		// Awakening magic diary switches paper to ruled for parchment feel
		overlay.setMagicDiaryMode(true);
		expect(overlay.isMagicDiaryMode()).toBe(true);
		expect(overlay.getDocument().paper).toBe('ruled');

		// Closing magic diary restores original paper ('none')
		overlay.setMagicDiaryMode(false);
		expect(overlay.isMagicDiaryMode()).toBe(false);
		expect(overlay.getDocument().paper).toBe('none');

		overlay.destroy();
		dom.remove();
	});

	test('dual eraser mode in MdInkOverlay: stroke mode removes whole stroke, pixel mode cuts stroke', () => {
		const dom = document.createElement('div');
		const scroller = document.createElement('div');
		scroller.className = 'cm-scroller';
		const content = document.createElement('div');
		content.className = 'cm-content';
		scroller.appendChild(content);
		dom.appendChild(scroller);
		document.body.appendChild(dom);

		const fakeView = {
			dom,
			scrollDOM: scroller,
			contentDOM: content,
			state: {
				doc: {
					lines: 1,
					toString: () => 'Test line',
					line: () => ({ number: 1, from: 0, text: 'Test line' }),
					lineAt: () => ({ number: 1, from: 0, text: 'Test line' }),
				},
				selection: { main: { head: 0 } },
			},
			posAtCoords: () => 0,
			coordsAtPos: () => ({ top: 0 }),
			lineBlockAt: () => ({ top: 0 }),
			dispatch: jest.fn(),
		};

		// 1. Test Object / Stroke Eraser Mode
		const docStroke = createEmptyMdInkDocument('stroke-mode.md');
		docStroke.strokes.push({
			id: 's1',
			points: [
				[10, 10, 0.5],
				[20, 20, 0.5],
				[30, 30, 0.5],
			],
			style: { ...DEFAULT_STROKE_STYLE, color: '#111111' },
			anchor: { line: 1, lineText: 'Test line' },
			offset: { x: 0, y: 0 },
			createdAt: Date.now(),
		});

		const overlayStroke = new MdInkOverlay(
			fakeView as never,
			'stroke-mode.md',
			{
				brush: 'pen',
				size: 4,
				colour: '#111111',
				mouseDrawing: true,
				fingerDraws: false,
				paper: 'none',
				eraserMode: 'stroke',
				eraserRadius: 10,
				shapeSnap: false,
			},
			docStroke,
		);

		// Erase at point (20, 20) in stroke mode -> deletes entire stroke s1
		(overlayStroke as unknown as { eraseAt: (x: number, y: number) => void }).eraseAt(20, 20);
		expect(overlayStroke.getDocument().strokes).toHaveLength(0);
		overlayStroke.undo();
		expect(overlayStroke.getDocument().strokes).toHaveLength(1);
		overlayStroke.destroy();

		// 2. Test Pixel / Partial Eraser Mode
		const docPixel = createEmptyMdInkDocument('pixel-mode.md');
		docPixel.strokes.push({
			id: 'p1',
			points: [
				[10, 10, 0.5],
				[12, 10, 0.5],
				[50, 50, 0.5], // hit point in middle
				[51, 50, 0.5], // hit point in middle
				[90, 90, 0.5],
				[92, 90, 0.5],
			],
			style: { ...DEFAULT_STROKE_STYLE, color: '#e03131' },
			anchor: { line: 1, lineText: 'Test line' },
			offset: { x: 0, y: 0 },
			createdAt: Date.now(),
		});

		const overlayPixel = new MdInkOverlay(
			fakeView as never,
			'pixel-mode.md',
			{
				brush: 'pen',
				size: 4,
				colour: '#e03131',
				mouseDrawing: true,
				fingerDraws: false,
				paper: 'none',
				eraserMode: 'pixel',
				eraserRadius: 8,
				shapeSnap: false,
			},
			docPixel,
		);

		// Erase at (50, 50) with radius 8 -> cuts out the middle points, leaving 2 sub-strokes!
		(overlayPixel as unknown as { eraseAt: (x: number, y: number) => void }).eraseAt(50, 50);
		const resultStrokes = overlayPixel.getDocument().strokes;
		expect(resultStrokes).toHaveLength(2);
		expect(resultStrokes[0].style.color).toBe('#e03131');
		expect(resultStrokes[1].style.color).toBe('#e03131');

		// Undo restores the single unbroken original stroke
		overlayPixel.undo();
		expect(overlayPixel.getDocument().strokes).toHaveLength(1);
		expect(overlayPixel.getDocument().strokes[0].id).toBe('p1');

		// Redo cuts it again
		overlayPixel.redo();
		expect(overlayPixel.getDocument().strokes).toHaveLength(2);

		overlayPixel.destroy();
		dom.remove();
	});

	test('renders paper efficiently via SVG pattern instead of repeated DOM lines', () => {
		const dom = document.createElement('div');
		const scroller = document.createElement('div');
		scroller.className = 'cm-scroller';
		const content = document.createElement('div');
		content.className = 'cm-content';
		scroller.appendChild(content);
		dom.appendChild(scroller);
		document.body.appendChild(dom);

		const fakeView = {
			dom,
			scrollDOM: scroller,
			contentDOM: content,
			state: {
				doc: {
					lines: 1,
					toString: () => 'Paper note',
					line: () => ({ number: 1, from: 0, text: 'Paper note' }),
					lineAt: () => ({ number: 1, from: 0, text: 'Paper note' }),
				},
				selection: { main: { head: 0 } },
			},
			posAtCoords: () => 0,
			coordsAtPos: () => ({ top: 0 }),
			lineBlockAt: () => ({ top: 0 }),
			dispatch: jest.fn(),
		};

		const overlay = new MdInkOverlay(
			fakeView as never,
			'paper.md',
			{
				brush: 'pen',
				size: 4,
				colour: '#111111',
				mouseDrawing: true,
				fingerDraws: false,
				paper: 'ruled',
				eraserRadius: 10,
				shapeSnap: false,
			},
			createEmptyMdInkDocument('paper.md'),
		);

		const svg = scroller.querySelector('svg.bimo-md-ink-svg');
		expect(svg).not.toBeNull();
		const defs = svg?.querySelector('defs');
		expect(defs).not.toBeNull();
		expect(defs?.querySelector('pattern[id*="ruled"]')).not.toBeNull();
		expect(defs?.querySelector('pattern[id*="grid"]')).not.toBeNull();
		expect(defs?.querySelector('pattern[id*="dots"]')).not.toBeNull();

		const paperGroup = svg?.querySelector('.bimo-md-ink-paper');
		const paperRect = paperGroup?.querySelector('rect');
		expect(paperRect).not.toBeNull();
		expect(paperRect?.getAttribute('fill')).toMatch(/url\(#bimo-paper-ruled/);

		overlay.destroy();
		dom.remove();
	});
});

describe('Magic Diary Presets & Prompt Customization', () => {
	test('defines rich preset styles for companion, explain, brainstorm, and solver', () => {
		expect(MAGIC_DIARY_PRESETS.chat).toBeDefined();
		expect(MAGIC_DIARY_PRESETS.explain).toBeDefined();
		expect(MAGIC_DIARY_PRESETS.brainstorm).toBeDefined();
		expect(MAGIC_DIARY_PRESETS.solver).toBeDefined();
		expect(MAGIC_DIARY_PRESETS.custom).toBeDefined();
	});

	test('resolveMagicDiarySystemPrompt applies preset or custom prompt with format envelope', () => {
		const chatPrompt = resolveMagicDiarySystemPrompt('chat');
		expect(chatPrompt).toContain('Tom Riddle');
		expect(chatPrompt).toContain('HEARD:');
		expect(chatPrompt).toContain('REPLY:');

		const explainPrompt = resolveMagicDiarySystemPrompt('explain');
		expect(explainPrompt).toContain('pedagogical scholar');

		const solverPrompt = resolveMagicDiarySystemPrompt('solver');
		expect(solverPrompt).toContain('academic tutor');

		const customPrompt = resolveMagicDiarySystemPrompt('custom', 'You are Sherlock Holmes inspecting notes.');
		expect(customPrompt).toContain('Sherlock Holmes');
		expect(customPrompt).toContain('HEARD:');
	});
});

describe('Embed SVG stroke color preservation', () => {
	test('marks custom coloured strokes with ink-color-custom to avoid theme overwrite', () => {
		const redStroke: InkStroke = {
			id: 'red_1',
			points: [[0, 0, 0.5], [10, 10, 0.5]],
			style: { ...DEFAULT_STROKE_STYLE, color: '#e03131' },
			offset: { x: 0, y: 0 },
		};
		const defaultStroke: InkStroke = {
			id: 'def_1',
			points: [[20, 20, 0.5], [30, 30, 0.5]],
			style: { ...DEFAULT_STROKE_STYLE, color: 'currentColor' },
			offset: { x: 0, y: 0 },
		};

		const snapshot = {
			formatVersion: 1,
			strokes: [redStroke, defaultStroke],
		};

		const svgMarkup = renderStrokesToSvg([redStroke, defaultStroke], snapshot as never);
		expect(svgMarkup).toContain('fill="#e03131"');
		expect(svgMarkup).toContain('ink-color-custom');
		expect(svgMarkup).toContain('ink-color-primary');
	});
});
