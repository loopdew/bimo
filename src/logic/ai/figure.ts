import type { CustomTranscriptionProviderSettings } from 'src/logic/transcription-providers';
import { requestAiCompletion } from './client';
import { sanitizeExpression } from './expression';

//////////
//////////

/**
 * Plot-planning rules.
 *
 * The model is deliberately NOT asked for SVG, points, or code. It returns a
 * single expression plus a domain, and our own sampler draws the curve. That
 * keeps precision exact, makes an injected `while(true)` impossible, and means a
 * bad model answer degrades to "wrong function" rather than "broken image".
 */
export const FIGURE_SYSTEM_PROMPT = [
	'你把用户的要求翻译成一条可计算的单变量数学表达式。',
	'',
	'只输出一个 JSON 对象，不要任何解释、不要 Markdown 代码块：',
	'{"expr": "...", "domain": [最小x, 最大x], "title": "..."}',
	'',
	'规则：',
	'1. expr 必须只含变量 x、数字、运算符 + - * / ** 和 Math 函数（sin, cos, tan, exp, log, sqrt, abs, pow, min, max）。',
	'2. 不要写 y =，不要写等号，只写右边。',
	'3. domain 用两个数字，通常 [-10, 10]；函数有明显周期或渐近线时选合适的范围。',
	'4. title 是可选的简短中文说明，例如「y = sin(x)/x」。',
	'5. 如果要求与函数图像无关，expr 写成 "x" 并把 title 写成「无法解析为函数」。',
].join('\n');

export interface FigureSpec {
	/** Validated expression, ready for `sampleFigure`. */
	expression: string;
	domain: [number, number];
	title?: string;
}

/** Strips a ```json fence and any prose the model wrapped around the object. */
function extractJsonObject(raw: string): unknown | null {
	let text = (raw ?? '').trim();
	if (!text) return null;

	const fenceMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
	if (fenceMatch) text = fenceMatch[1].trim();

	const firstBrace = text.indexOf('{');
	const lastBrace = text.lastIndexOf('}');
	if (firstBrace === -1 || lastBrace <= firstBrace) return null;

	try {
		return JSON.parse(text.slice(firstBrace, lastBrace + 1));
	} catch {
		return null;
	}
}

function normaliseDomain(value: unknown): [number, number] | null {
	if (!Array.isArray(value) || value.length < 2) return null;
	const first = typeof value[0] === 'number' ? value[0] : Number.parseFloat(String(value[0]));
	const second = typeof value[1] === 'number' ? value[1] : Number.parseFloat(String(value[1]));
	if (!Number.isFinite(first) || !Number.isFinite(second)) return null;
	const low = Math.min(first, second);
	const high = Math.max(first, second);
	const span = high - low;
	if (!(span > 0) || span > 1e6) return null;
	return [low, high];
}

/**
 * Turns a model answer into a usable plot plan.
 *
 * Accepts three shapes, in order of preference:
 * 1. the requested JSON object;
 * 2. a bare expression, because some models answer with just `sin(x)/x`;
 * 3. anything parseable as an expression inside prose.
 *
 * Returns `null` when nothing usable survives validation.
 */
export function parseFigureSpec(raw: string): FigureSpec | null {
	const parsed = extractJsonObject(raw);
	if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
		const record = parsed as Record<string, unknown>;
		const expressionSource = typeof record.expr === 'string'
			? record.expr
			: typeof record.expression === 'string'
				? record.expression
				: null;
		if (expressionSource) {
			const sanitized = sanitizeExpression(expressionSource);
			if (sanitized.ok) {
				const domain = normaliseDomain(record.domain) ?? [-10, 10];
				const title = typeof record.title === 'string' && record.title.trim()
					? record.title.trim().slice(0, 80)
					: undefined;
				return { expression: sanitized.expression, domain, title };
			}
		}
	}

	// Fallback: treat the whole answer as an expression (single-line only).
	const firstLine = (raw ?? '').split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0) ?? '';
	const sanitized = sanitizeExpression(firstLine);
	if (sanitized.ok) {
		return { expression: sanitized.expression, domain: [-10, 10] };
	}
	return null;
}

/**
 * Parses a direct mathematical expression entered by the user (e.g.
 * `y = sin(x)/x, -10 to 10`, `f(x) = x^2 - 4 [-5, 5]`, or `cos(x)`) without
 * requiring an AI round-trip. Returns `null` when the input is natural language.
 */
export function parseDirectFigureSpec(raw: string): FigureSpec | null {
	const text = (raw ?? '').trim();
	if (!text || /[\r\n]/.test(text)) return null;

	let exprCandidate = text;
	let domain: [number, number] = [-10, 10];

	const rangeSuffix = /^(.*?)(?:,\s*|\s+in\s+|\s+on\s+)\[?\s*(-?\d+(?:\.\d+)?)\s*(?:to|\.\.|~|,|到)\s*(-?\d+(?:\.\d+)?)\s*\]?\s*$/i.exec(exprCandidate)
		?? /^(.*?)\s*\[\s*(-?\d+(?:\.\d+)?)\s*(?:to|\.\.|~|,|到)\s*(-?\d+(?:\.\d+)?)\s*\]\s*$/i.exec(exprCandidate);

	if (rangeSuffix) {
		const parsedDomain = normaliseDomain([rangeSuffix[2], rangeSuffix[3]]);
		if (!parsedDomain) return null;
		exprCandidate = rangeSuffix[1].trim();
		domain = parsedDomain;
	}

	const cleanExpr = exprCandidate.replace(/^(?:y|f\s*\(\s*x\s*\))\s*=\s*/i, '').trim();
	if (!cleanExpr) return null;

	const sanitized = sanitizeExpression(cleanExpr);
	if (!sanitized.ok) return null;

	return {
		expression: sanitized.expression,
		domain,
		title: `y = ${cleanExpr}`,
	};
}

/** Asks the model to translate a request into a plot plan. */
export async function requestFigureSpec(
	settings: CustomTranscriptionProviderSettings,
	userText: string,
): Promise<FigureSpec | null> {
	const raw = await requestAiCompletion({
		settings,
		systemPrompt: FIGURE_SYSTEM_PROMPT,
		userText,
		media: null,
	});
	return parseFigureSpec(raw);
}
