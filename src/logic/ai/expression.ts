///////////////////////////
///////////////////////////

/**
 * Turns a user's "plot this" request into an SVG chart.
 *
 * Security posture: the model (or the user) supplies a *math expression*, never
 * code. The expression is checked against a strict identifier whitelist before it
 * is evaluated once per sample, and evaluation happens inside our own loop — the
 * checked string can never contain a statement, loop, or call to anything outside
 * `Math`. This is why an LLM cannot smuggle a `while(true)` in here.
 */

/** Everything an expression may reference besides `x`. */
const ALLOWED_IDENTIFIERS: ReadonlySet<string> = new Set([
	'x',
	'Math',
	'PI',
	'E',
	'abs',
	'sign',
	'sqrt',
	'cbrt',
	'exp',
	'log',
	'log2',
	'log10',
	'pow',
	'sin',
	'cos',
	'tan',
	'asin',
	'acos',
	'atan',
	'atan2',
	'sinh',
	'cosh',
	'tanh',
	'floor',
	'ceil',
	'round',
	'trunc',
	'min',
	'max',
	'hypot',
]);

/** Any of these makes the input code rather than math. */
const FORBIDDEN_PATTERNS = /[;{}]|=>|\b(while|for|if|else|function|return|new|class|import|require|eval|window|document|globalThis|process|fetch)\b/i;

const IDENTIFIER_PATTERN = /[A-Za-z_][A-Za-z0-9_]*/g;

export interface SanitizedExpression {
	ok: true;
	/** Normalised expression, safe to hand to `new Function`. */
	expression: string;
}

export interface RejectedExpression {
	ok: false;
	reason: string;
}

/**
 * Validates a math expression for `y = f(x)`.
 *
 * Accepts both `sin(x)/x` and `Math.sin(x)/x`; the bare form is rewritten to
 * `Math.<fn>(` so a model that omits the namespace still works.
 */
