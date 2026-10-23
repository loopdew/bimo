import {
	sanitizeExpression,
	sampleFigure,
	buildFigureSvg,
} from 'src/logic/ai/expression';

//////////
//////////

function expressionOf(raw: string): string {
	const result = sanitizeExpression(raw);
	if (!result.ok) throw new Error(`expected a valid expression, got: ${result.reason}`);
	return result.expression;
}

describe('sanitizeExpression', () => {
	it('accepts a plain math expression', () => {
		expect(sanitizeExpression('sin(x)/x').ok).toBe(true);
	});

	it('namespaces bare math function calls', () => {
		expect(expressionOf('sin(x)/x')).toBe('Math.sin(x)/x');
	});

	it('leaves already-namespaced calls alone', () => {
		expect(expressionOf('Math.cos(x)')).toBe('Math.cos(x)');
	});

	it('strips a leading y = or f(x) =', () => {
		expect(expressionOf('y = x * 2')).toBe('x * 2');
		expect(expressionOf('f(x) = x + 1')).toBe('x + 1');
	});

	it('converts ^ to ** because JS has no exponent operator', () => {
		expect(expressionOf('x^2')).toBe('x**2');
	});

	it('rejects statement injection', () => {
		expect(sanitizeExpression('x; window.alert(1)').ok).toBe(false);
		expect(sanitizeExpression('while(true){}').ok).toBe(false);
		expect(sanitizeExpression('x => x').ok).toBe(false);
	});

	it('rejects unknown identifiers', () => {
		expect(sanitizeExpression('document.cookie').ok).toBe(false);
		expect(sanitizeExpression('require("fs")').ok).toBe(false);
	});

	it('rejects empty input and a bare prefix', () => {
		expect(sanitizeExpression('').ok).toBe(false);
		expect(sanitizeExpression('   ').ok).toBe(false);
		expect(sanitizeExpression('y = ').ok).toBe(false);
	});

	it('rejects absurdly long input', () => {
		expect(sanitizeExpression('x+'.repeat(300)).ok).toBe(false);
	});
});

describe('sampleFigure', () => {
	it('samples a parabola across the domain', () => {
		const data = sampleFigure(expressionOf('x^2'), { domain: [-2, 2], count: 5 });
		expect(data.samples).toHaveLength(5);
		expect(data.samples[0].x).toBe(-2);
		expect(data.samples[0].y).toBe(4);
		expect(data.samples[4].y).toBeCloseTo(4, 6);
		expect(data.yMin).toBeCloseTo(0, 6);
	});

	it('breaks the curve at a pole instead of drawing through it', () => {
		const data = sampleFigure(expressionOf('1/x'), { domain: [-10, 10], count: 201 });
		expect(data.segments.length).toBe(2);
		for (const segment of data.segments) {
			for (const point of segment) {
				expect(Number.isFinite(point.y)).toBe(true);
			}
		}
	});

	it('keeps a constant function visible', () => {
		const data = sampleFigure(expressionOf('3'), { domain: [-1, 1], count: 4 });
		expect(data.samples.every((point) => point.y === 3)).toBe(true);
		expect(data.yMin).toBe(3);
		expect(data.yMax).toBe(3);
	});

	it('returns an empty result when the expression never produces a number', () => {
		const data = sampleFigure(expressionOf('sqrt(x)'), { domain: [-4, -1], count: 10 });
		expect(data.samples).toHaveLength(0);
		expect(data.segments).toHaveLength(0);
	});

	it('normalises a reversed domain', () => {
		const data = sampleFigure(expressionOf('x'), { domain: [5, -5], count: 3 });
		expect(data.domain[0]).toBe(-5);
		expect(data.domain[1]).toBe(5);
	});
});

describe('buildFigureSvg', () => {
	it('emits a self-contained svg with a path per segment', () => {
		const data = sampleFigure(expressionOf('sin(x)'), { domain: [-5, 5], count: 50 });
		const svg = buildFigureSvg(data, { title: 'y = sin(x)' });
		expect(svg.startsWith('<svg')).toBe(true);
		expect(svg).toContain('viewBox="0 0 720 420"');
		expect(svg).toContain('<path d="M');
		expect(svg).toContain('y = sin(x)');
	});

	it('never emits NaN coordinates', () => {
		const data = sampleFigure(expressionOf('tan(x)'), { domain: [-3, 3], count: 200 });
		const svg = buildFigureSvg(data);
		expect(svg).not.toContain('NaN');
		expect(svg).not.toContain('Infinity');
	});

	it('escapes the title so a stray bracket cannot break the file', () => {
		const data = sampleFigure(expressionOf('x'), { domain: [-1, 1] });
		const svg = buildFigureSvg(data, { title: 'a < b & c > d' });
		expect(svg).toContain('a &lt; b &amp; c &gt; d');
		expect(svg).not.toContain('a < b & c > d');
	});
});
