import { cleanMermaidCode } from 'src/logic/ai/mermaid';

//////////
//////////

describe('cleanMermaidCode', () => {
	it('keeps a bare flowchart', () => {
		const code = cleanMermaidCode('flowchart TD\nA[开始] --> B[结束]');
		expect(code).toBe('flowchart TD\nA[开始] --> B[结束]');
	});

	it('strips a ```mermaid fence', () => {
		const code = cleanMermaidCode('```mermaid\nflowchart LR\nA --> B\n```');
		expect(code).toBe('flowchart LR\nA --> B');
	});

	it('drops prose before the declaration', () => {
		const code = cleanMermaidCode('好的，这是代码：\n\nflowchart TD\nA --> B');
		expect(code!.startsWith('flowchart TD')).toBe(true);
		expect(code).not.toContain('好的');
	});

	it('drops trailing prose after the fence', () => {
		const code = cleanMermaidCode('```mermaid\nflowchart TD\nA --> B\n```\n希望对你有帮助');
		expect(code).toBe('flowchart TD\nA --> B');
	});

	it('accepts several diagram families', () => {
		expect(cleanMermaidCode('sequenceDiagram\nA->>B: hi')).toContain('sequenceDiagram');
		expect(cleanMermaidCode('mindmap\n  root')).toContain('mindmap');
		expect(cleanMermaidCode('graph LR\nA-->B')).toContain('graph LR');
	});

	it('returns null when the model reports no diagram', () => {
		expect(cleanMermaidCode('NOT_A_DIAGRAM')).toBeNull();
		expect(cleanMermaidCode('not_a_diagram\nsorry')).toBeNull();
	});

	it('returns null when there is no declaration line', () => {
		expect(cleanMermaidCode('这是一段说明文字。')).toBeNull();
		expect(cleanMermaidCode('')).toBeNull();
	});

	it('trims trailing whitespace on each line', () => {
		expect(cleanMermaidCode('flowchart TD   \nA --> B   ')).toBe('flowchart TD\nA --> B');
	});
});