export function sanitizeExpression(raw: string): SanitizedExpression | RejectedExpression {
	const trimmed = (raw ?? '').trim();
	if (!trimmed) return { ok: false, reason: 'Expression is empty' };
	if (trimmed.length > 400) return { ok: false, reason: 'Expression is too long' };
	if (FORBIDDEN_PATTERNS.test(trimmed)) {
		return { ok: false, reason: 'Expression contains code, not math' };
	}
	// A model that answers "抱歉，我无法处理这个请求。" would otherwise sail through:
	// Chinese characters are not identifiers, so the whitelist never fires.
	// Expressions are ASCII by definition; anything else is prose, not math.
	// eslint-disable-next-line no-control-regex
	if (/[^\x20-\x7E]/.test(trimmed)) {
		return { ok: false, reason: 'Expression contains non-ASCII characters' };
	}

	// Drop a leading `y =` / `f(x) =` that models like to add.
	const withoutPrefix = trimmed
		.replace(/^\s*(y|f\s*\(\s*x\s*\))\s*=\s*/i, '')
		.trim();
	if (!withoutPrefix) return { ok: false, reason: 'Expression has no right-hand side' };

	// `^` is never exponentiation in JS; models still emit it for powers.
	const withPow = withoutPrefix.replace(/\^/g, '**');

	const identifiers = withPow.match(IDENTIFIER_PATTERN) ?? [];
	for (const identifier of identifiers) {
		if (ALLOWED_IDENTIFIERS.has(identifier)) continue;
		return { ok: false, reason: `Unsupported name "${identifier}"` };
	}

	// Namespace every bare math call: `sin(` → `Math.sin(`, but never touch a
	// call that already carries a namespace (`Math.cos(` must not become
	// `Math.Math.cos(`).
	const namespaced = withPow.replace(
		/(?<![\w.])(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|sqrt|cbrt|exp|log2|log10|log|pow|abs|sign|floor|ceil|round|trunc|min|max|hypot)\s*\(/g,
		'Math.$1(',
	);

	// Compile once here so `sampleFigure` never has to deal with a syntax error.
	// `new Function` only parses at this point — the body is not executed.
	try {
		// eslint-disable-next-line no-new-func
		new Function('x', `"use strict"; return (${namespaced});`);
	} catch {
		return { ok: false, reason: 'Expression is not valid math syntax' };
	}

	return { ok: true, expression: namespaced };
}

export interface FigureSample {
	x: number;
	y: number;
}

export interface FigureData {
	/** Sampling interval actually used. */
	domain: [number, number];
	/** Finite samples only; discontinuities split into separate segments. */
	segments: FigureSample[][];
	samples: FigureSample[];
	yMin: number;
	yMax: number;
}

export interface SampleFigureOptions {
	domain?: [number, number];
	/** Number of x samples across the domain. 400 is plenty for a 800px-wide plot. */
	count?: number;
}

/**
 * Evaluates the expression across the domain.
 *
 * Values that are NaN/Infinity, or absurdly far outside the visible range, break
 * the line — otherwise a single pole at x=0 would drag the whole plot to y=1e9
 * and flatten everything else into a straight line at the axis.
 */
export function sampleFigure(
	expression: string,
	options: SampleFigureOptions = {},
): FigureData {
	const domain = options.domain ?? [-10, 10];
	const count = Math.max(2, Math.floor(options.count ?? 400));

	// Validated upstream by sanitizeExpression; this is the single evaluation site.
	// eslint-disable-next-line no-new-func
	const fn = new Function('x', `"use strict"; return (${expression});`) as (x: number) => unknown;

	const [x0, x1] = domain[0] <= domain[1] ? domain : [domain[1], domain[0]];
	const step = (x1 - x0) / (count - 1);

	const raw: Array<{ x: number; y: number } | null> = [];
	for (let index = 0; index < count; index += 1) {
		const x = x0 + step * index;
		let y: unknown;
		try {
			y = fn(x);
		} catch {
			y = NaN;
		}
		const numeric = typeof y === 'number' ? y : Number.NaN;
		raw.push(Number.isFinite(numeric) ? { x, y: numeric } : null);
	}

	const finite = raw.filter((point): point is FigureSample => point !== null);
	if (finite.length === 0) {
		return { domain: [x0, x1], segments: [], samples: [], yMin: 0, yMax: 1 };
	}

	// Robust visible range: 2nd–98th percentile of y, widened by its own span.
	// A pole at x=0 pushes only a handful of samples past that band, so the curve
	// still gets a sane scale instead of collapsing to a flat line at the axis.
	const sortedY = finite.map((point) => point.y).sort((a, b) => a - b);
	const quantile = (fraction: number): number => {
		const index = Math.min(sortedY.length - 1, Math.max(0, Math.floor(fraction * (sortedY.length - 1))));
		return sortedY[index];
	};
	const lowQuantile = quantile(0.02);
	const highQuantile = quantile(0.98);
	const quantileSpan = highQuantile - lowQuantile;
	const margin = quantileSpan > 0 ? quantileSpan * 1.5 : Math.max(Math.abs(lowQuantile), 1);
	const lowerBound = lowQuantile - margin;
	const upperBound = highQuantile + margin;

	const isInside = (point: FigureSample | null): point is FigureSample =>
		point !== null && point.y >= lowerBound && point.y <= upperBound;

	const keep = finite.filter(isInside);
	const accepted = keep.length >= 2 ? keep : finite;
	const keepSet = new Set(accepted);

	const segments: FigureSample[][] = [];
	let current: FigureSample[] = [];
	for (const point of raw) {
		if (point && keepSet.has(point)) {
			current.push(point);
		} else if (current.length > 0) {
			segments.push(current);
			current = [];
		}
	}
	if (current.length > 0) segments.push(current);

	let yMin = Infinity;
	let yMax = -Infinity;
	for (const point of accepted) {
		if (point.y < yMin) yMin = point.y;
		if (point.y > yMax) yMax = point.y;
	}
	if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
		yMin = 0;
		yMax = 1;
	}

	return {
		domain: [x0, x1],
		segments,
		samples: keep,
		yMin,
		yMax,
	};
}

function formatNumber(value: number): string {
	if (Math.abs(value) >= 1e5 || (Math.abs(value) < 1e-3 && value !== 0)) {
		return value.toExponential(2);
	}
	return String(Math.round(value * 1000) / 1000);
}

export interface BuildFigureSvgOptions {
	title?: string;
	width?: number;
	height?: number;
	/** Draw a light grid + axes. Defaults to true. */
	showAxes?: boolean;
	/** Stroke colour of the curve. */
	inkColour?: string;
}

/**
 * Renders sampled points to a standalone SVG.
 *
 * Colours are baked (no CSS variables) because this file is opened outside
 * Obsidian: in a browser, a PDF, or an image viewer.
 */
