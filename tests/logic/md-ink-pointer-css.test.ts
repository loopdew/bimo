import { readFileSync } from 'fs';
import { resolve } from 'path';

//////////
//////////

/**
 * The pointer contract, checked against the stylesheet itself.
 *
 * jsdom does not resolve the plugin's real CSS, so the mount tests can prove
 * the layer exists but not that it can receive a press. That distinction is
 * exactly how the feature shipped broken once: the class flipped, the cursor
 * changed, and every stroke was still swallowed by the editor because no rule
 * ever set `pointer-events: auto`.
 */

const SCSS = readFileSync(resolve(__dirname, '../../src/styles/md-ink.scss'), 'utf8');

/** The text of the rule that both sets `pointer-events: auto` and names `tool`. */
function autoRuleFor(tool: string): string {
	const blocks = SCSS.split('}');
	const rule = blocks.find(
		(block) => block.includes('pointer-events: auto') && block.includes(`[data-tool='${tool}']`),
	);
	return rule ?? '';
}

describe('note ink pointer contract', () => {
	it.each(['pen', 'highlighter', 'eraser', 'lasso'])('%s takes over the pointer', (tool) => {
		expect(autoRuleFor(tool)).not.toBe('');
	});

	it('stays inert when no drawing tool is selected', () => {
		const base = SCSS.split('}').find((block) => block.includes('.bimo-md-ink-layer {'));
		expect(base).toContain('pointer-events: none');
	});

	it('does not hand the pointer to pan', () => {
		expect(autoRuleFor('pan')).toBe('');
	});
});
