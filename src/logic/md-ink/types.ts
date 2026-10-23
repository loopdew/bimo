import type { InkPoint, InkStrokeStyle } from 'src/ink-canvas/types';

///////////////////////////
///////////////////////////

/**
 * Direct ink on a Markdown note.
 *
 * 笔墨's writing embeds put a canvas *inside* the document, which pushes the
 * prose around. This model is the other topology: strokes live in a layer
 * floating over the editor, and the note file keeps zero bytes of ink.
 */

/** Tools available in the note overlay. Mirrors Handwriting's pill. */
export type MdInkTool = 'pen' | 'highlighter' | 'eraser' | 'lasso' | 'pan';

/** Paper texture drawn under the ink. */
export type MdInkPaper = 'none' | 'ruled' | 'grid' | 'dots';

/**
 * Where a stroke belongs in the document.
 *
 * A page-absolute `y` would drift every time a paragraph is inserted above the
 * ink. Anchoring to the line under the first point makes the stroke ride along
 * with its text; `lineText` is the fingerprint used to recover the line after
 * the number shifts.
 */
export interface MdInkAnchor {
	/** 1-based document line containing the stroke's first point. */
	line: number;
	/** The line's text when the stroke was drawn, truncated. Used for re-matching. */
	lineText: string;
}

/**
 * A stroke on a note.
 *
 * `points` are local to the anchor line's top-left corner, in CSS px at zoom 1,
 * so the same data survives font-size changes and window resizes better than
 * absolute document coordinates would.
 */
export interface MdInkStroke {
	id: string;
	points: InkPoint[];
	style: InkStrokeStyle;
	anchor: MdInkAnchor;
	/** Translation applied by the lasso tool, in local coordinates. */
	offset: { x: number; y: number };
	/** Epoch ms, for undo grouping and diagnostics. */
	createdAt: number;
}

/** One note's ink, persisted as JSON next to the vault's other plugin data. */
export interface MdInkDocument {
	/** Format discriminator. */
	version: 1;
	/** Vault-relative path of the note this ink belongs to. */
	notePath: string;
	paper: MdInkPaper;
	strokes: MdInkStroke[];
	/** Epoch ms of the last write, for conflict detection and sorting pickers. */
	updatedAt: number;
}

export function createEmptyMdInkDocument(notePath: string): MdInkDocument {
	return {
		version: 1,
		notePath,
		paper: 'none',
		strokes: [],
		updatedAt: Date.now(),
	};
}

/** Fold a line's text to a comparable fingerprint. */
export function fingerprintLine(lineText: string): string {
	return lineText.trim().slice(0, 120);
}

/**
 * Which paper a note should render with.
 *
 * The document is the authority — `setPaper` writes to it — but a document with
 * no ink and no paper choice is indistinguishable from one the user never
 * touched, and pinning those to `none` would silently disable the configured
 * default on every fresh note.
 */
export function resolvePaperStyle(
	doc: Pick<MdInkDocument, 'paper' | 'strokes'>,
	fallback: MdInkPaper,
): MdInkPaper {
	if (doc.strokes.length === 0 && doc.paper === 'none') return fallback;
	return doc.paper;
}

/**
 * Resolve the line a stroke belongs to now.
 *
 * The stored number is trusted while the text at that line still matches. Once
 * someone inserts a paragraph above, the text has moved, so we search the
 * nearest matching line instead of leaving the ink behind. Returns `null` when
 * the source line was edited away — the caller then keeps the original number
 * rather than silently teleporting the stroke to an unrelated paragraph.
 */
export function resolveAnchorLine(
	docLines: string[],
	anchor: MdInkAnchor,
): number | null {
	const wanted = fingerprintLine(anchor.lineText);
	const index = anchor.line - 1;

	if (index >= 0 && index < docLines.length) {
		if (fingerprintLine(docLines[index] ?? '') === wanted) return index;
	}

	if (!wanted) {
		return index >= 0 && index < docLines.length ? index : null;
	}

	// Nearest match wins: a note often repeats short lines ("", "-"), and the
	// closest one is almost always the original.
	let bestIndex: number | null = null;
	let bestDistance = Infinity;
	for (let i = 0; i < docLines.length; i++) {
		if (fingerprintLine(docLines[i] ?? '') !== wanted) continue;
		const distance = Math.abs(i - index);
		if (distance < bestDistance) {
			bestDistance = distance;
			bestIndex = i;
		}
	}
	return bestIndex;
}

