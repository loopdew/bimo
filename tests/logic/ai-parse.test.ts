import { cleanCaption } from 'src/logic/ai/caption';
import { parseDirectFigureSpec, parseFigureSpec } from 'src/logic/ai/figure';

//////////
//////////

describe('cleanCaption', () => {
	it('keeps a plain single-line answer', () => {
		expect(cleanCaption('第三章电场的推导笔记')).toBe('第三章电场的推导笔记');
	});

	it('drops a 题注： prefix', () => {
		expect(cleanCaption('题注：第三章电场推导')).toBe('第三章电场推导');
	});

	it('strips wrapping quotes of several styles', () => {
		expect(cleanCaption('"第三章电场推导"')).toBe('第三章电场推导');
		expect(cleanCaption('「第三章电场推导」')).toBe('第三章电场推导');
	});

	it('drops a markdown heading marker', () => {
		expect(cleanCaption('## 第三章电场推导')).toBe('第三章电场推导');
	});

	it('keeps only the first non-empty line', () => {
		expect(cleanCaption('\n\n第三章电场推导\n第二行不该保留')).toBe('第三章电场推导');
	});

	it('removes characters that would break an image alt', () => {
		expect(cleanCaption('数组 a[0] | 表格')).toBe('数组 a 0 表格');
	});

	it('truncates an over-long caption with an ellipsis', () => {
		const long = '一'.repeat(100);
		const result = cleanCaption(long);
		expect(result.length).toBeLessThanOrEqual(60);
		expect(result.endsWith('…')).toBe(true);
	});

	it('returns an empty string for empty input', () => {
		expect(cleanCaption('')).toBe('');
		expect(cleanCaption('   \n  ')).toBe('');
	});
});

describe('parseFigureSpec', () => {
	it('parses the requested JSON shape', () => {
		const spec = parseFigureSpec('{"expr":"Math.sin(x)/x","domain":[-10,10],"title":"y = sin(x)/x"}');
		expect(spec).not.toBeNull();
		expect(spec!.expression).toBe('Math.sin(x)/x');
		expect(spec!.domain).toEqual([-10, 10]);
		expect(spec!.title).toBe('y = sin(x)/x');
	});

	it('parses a JSON object wrapped in a markdown fence', () => {
		const spec = parseFigureSpec('```json\n{"expr":"x**2","domain":[-3,3]}\n```');
		expect(spec!.expression).toBe('x**2');
		expect(spec!.domain).toEqual([-3, 3]);
	});

	it('namespaces a bare expression inside the JSON', () => {
		const spec = parseFigureSpec('{"expr":"sin(x)","domain":[0,6]}');
		expect(spec!.expression).toBe('Math.sin(x)');
	});

	it('falls back to treating a bare answer as the expression', () => {
		const spec = parseFigureSpec('x^2');
		expect(spec!.expression).toBe('x**2');
		expect(spec!.domain).toEqual([-10, 10]);
	});

	it('normalises a reversed domain', () => {
		const spec = parseFigureSpec('{"expr":"x","domain":[5,-5]}');
		expect(spec!.domain).toEqual([-5, 5]);
	});

	it('falls back to the default domain when the domain is junk', () => {
		expect(parseFigureSpec('{"expr":"x","domain":"wide"}')!.domain).toEqual([-10, 10]);
		expect(parseFigureSpec('{"expr":"x","domain":[0,0]}')!.domain).toEqual([-10, 10]);
	});

	it('rejects an expression that contains code', () => {
		expect(parseFigureSpec('{"expr":"x; while(true){}","domain":[0,1]}')).toBeNull();
		expect(parseFigureSpec('document.cookie')).toBeNull();
	});

	it('rejects output with no expression at all', () => {
		expect(parseFigureSpec('')).toBeNull();
		expect(parseFigureSpec('抱歉，我无法处理这个请求。')).toBeNull();
	});

	it('caps the title length', () => {
		const spec = parseFigureSpec(`{"expr":"x","domain":[0,1],"title":"${'长'.repeat(200)}"}`);
		expect(spec!.title!.length).toBeLessThanOrEqual(80);
	});
});

describe('parseDirectFigureSpec', () => {
	it('parses y = expr, low to high directly without AI', () => {
		const spec = parseDirectFigureSpec('y = sin(x)/x, -10 to 10');
		expect(spec).not.toBeNull();
		expect(spec!.expression).toBe('Math.sin(x)/x');
		expect(spec!.domain).toEqual([-10, 10]);
		expect(spec!.title).toBe('y = sin(x)/x');
	});

	it('parses f(x) = expr with bracketed range', () => {
		const spec = parseDirectFigureSpec('f(x) = x^2 - 2*x [-5, 5]');
		expect(spec).not.toBeNull();
		expect(spec!.expression).toBe('x**2 - 2*x');
		expect(spec!.domain).toEqual([-5, 5]);
	});

	it('parses a bare expression with default domain', () => {
		const spec = parseDirectFigureSpec('cos(x)');
		expect(spec).not.toBeNull();
		expect(spec!.expression).toBe('Math.cos(x)');
		expect(spec!.domain).toEqual([-10, 10]);
	});

	it('returns null for natural-language prompts so they route to AI', () => {
		expect(parseDirectFigureSpec('画一个阻尼正弦波')).toBeNull();
		expect(parseDirectFigureSpec('plot a damped sine wave')).toBeNull();
	});
});