export function buildFigureSvg(
	data: FigureData,
	options: BuildFigureSvgOptions = {},
): string {
	const width = options.width ?? 720;
	const height = options.height ?? 420;
	const padding = 36;
	const showAxes = options.showAxes ?? true;
	const inkColour = options.inkColour ?? '#2f6fed';
	const axisColour = '#9aa0a6';
	const gridColour = '#e6e8eb';
	const textColour = '#5f6368';

	const [x0, x1] = data.domain;
	const spanX = x1 - x0 || 1;

	// Always keep y=0 in frame so the reader can see where the curve crosses it.
	let yMin = Math.min(0, data.yMin);
	let yMax = Math.max(0, data.yMax);
	if (yMax - yMin < 1e-9) {
		yMin -= 1;
		yMax += 1;
	}
	const padY = (yMax - yMin) * 0.08;
	yMin -= padY;
	yMax += padY;
	const spanY = yMax - yMin || 1;

	const plotWidth = width - padding * 2;
	const plotHeight = height - padding * 2;
	const toX = (x: number) => padding + ((x - x0) / spanX) * plotWidth;
	const toY = (y: number) => padding + (1 - (y - yMin) / spanY) * plotHeight;

	const parts: string[] = [];
	parts.push(
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
	);
	parts.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);

	if (showAxes) {
		const gridSteps = 8;
		for (let index = 0; index <= gridSteps; index += 1) {
			const gridX = padding + (plotWidth * index) / gridSteps;
			parts.push(
				`<line x1="${gridX.toFixed(2)}" y1="${padding}" x2="${gridX.toFixed(2)}" y2="${padding + plotHeight}" stroke="${gridColour}" stroke-width="1"/>`,
			);
			const gridY = padding + (plotHeight * index) / gridSteps;
			parts.push(
				`<line x1="${padding}" y1="${gridY.toFixed(2)}" x2="${padding + plotWidth}" y2="${gridY.toFixed(2)}" stroke="${gridColour}" stroke-width="1"/>`,
			);
		}

		const axisY = toY(0);
		const axisX = toX(0);
		if (axisY >= padding && axisY <= padding + plotHeight) {
			parts.push(
				`<line x1="${padding}" y1="${axisY.toFixed(2)}" x2="${padding + plotWidth}" y2="${axisY.toFixed(2)}" stroke="${axisColour}" stroke-width="1.5"/>`,
			);
		}
		if (axisX >= padding && axisX <= padding + plotWidth) {
			parts.push(
				`<line x1="${axisX.toFixed(2)}" y1="${padding}" x2="${axisX.toFixed(2)}" y2="${padding + plotHeight}" stroke="${axisColour}" stroke-width="1.5"/>`,
			);
		}

		// Tick labels only at the domain ends and the origin: enough orientation
		// without a cluttered axis renderer.
		const labels: Array<{ x: number; y: number; text: string }> = [
			{ x: toX(x0), y: padding + plotHeight + 20, text: formatNumber(x0) },
			{ x: toX(x1), y: padding + plotHeight + 20, text: formatNumber(x1) },
		];
		if (axisX >= padding && axisX <= padding + plotWidth) {
			labels.push({ x: axisX, y: padding + plotHeight + 20, text: '0' });
		}
		labels.push({ x: padding - 6, y: toY(data.yMax), text: formatNumber(data.yMax) });
		labels.push({ x: padding - 6, y: toY(data.yMin), text: formatNumber(data.yMin) });
		for (const label of labels) {
			parts.push(
				`<text x="${label.x.toFixed(1)}" y="${label.y.toFixed(1)}" font-family="system-ui, sans-serif" font-size="11" fill="${textColour}" text-anchor="middle">${label.text}</text>`,
			);
		}
	}

	for (const segment of data.segments) {
		if (segment.length < 2) continue;
		const path = segment
			.map((point, index) => `${index === 0 ? 'M' : 'L'}${toX(point.x).toFixed(2)},${toY(point.y).toFixed(2)}`)
			.join(' ');
		parts.push(
			`<path d="${path}" fill="none" stroke="${inkColour}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
		);
	}

	if (options.title) {
		parts.push(
			`<text x="${padding}" y="${padding - 12}" font-family="system-ui, sans-serif" font-size="14" fill="#202124">${escapeXml(options.title)}</text>`,
		);
	}

	parts.push('</svg>');
	return parts.join('\n');
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}
