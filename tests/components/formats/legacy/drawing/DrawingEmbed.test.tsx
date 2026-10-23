import React from 'react';
import { render } from '@testing-library/react';
import { Provider as JotaiProvider } from 'jotai';
import DrawingEmbed from 'src/components/formats/current/drawing/drawing-embed/drawing-embed';
import { DEFAULT_EMBED_SETTINGS } from 'src/types/embed-settings';

const makePlugin = (overrides: Partial<any> = {}) => ({
  app: { vault: {} },
  settings: {},
  ...overrides,
});

const makeTFile = (): any => ({ 
  path: 'path/to/file',
  stat: { mtime: 1234567890 },
	vault: {
		read: jest.fn().mockResolvedValue('<svg></svg>'),
		cachedRead: jest.fn().mockResolvedValue('<svg></svg>'),
		on: jest.fn(() => ({})),
		offref: jest.fn(),
		getResourcePath: jest.fn(() => 'data:image/svg+xml,%3Csvg/%3E'),
	},});

describe('DrawingEmbed (legacy)', () => {
  it('renders container and children', () => {
    render(
      <JotaiProvider>
        <DrawingEmbed
          workspaceLeafId="test-leaf"
          embeddedFile={makeTFile()}
          embedSettings={DEFAULT_EMBED_SETTINGS}
          saveSrcFile={(_pageData: any) => ({})}
          remove={() => {}}
          partialEmbedFilepath="test-drawing.svg"
        />
      </JotaiProvider>
    );

    const container = document.querySelector('.ddc_ink_drawing-embed');
    expect(container).toBeInTheDocument();
  });
});


