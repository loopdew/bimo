import * as React from 'react';
import { getGlobals } from 'src/stores/global-store';
import type { InkCanvasBackground } from './types';

//////////
//////////

/**
 * Resolves a vault path to a URL the renderer can load.
 *
 * `getResourcePath` is the only supported way to reference a vault file from an
 * `<img>`/`<image>`; it returns an `app://` URL that survives popout windows and
 * mobile webviews. It throws before plugin init, hence the guard.
 */
function resolveResourceHref(path: string): string | null {
	if (!path) return null;
	try {
		return getGlobals().plugin.app.vault.adapter.getResourcePath(path);
	} catch {
		return null;
	}
}

export interface InkBackgroundImageProps {
	background: InkCanvasBackground;
	/** Page width in canvas units. The image is scaled to this width. */
	pageWidth: number;
}

/**
 * The page under the ink.
 *
 * Rendered as a plain `<image>` inside the camera group, so it pans and zooms
 * with the strokes for free. It is deliberately *not* part of the stroke store:
 * erasing ink can never damage the page, and hiding the background leaves the
 * annotations behind.
 */
export function InkBackgroundImage(props: InkBackgroundImageProps): React.JSX.Element | null {
	const { background, pageWidth } = props;
	const href = resolveResourceHref(background.path);
	if (!href) return null;

	// Keep the source aspect ratio; a page narrower than the canvas is centred by
	// `xMidYMin` rather than stretched, which would distort printed text.
	const height = background.width > 0
		? pageWidth * (background.height / background.width)
		: pageWidth;

	return (
		<image
			className="ink-background-image"
			href={href}
			x={0}
			y={0}
			width={pageWidth}
			height={height}
			preserveAspectRatio="xMidYMin meet"
			opacity={background.opacity ?? 1}
			// Strokes must stay clickable/erasable on top of the page.
			pointerEvents="none"
		/>
	);
}
