import './drawing-menu.scss';
import '../writing-menu/writing-menu.scss';
import * as React from 'react';
import { SelectIcon } from 'src/graphics/icons/select-icon';
import { EraseIcon } from 'src/graphics/icons/erase-icon';
import { DrawIcon } from 'src/graphics/icons/draw-icon';
import { ExpandIcon } from 'src/graphics/icons/expand-icon';
import { CloseFullscreenIcon } from 'src/graphics/icons/close-fullscreen-icon';
import { LocateIcon } from 'src/graphics/icons/locate-icon';
import { PointerIcon } from 'src/graphics/icons/pointer-icon';
import classNames from 'classnames';
import { TooltipButton } from 'src/components/jsx-components/tooltip-button/tooltip-button';
import { InkCanvasBrushMenu } from 'src/components/jsx-components/brush-menu/brush-menu';
import type { InkCanvasEditor, InkTool } from 'src/ink-canvas/types';
import { t } from 'src/i18n';

//////////
//////////

export enum tool {
	select = 'select',
	draw = 'draw',
	eraser = 'eraser',
}

function inkToolToMenuTool(inkTool: InkTool): tool {
	if (inkTool === 'select') return tool.select;
	if (inkTool === 'erase') return tool.eraser;
	return tool.draw;
}

interface InkCanvasDrawingMenuProps {
	getEditor: () => InkCanvasEditor | undefined;
	onStoreChange: () => void;
	onActivateTool?: (tool: 'draw' | 'erase' | 'select') => void;
	onExpandClick?: () => void;
	/** Dedicated view: hide ribbon, tab strip, view header, and side docks. */
	onEnterWorkspaceChrome?: () => void;
	/** Dedicated view: restore the chrome hidden by full screen, or return to the note. */
	onExitWorkspaceChrome?: () => void;
	isWorkspaceChromeHidden?: boolean;
	/** Dedicated view (not full screen): reveal this ink file in the file explorer. */
	onLocateFile?: () => void;
	showFingerDrawingToggle?: boolean;
	isFingerDrawingActive?: boolean;
	onFingerDrawingToggle?: () => void;
	embedId?: string;
	workspaceLeafId?: string;
	plugin?: import('src/main').default;
	/**
	 * Writing editor only: the "answer in the margin" pen. Omitted on drawing,
	 * where an automatic reply to a sketch has no useful target.
	 */
	magicInk?: {
		active: boolean;
		available: boolean;
		onToggle: () => void;
	};
}

