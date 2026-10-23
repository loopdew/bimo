import React from 'react';
import { render } from '@testing-library/react';
import { Provider as JotaiProvider } from 'jotai';
import { DrawingEditorWrapper } from 'src/components/formats/current/drawing/drawing-editor/drawing-editor';

const makeTFile = (): any => ({ path: 'path/to/file', vault: {
		read: jest.fn().mockResolvedValue('<svg></svg>'),
		cachedRead: jest.fn().mockResolvedValue('<svg></svg>'),
		on: jest.fn(() => ({})),
		offref: jest.fn(),
		getResourcePath: jest.fn(() => 'data:image/svg+xml,%3Csvg/%3E'),
	} });

describe('DrawingEditorWrapper', () => {
  it('mounts wrapper without crashing when editorActive is default false', () => {
    render(
      <JotaiProvider>
        <DrawingEditorWrapper
          onReady={() => {}}
          workspaceLeafId="test-leaf"
          embedId="test-embed"
          drawingFile={makeTFile()}
          save={() => {}}
        />
      </JotaiProvider>
    );

    expect(true).toBe(true);
  });
});