///////////////////////////
// Single-point strokes
///////////////////////////

/**
 * A filled circle as an SVG path.
 *
 * perfect-freehand returns an empty outline for a one-point stroke, so a tap
 * with the pen would save a stroke that renders as nothing — invisible ink that
 * still counts in the file. Drawing the nib's own radius keeps the dot the user
 * meant to make.
 */
export function dotPath(x: number, y: number, radius: number): string {
	const r = Math.max(radius, 0.6);
	return `M ${x - r} ${y} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0`;
}

///////////////////////////
// Shape snapping
///////////////////////////

/** Distance from a point to the infinite line through `a` and `b`. */
function perpendicularDistance(
	px: number, py: number,
	ax: number, ay: number,
	bx: number, by: number,
): number {
	const dx = bx - ax;
	const dy = by - ay;
	const length = Math.hypot(dx, dy);
	if (length === 0) return Math.hypot(px - ax, py - ay);
	return Math.abs((px - ax) * dy - (py - ay) * dx) / length;
}

/**
 * Straighten a stroke that was meant to be a line.
 *
 * Drawn underlines, dividers and connection lines are never perfectly straight
 * by hand, and a 2px wobble is the difference between "hand-drawn" and "sloppy".
 * The rule is distance-based, not angle-based: every captured point must sit
 * within `tolerance` of the chord, and the chord must be long enough that the
 * snap is worth doing at all.
 */
export function snapToStraightLine(points: InkPoint[], tolerance: number): InkPoint[] | null {
	if (points.length < 3) return null;
	const first = points[0];
	const last = points[points.length - 1];
	const length = Math.hypot(last[0] - first[0], last[1] - first[1]);
	if (length < 24) return null;

	for (const [x, y] of points) {
		if (perpendicularDistance(x, y, first[0], first[1], last[0], last[1]) > tolerance) {
			return null;
		}
	}

	// One pressure for both ends: a snapped line has uniform weight, and keeping
	// the start's original value would make a tapered stroke look like it just
	// stops halfway.
	const pressure = (first[2] + last[2]) / 2;
	return [[first[0], first[1], pressure], [last[0], last[1], pressure]];
}

/**
 * Straighten a closed loop into a rectangle.
 *
 * Boxes around a paragraph, or a frame around a diagram, are the second thing
 * people draw and the second thing that never comes out square. A stroke counts
 * as a box when its ends meet and every point lies near one of the four edges of
 * its own bounding box.
 */
export function snapToRectangle(points: InkPoint[], tolerance: number): InkPoint[] | null {
	if (points.length < 5) return null;

	const first = points[0];
	const last = points[points.length - 1];
	const closed = Math.hypot(last[0] - first[0], last[1] - first[1]) <= tolerance * 3;
	if (!closed) return null;

	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const [x, y] of points) {
		if (x < minX) minX = x;
		if (y < minY) minY = y;
		if (x > maxX) maxX = x;
		if (y > maxY) maxY = y;
	}

	// A sliver is not a rectangle, and snapping it would look like a glitch.
	if (maxX - minX < 24 || maxY - minY < 24) return null;

	for (const [x, y] of points) {
		const nearVerticalEdge = Math.min(Math.abs(x - minX), Math.abs(x - maxX)) <= tolerance;
		const nearHorizontalEdge = Math.min(Math.abs(y - minY), Math.abs(y - maxY)) <= tolerance;
		if (!nearVerticalEdge && !nearHorizontalEdge) return null;
	}

	const pressure = first[2];
	return [
		[minX, minY, pressure],
		[maxX, minY, pressure],
		[maxX, maxY, pressure],
		[minX, maxY, pressure],
		[minX, minY, pressure],
	];
}

/**
 * Straighten a closed loop into an ellipse (or circle when nearly equilateral).
 *
 * Circling a word on a note or a formula on a PDF is one of the most common
 * annotation gestures. A loop counts as an ellipse when its ends meet, its
 * bounding box is large enough not to be a handwritten letter ('o', 'e'), it
 * winds roughly one full turn around its centre, and every point sits near the
 * inscribed ellipse of its bounding box.
 */
