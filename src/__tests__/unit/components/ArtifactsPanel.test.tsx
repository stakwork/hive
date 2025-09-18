import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ArtifactsPanel } from '@/app/w/[slug]/task/[...taskParams]/components/ArtifactsPanel';
import { Artifact, ArtifactType } from '@/lib/chat';

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}));

// Mock child components to focus on ArtifactsPanel logic
vi.mock('@/app/w/[slug]/task/[...taskParams]/artifacts', () => ({
  CodeArtifactPanel: ({ artifacts }: { artifacts: Artifact[] }) => (
    <div data-testid="code-artifact-panel">
      Code Panel - {artifacts.length} artifacts
    </div>
  ),
  BrowserArtifactPanel: ({ 
    artifacts, 
    onDebugMessage 
  }: { 
    artifacts: Artifact[]; 
    onDebugMessage?: Function 
  }) => (
    <div data-testid="browser-artifact-panel">
      Browser Panel - {artifacts.length} artifacts
      {onDebugMessage && <button onClick={() => onDebugMessage('test message')}>Debug</button>}
    </div>
  ),
}));

// Helper function to create mock artifacts
const createMockArtifact = (type: ArtifactType, id: string): Artifact => ({
  id,
  messageId: `msg_${id}`,
  type,
  content: type === 'CODE' ? { content: 'test code', language: 'javascript' } : 
           type === 'BROWSER' ? { url: 'http://example.com' } : 
           { url: 'http://ide-example.com' },
  icon: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe('ArtifactsPanel', () => {
  const mockOnDebugMessage = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Tab Logic', () => {
    it('should not render when no artifacts are provided', () => {
      const { container } = render(
        <ArtifactsPanel artifacts={[]} onDebugMessage={mockOnDebugMessage} />
      );
      
      expect(container.firstChild).toBeNull();
    });

    it('should auto-select first available tab when artifacts become available', async () => {
      const codeArtifact = createMockArtifact('CODE', 'code1');
      const browserArtifact = createMockArtifact('BROWSER', 'browser1');
      
      render(
        <ArtifactsPanel 
          artifacts={[codeArtifact, browserArtifact]} 
          onDebugMessage={mockOnDebugMessage} 
        />
      );

      // Should render the component
      expect(screen.getByRole('tablist')).toBeInTheDocument();
      
      // Should have CODE tab selected first (alphabetically first in availableTabs)
      const codeTab = screen.getByRole('tab', { name: /code.*files/i });
      expect(codeTab).toHaveAttribute('aria-selected', 'true');
    });

    it('should display correct tabs based on available artifact types', () => {
      const codeArtifact = createMockArtifact('CODE', 'code1');
      const browserArtifact = createMockArtifact('BROWSER', 'browser1');
      const ideArtifact = createMockArtifact('IDE', 'ide1');
      
      render(
        <ArtifactsPanel 
          artifacts={[codeArtifact, browserArtifact, ideArtifact]} 
          onDebugMessage={mockOnDebugMessage} 
        />
      );

      // All three tab types should be present
      expect(screen.getByRole('tab', { name: /code.*files/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /live preview/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /ide/i })).toBeInTheDocument();
    });

    it('should allow tab switching between available tabs', async () => {
      const codeArtifact = createMockArtifact('CODE', 'code1');
      const browserArtifact = createMockArtifact('BROWSER', 'browser1');
      
      render(
        <ArtifactsPanel 
          artifacts={[codeArtifact, browserArtifact]} 
          onDebugMessage={mockOnDebugMessage} 
        />
      );

      const codeTab = screen.getByRole('tab', { name: /code.*files/i });
      const browserTab = screen.getByRole('tab', { name: /live preview/i });

      // CODE should be selected initially
      expect(codeTab).toHaveAttribute('aria-selected', 'true');
      expect(browserTab).toHaveAttribute('aria-selected', 'false');

      // Click browser tab
      fireEvent.click(browserTab);

      // Browser tab should now be selected
      await waitFor(() => {
        expect(browserTab).toHaveAttribute('aria-selected', 'true');
        expect(codeTab).toHaveAttribute('aria-selected', 'false');
      });
    });

    it('should only show tabs for artifact types that have artifacts', () => {
      const codeArtifacts = [
        createMockArtifact('CODE', 'code1'),
        createMockArtifact('CODE', 'code2'),
      ];
      
      render(
        <ArtifactsPanel 
          artifacts={codeArtifacts} 
          onDebugMessage={mockOnDebugMessage} 
        />
      );

      // Only CODE tab should be present
      expect(screen.getByRole('tab', { name: /code.*files/i })).toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: /live preview/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: /ide/i })).not.toBeInTheDocument();
    });
  });

  describe('Artifact Filtering', () => {
    it('should correctly separate artifacts by type', () => {
      const artifacts = [
        createMockArtifact('CODE', 'code1'),
        createMockArtifact('CODE', 'code2'),
        createMockArtifact('BROWSER', 'browser1'),
        createMockArtifact('IDE', 'ide1'),
        createMockArtifact('BROWSER', 'browser2'),
      ];
      
      render(
        <ArtifactsPanel 
          artifacts={artifacts} 
          onDebugMessage={mockOnDebugMessage} 
        />
      );

      // Switch to CODE tab and verify it gets 2 code artifacts
      const codeTab = screen.getByRole('tab', { name: /code.*files/i });
      fireEvent.click(codeTab);
      
      expect(screen.getByTestId('code-artifact-panel')).toHaveTextContent('Code Panel - 2 artifacts');

      // Switch to BROWSER tab and verify it gets 2 browser artifacts
      const browserTab = screen.getByRole('tab', { name: /live preview/i });
      fireEvent.click(browserTab);
      
      expect(screen.getByTestId('browser-artifact-panel')).toHaveTextContent('Browser Panel - 2 artifacts');

      // Switch to IDE tab and verify it gets 1 IDE artifact
      const ideTab = screen.getByRole('tab', { name: /ide/i });
      fireEvent.click(ideTab);
      
      expect(screen.getByTestId('browser-artifact-panel')).toHaveTextContent('Browser Panel - 1 artifacts');
    });

    it('should handle mixed artifact types correctly', () => {
      const mixedArtifacts = [
        createMockArtifact('BROWSER', 'browser1'),
        createMockArtifact('CODE', 'code1'),
        createMockArtifact('IDE', 'ide1'),
      ];
      
      render(
        <ArtifactsPanel 
          artifacts={mixedArtifacts} 
          onDebugMessage={mockOnDebugMessage} 
        />
      );

      // Should have all three tab types
      expect(screen.getByRole('tab', { name: /code.*files/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /live preview/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /ide/i })).toBeInTheDocument();

      // Each should have exactly 1 artifact when selected
      fireEvent.click(screen.getByRole('tab', { name: /code.*files/i }));
      expect(screen.getByTestId('code-artifact-panel')).toHaveTextContent('Code Panel - 1 artifacts');
    });

    it('should recalculate available tabs when artifacts prop changes', async () => {
      const { rerender } = render(
        <ArtifactsPanel 
          artifacts={[createMockArtifact('CODE', 'code1')]} 
          onDebugMessage={mockOnDebugMessage} 
        />
      );

      // Initially only CODE tab
      expect(screen.getByRole('tab', { name: /code.*files/i })).toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: /live preview/i })).not.toBeInTheDocument();

      // Add browser artifact
      rerender(
        <ArtifactsPanel 
          artifacts={[
            createMockArtifact('CODE', 'code1'),
            createMockArtifact('BROWSER', 'browser1'),
          ]} 
          onDebugMessage={mockOnDebugMessage} 
        />
      );

      // Now both tabs should be present
      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /code.*files/i })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /live preview/i })).toBeInTheDocument();
      });
    });
  });

  describe('Dynamic UI Updates', () => {
    it('should render appropriate child components based on active tab', async () => {
      const artifacts = [
        createMockArtifact('CODE', 'code1'),
        createMockArtifact('BROWSER', 'browser1'),
      ];
      
      render(
        <ArtifactsPanel 
          artifacts={artifacts} 
          onDebugMessage={mockOnDebugMessage} 
        />
      );

      // Initially CODE tab should be active and show CodeArtifactPanel
      expect(screen.getByTestId('code-artifact-panel')).toBeInTheDocument();
      expect(screen.queryByTestId('browser-artifact-panel')).not.toBeInTheDocument();

      // Switch to browser tab
      fireEvent.click(screen.getByRole('tab', { name: /live preview/i }));

      // Now browser panel should be visible
      await waitFor(() => {
        expect(screen.getByTestId('browser-artifact-panel')).toBeInTheDocument();
      });
    });

    it('should pass correct props to child components', () => {
      const codeArtifacts = [
        createMockArtifact('CODE', 'code1'),
        createMockArtifact('CODE', 'code2'),
      ];
      
      render(
        <ArtifactsPanel 
          artifacts={codeArtifacts} 
          onDebugMessage={mockOnDebugMessage} 
        />
      );

      // CodeArtifactPanel should receive filtered CODE artifacts
      const codePanel = screen.getByTestId('code-artifact-panel');
      expect(codePanel).toHaveTextContent('Code Panel - 2 artifacts');
    });

    it('should pass onDebugMessage callback to browser panels', async () => {
      const browserArtifact = createMockArtifact('BROWSER', 'browser1');
      
      render(
        <ArtifactsPanel 
          artifacts={[browserArtifact]} 
          onDebugMessage={mockOnDebugMessage} 
        />
      );

      // Browser panel should have debug button
      const debugButton = screen.getByRole('button', { name: /debug/i });
      expect(debugButton).toBeInTheDocument();

      // Click debug button should call onDebugMessage
      fireEvent.click(debugButton);
      expect(mockOnDebugMessage).toHaveBeenCalledWith('test message');
    });

    it('should handle IDE artifacts with correct props', async () => {
      const ideArtifact = createMockArtifact('IDE', 'ide1');
      
      render(
        <ArtifactsPanel 
          artifacts={[ideArtifact]} 
          onDebugMessage={mockOnDebugMessage} 
        />
      );

      // Should show IDE tab
      expect(screen.getByRole('tab', { name: /ide/i })).toBeInTheDocument();
      
      // Should render BrowserArtifactPanel with ide=true prop
      expect(screen.getByTestId('browser-artifact-panel')).toBeInTheDocument();
    });

    it('should maintain state correctly when switching between tabs', async () => {
      const artifacts = [
        createMockArtifact('CODE', 'code1'),
        createMockArtifact('BROWSER', 'browser1'),
        createMockArtifact('IDE', 'ide1'),
      ];
      
      render(
        <ArtifactsPanel 
          artifacts={artifacts} 
          onDebugMessage={mockOnDebugMessage} 
        />
      );

      const codeTab = screen.getByRole('tab', { name: /code.*files/i });
      const browserTab = screen.getByRole('tab', { name: /live preview/i });
      const ideTab = screen.getByRole('tab', { name: /ide/i });

      // Start with CODE tab active
      expect(codeTab).toHaveAttribute('aria-selected', 'true');

      // Switch to BROWSER tab
      fireEvent.click(browserTab);
      await waitFor(() => {
        expect(browserTab).toHaveAttribute('aria-selected', 'true');
        expect(codeTab).toHaveAttribute('aria-selected', 'false');
      });

      // Switch to IDE tab
      fireEvent.click(ideTab);
      await waitFor(() => {
        expect(ideTab).toHaveAttribute('aria-selected', 'true');
        expect(browserTab).toHaveAttribute('aria-selected', 'false');
      });

      // Switch back to CODE tab
      fireEvent.click(codeTab);
      await waitFor(() => {
        expect(codeTab).toHaveAttribute('aria-selected', 'true');
        expect(ideTab).toHaveAttribute('aria-selected', 'false');
      });
    });

    it('should handle empty artifacts gracefully after initial render', () => {
      const { rerender } = render(
        <ArtifactsPanel 
          artifacts={[createMockArtifact('CODE', 'code1')]} 
          onDebugMessage={mockOnDebugMessage} 
        />
      );

      // Initially should render
      expect(screen.getByRole('tablist')).toBeInTheDocument();

      // Remove all artifacts
      rerender(
        <ArtifactsPanel 
          artifacts={[]} 
          onDebugMessage={mockOnDebugMessage} 
        />
      );

      // Should not render anything
      expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    });
  });

  describe('Integration', () => {
    it('should work without onDebugMessage callback', () => {
      const codeArtifact = createMockArtifact('CODE', 'code1');
      
      expect(() => {
        render(<ArtifactsPanel artifacts={[codeArtifact]} />);
      }).not.toThrow();

      expect(screen.getByRole('tablist')).toBeInTheDocument();
    });

    it('should handle complex artifact combinations', () => {
      const complexArtifacts = [
        createMockArtifact('CODE', 'code1'),
        createMockArtifact('CODE', 'code2'),
        createMockArtifact('CODE', 'code3'),
        createMockArtifact('BROWSER', 'browser1'),
        createMockArtifact('BROWSER', 'browser2'),
        createMockArtifact('IDE', 'ide1'),
      ];
      
      render(
        <ArtifactsPanel 
          artifacts={complexArtifacts} 
          onDebugMessage={mockOnDebugMessage} 
        />
      );

      // Should have all three tabs
      expect(screen.getByRole('tab', { name: /code.*files/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /live preview/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /ide/i })).toBeInTheDocument();

      // Verify artifact counts are correct
      fireEvent.click(screen.getByRole('tab', { name: /code.*files/i }));
      expect(screen.getByTestId('code-artifact-panel')).toHaveTextContent('Code Panel - 3 artifacts');

      fireEvent.click(screen.getByRole('tab', { name: /live preview/i }));
      expect(screen.getByTestId('browser-artifact-panel')).toHaveTextContent('Browser Panel - 2 artifacts');

      fireEvent.click(screen.getByRole('tab', { name: /ide/i }));
      expect(screen.getByTestId('browser-artifact-panel')).toHaveTextContent('Browser Panel - 1 artifacts');
    });
  });
});