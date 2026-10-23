import type { InkStroke } from 'src/ink-canvas/types';

//////////
//////////

/**
 * Minimal Excalidraw scene shape for a single freedraw element per ink stroke.
 *
 * Only the fields Excalidraw actually reads on load are emitted. Everything else
 * it fills in itself when the scene is opened and saved again. Keeping the file
 * small makes the diff readable if someone versions the exported file.
 */
interface ExcalidrawFreedrawElement {
	type: 'freedraw';
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
	angle: number;
	strokeColor: string;
	backgroundColor: 'transparent';
	fillStyle: 'solid';
	strokeWidth: number;
	strokeStyle: 'solid';
	roughness: 0;
	opacity: number;
	groupIds: string[];
	frameId: null;
	roundness: null;
	seed: number;
	version: 1;
	versionNonce: number;
	isDeleted: false;
	boundElements: null;
	updated: number;
	link: null;
	locked: false;
	points: [number, number][];
	pressures: number[];
	simulatePressure: boolean;
	lastCommittedPoint: null;
}

interface ExcalidrawScene {
	type: 'excalidraw';
	version: 2;
	source: string;
	elements: ExcalidrawFreedrawElement[];
	appState: {
		gridSize: null;
		viewBackgroundColor: string;
	};
	files: Record<string, never>;
}

/**
 * Excalidraw's default ink. `currentColor` has no meaning inside a standalone
 * `.excalidraw` file, so theme ink bakes to the neutral dark Excalidraw itself uses.
 */
const EXCALIDRAW_INK = '#1e1e1e';

/** Deterministic-enough seed: Excalidraw uses it for hand-drawn jitter. */
function seedForStroke(stroke: InkStroke, index: number): number {
	let hash = 2166136261;
	for (let i = 0; i < stroke.id.length; i += 1) {
		hash ^= stroke.id.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return Math.abs(hash + index) % 2 ** 31;
}

function round2(value: number): number {
	return Math.round(value * 100) / 100;
}

function toExcalidrawElement(
	stroke: InkStroke,
	index: number,
): ExcalidrawFreedrawElement | null {
	if (stroke.points.length === 0) return null;

	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const [x, y] of stroke.points) {
		if (x < minX) minX = x;
		if (y < minY) minY = y;
		if (x > maxX) maxX = x;
		if (y > maxY) maxY = y;
	}

	const originX = minX + stroke.offset.x;
	const originY = minY + stroke.offset.y;
	const points: [number, number][] = stroke.points.map(([x, y]) => [
		round2(x - minX),
		round2(y - minY),
	]);
	const pressures = stroke.points.map(([, , pressure]) =>
		Number.isFinite(pressure) ? round2(pressure) : 0.5,
	);

	const opacity = typeof stroke.style.opacity === 'number'
		? Math.round(Math.max(0, Math.min(1, stroke.style.opacity)) * 100)
		: 100;

	const colour = stroke.style.color && stroke.style.color !== 'currentColor'
		? stroke.style.color
		: EXCALIDRAW_INK;

	const seed = seedForStroke(stroke, index);

	return {
		type: 'freedraw',
		id: stroke.id,
		x: round2(originX),
		y: round2(originY),
		width: round2(maxX - minX),
		height: round2(maxY - minY),
		angle: 0,
		strokeColor: colour,
		backgroundColor: 'transparent',
		fillStyle: 'solid',
		strokeWidth: Math.max(1, Math.round(stroke.style.size)),
		strokeStyle: 'solid',
		roughness: 0,
		opacity,
		groupIds: [],
		frameId: null,
		roundness: null,
		seed,
		version: 1,
		versionNonce: seed,
		isDeleted: false,
		boundElements: null,
		updated: 0,
		link: null,
		locked: false,
		points,
		pressures,
		// The stored points already carry real pressure for a pen and simulated
		// pressure for a mouse; letting Excalidraw re-simulate would double it.
		simulatePressure: false,
		lastCommittedPoint: null,
	};
}

/**
 * Converts ink strokes into a `.excalidraw` scene JSON string.
 *
 * This is a pure geometry mapping — no transcription or model involved — so a
 * diagram drawn in 笔墨 opens in the Excalidraw plugin as real, editable freedraw
 * elements rather than a flattened image.
 */
export function buildExcalidrawScene(
	strokes: InkStroke[],
	source = 'bimo',
): string {
	const elements: ExcalidrawFreedrawElement[] = [];
	for (let index = 0; index < strokes.length; index += 1) {
		const element = toExcalidrawElement(strokes[index], index);
		if (element) elements.push(element);
	}

	const scene: ExcalidrawScene = {
		type: 'excalidraw',
		version: 2,
		source,
		elements,
		appState: {
			gridSize: null,
			viewBackgroundColor: '#ffffff',
		},
		files: {},
	};

	return JSON.stringify(scene, null, 2);
}