export const InkCanvasDrawingMenu = React.forwardRef<HTMLDivElement, InkCanvasDrawingMenuProps>((props, ref) => {

	const [curTool, setCurTool] = React.useState<tool>(tool.draw);

	// Sync toolbar highlight when the canvas changes tool (e.g. cmd/ctrl temporary erase).
	React.useEffect(() => {
		let unsubscribe: (() => void) | undefined;
		let pollId: number | undefined;

		const trySubscribe = (): boolean => {
			const editor = props.getEditor();
			if (!editor?.subscribeToolChange) return false;
			unsubscribe = editor.subscribeToolChange((inkTool) => {
				setCurTool(inkToolToMenuTool(inkTool));
			});
			return true;
		};

		if (!trySubscribe()) {
			pollId = window.setInterval(() => {
				if (trySubscribe() && pollId !== undefined) {
					window.clearInterval(pollId);
					pollId = undefined;
				}
			}, 100);
		}

		return () => {
			if (pollId !== undefined) window.clearInterval(pollId);
			unsubscribe?.();
		};
	}, [props.getEditor]);

	///////////

	function activateSelectTool() {
		const editor = props.getEditor();
		if (!editor) return;
		editor.setTool('select');
		setCurTool(tool.select);
		props.onActivateTool?.('select');
	}

	function activateDrawTool() {
		const editor = props.getEditor();
		if (!editor) return;
		editor.setTool('draw');
		setCurTool(tool.draw);
		props.onActivateTool?.('draw');
	}

	function activateEraseTool() {
		const editor = props.getEditor();
		if (!editor) return;
		editor.setTool('erase');
		setCurTool(tool.eraser);
		props.onActivateTool?.('erase');
	}

	///////////
	///////////

	const showEmbedFullScreen = Boolean(props.onExpandClick);
	const showDedicatedFullScreen = Boolean(
		!props.onExpandClick && !props.isWorkspaceChromeHidden && props.onEnterWorkspaceChrome
	);
	const showExitFullScreen = Boolean(!props.onExpandClick && props.isWorkspaceChromeHidden);
	// Dedicated only: Full screen already left-justifies Exit, and embeds use overflow Open instead.
	const showLocate = Boolean(
		!props.onExpandClick && !props.isWorkspaceChromeHidden && props.onLocateFile
	);
	const showQuickMenu = Boolean(
		props.showFingerDrawingToggle
		|| showEmbedFullScreen
		|| showDedicatedFullScreen
		|| showExitFullScreen
		|| showLocate
	);

	return <>
		<div
			ref={ref}
			className={classNames([
				'ink_menu-bar',
				'ink_menu-bar_full',
			])}
		>
			{showQuickMenu && (
				<div className='ink_quick-menu'>
					{showEmbedFullScreen && (
						<TooltipButton
							tooltip='Full screen'
							onClick={() => props.onExpandClick?.()}
						>
							<ExpandIcon />
						</TooltipButton>
					)}
					{showDedicatedFullScreen && (
						<TooltipButton
							tooltip='Full screen'
							onClick={() => props.onEnterWorkspaceChrome?.()}
						>
							<ExpandIcon />
						</TooltipButton>
					)}
					{showLocate && (
						<TooltipButton
							tooltip='Locate'
							onClick={() => props.onLocateFile?.()}
						>
							<LocateIcon />
						</TooltipButton>
					)}
					{showExitFullScreen && (
						<TooltipButton
							tooltip='Exit full screen'
							onClick={() => props.onExitWorkspaceChrome?.()}
						>
							<CloseFullscreenIcon />
						</TooltipButton>
					)}
					{props.showFingerDrawingToggle && (
						<TooltipButton
							tooltip={props.isFingerDrawingActive ? 'Enable drawing with finger' : 'Disable drawing with finger'}
							className={props.isFingerDrawingActive ? 'ink_menu-toggle--active' : undefined}
							onClick={() => props.onFingerDrawingToggle?.()}
						>
							<PointerIcon />
						</TooltipButton>
					)}
				</div>
			)}
			<div className='ink_tool-menu'>
				<TooltipButton
					tooltip='Select'
					onClick={activateSelectTool}
					disabled={curTool === tool.select}
				>
					<SelectIcon />
				</TooltipButton>
				<TooltipButton
					tooltip='Draw'
					onClick={activateDrawTool}
					disabled={curTool === tool.draw}
				>
					<DrawIcon />
				</TooltipButton>
				<TooltipButton
					tooltip='Erase'
					onClick={activateEraseTool}
					disabled={curTool === tool.eraser}
				>
					<EraseIcon />
				</TooltipButton>
				{/*
				 * The brush belongs with the other instruments, not with the
				 * aside buttons: it picks what the pen does, exactly like the
				 * select/draw/erase trio. Living in `.ink_other-menu` also gave
				 * it a rounded square, so the row read as two different toolbars
				 * sitting end to end.
				 */}
				<InkCanvasBrushMenu
					getEditor={props.getEditor}
					onStoreChange={props.onStoreChange}
				/>
			</div>
			<div className='ink_other-menu'>
				{props.magicInk && (
					<TooltipButton
						tooltip={
							!props.magicInk.available
								? t('Enable a custom API in settings first.')
								: props.magicInk.active
									? t('Magic margin on: pause and the reply appears')
									: t('Magic margin')
						}
						className={props.magicInk.active ? 'ink_menu-toggle--magic-active' : undefined}
						onClick={() => props.magicInk?.onToggle()}
					>
						<span className='ink_magic-pen-glyph' aria-hidden='true'>✦</span>
					</TooltipButton>
				)}
			</div>
		</div>
	</>;
});

export default InkCanvasDrawingMenu;