export function snapToEllipse(points: InkPoint[], tolerance: number): InkPoint[] | null {
	if (points.length < 8) return null;

	const first = points[0];
	const last = points[points.length - 1];
	if (Math.hypot(last[0] - first[0], last[1] - first[1]) > tolerance * 3.5) {
		return null;
	}

	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const [x, y] of points) {
		if (x < minX) minX = x;
		if (y < minY) minY = y;
		if (x > maxX) maxX = x;
		if (y > maxY) maxY = y;
	}

	const width = maxX - minX;
	const height = maxY - minY;
	if (width < 28 || height < 20) return null;

	const cx = (minX + maxX) / 2;
	const cy = (minY + maxY) / 2;
	let rx = width / 2;
	let ry = height / 2;
	const minRadius = Math.min(rx, ry);

	let totalAngle = 0;
	let prevAngle = Math.atan2(points[0][1] - cy, points[0][0] - cx);

	for (let i = 0; i < points.length; i++) {
		const [x, y] = points[i];
		const norm = Math.hypot((x - cx) / rx, (y - cy) / ry);
		const radialError = Math.abs(norm - 1) * minRadius;
		if (radialError > tolerance * 1.5) return null;

		if (i > 0) {
			const angle = Math.atan2(y - cy, x - cx);
			let delta = angle - prevAngle;
			while (delta > Math.PI) delta -= Math.PI * 2;
			while (delta < -Math.PI) delta += Math.PI * 2;
			totalAngle += delta;
			prevAngle = angle;
		}
	}

	// Must wind roughly one full revolution (at least ~270° and at most ~470°).
	const absSweep = Math.abs(totalAngle);
	if (absSweep < Math.PI * 1.5 || absSweep > Math.PI * 2.65) return null;

	// Snap nearly-equal axes to a true circle.
	if (Math.abs(rx - ry) / Math.max(rx, ry) < 0.12) {
		const r = (rx + ry) / 2;
		rx = r;
		ry = r;
	}

	const startAngle = Math.atan2(first[1] - cy, first[0] - cx);
	const sign = totalAngle >= 0 ? 1 : -1;
	const steps = 36;
	const pressure = first[2];
	const snapped: InkPoint[] = [];
	for (let i = 0; i <= steps; i++) {
		const theta = startAngle + sign * ((i / steps) * Math.PI * 2);
		snapped.push([
			cx + Math.cos(theta) * rx,
			cy + Math.sin(theta) * ry,
			pressure,
		]);
	}
	return snapped;
}

/** Dwell time (ms) before an in-progress stroke snaps to a geometric shape while the pen tip is held still. */
export const HOLD_TO_SNAP_DELAY_MS = 420;
/** Tolerance (px) used when the user deliberately pauses the pen tip to trigger hold-to-snap. */
export const HOLD_TO_SNAP_TOLERANCE = 14;

/**
 * Apply whatever snap fits, in order of specificity.
 *
 * Rectangle and ellipse first: a closed loop is also made of straight-ish runs,
 * so the line test would otherwise win and turn a frame into a single diagonal.
 */
export function snapStrokePoints(points: InkPoint[], tolerance: number): InkPoint[] {
	if (points.length < 3) return points;
	return snapToRectangle(points, tolerance)
		?? snapToEllipse(points, tolerance)
		?? snapToStraightLine(points, tolerance)
		?? points;
}

/**
 * Combine a freshly loaded document with strokes that already exist in memory.
 *
 * The disk read is asynchronous. A stroke drawn while it is in flight must
 * survive, and — the dangerous half — an empty in-memory document must never
 * be allowed to replace a non-empty one on disk. Local strokes win on id
 * collisions because they are the ones the user can still see.
 */
export function mergeMdInkDocuments(local: MdInkDocument, fromDisk: MdInkDocument): MdInkDocument {
	if (local.strokes.length === 0) return fromDisk;
	const localIds = new Set(local.strokes.map((stroke) => stroke.id));
	return {
		...fromDisk,
		strokes: [...fromDisk.strokes.filter((stroke) => !localIds.has(stroke.id)), ...local.strokes],
	};
}
