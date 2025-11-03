import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import StepNode from '@/components/workflow/StepNode';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';

vi.mock('@/components/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ children }: { children: string }) => (
    <div data-testid="markdown-renderer">{children}</div>
  ),
}));

// Mock @xyflow/react components
vi.mock('@xyflow/react', () => ({
  Handle: ({ type, position, className, isConnectable }: any) => (
    <div
      data-testid={`handle-${type}`}
      data-position={position}
      data-connectable={isConnectable}
      className={className}
    />
  ),
  Position: {
    Left: 'left',
    Right: 'right',
    Top: 'top',
    Bottom: 'bottom',
  },
  useHandleConnections: () => [],
  NodeProps: {},
}));

// Mock useTheme hook used by MarkdownRenderer
vi.mock('@/hooks/use-theme', () => ({
  useTheme: () => ({
    resolvedTheme: 'light',
  }),
}));

// Helper to create test node data
const createStepNodeData = (overrides: any = {}) => ({
  id: 'test-node-1',
  className: 'test-node',
  width: 200,
  height: 100,
  bgColor: '#FFFFFF',
  borderRadius: 8,
  borderColor: '#000000',
  textColor: '#000000',
  stepType: 'human',
  project_view: false,
  data: {
    html: '<div>Test HTML Content</div>',
  },
  ...overrides,
});

describe('StepNode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('HTML Content Rendering', () => {
    it('renders HTML content through MarkdownRenderer instead of dangerouslySetInnerHTML', () => {
      const data = createStepNodeData({
        data: { html: '<p>Safe Content</p>' },
      });

      render(<StepNode data={data} id="test" type="custom" />);

      expect(screen.getByTestId('markdown-renderer')).toBeInTheDocument();
      expect(screen.getByText('<p>Safe Content</p>')).toBeInTheDocument();
    });

    it('passes HTML with script tags to MarkdownRenderer', () => {
      const htmlWithScript = '<script>alert("XSS")</script><p>Content</p>';
      const data = createStepNodeData({
        data: { html: htmlWithScript },
      });

      render(<StepNode data={data} id="test" type="custom" />);

      expect(screen.getByTestId('markdown-renderer')).toBeInTheDocument();
      expect(screen.getByTestId('markdown-renderer')).toHaveTextContent(htmlWithScript);
    });

    it('passes HTML with onclick handlers to MarkdownRenderer', () => {
      const htmlWithHandler = '<div onclick="alert(\'XSS\')">Click me</div>';
      const data = createStepNodeData({
        data: { html: htmlWithHandler },
      });

      render(<StepNode data={data} id="test" type="custom" />);

      expect(screen.getByTestId('markdown-renderer')).toBeInTheDocument();
      expect(screen.getByTestId('markdown-renderer')).toHaveTextContent(htmlWithHandler);
    });

    it('passes HTML with onerror handlers to MarkdownRenderer', () => {
      const htmlWithError = '<img src="x" onerror="alert(\'XSS\')" />';
      const data = createStepNodeData({
        data: { html: htmlWithError },
      });

      render(<StepNode data={data} id="test" type="custom" />);

      expect(screen.getByTestId('markdown-renderer')).toBeInTheDocument();
      expect(screen.getByTestId('markdown-renderer')).toHaveTextContent(htmlWithError);
    });

    it('passes HTML with javascript protocol to MarkdownRenderer', () => {
      const htmlWithJsProtocol = '<a href="javascript:alert(\'XSS\')">Click</a>';
      const data = createStepNodeData({
        data: { html: htmlWithJsProtocol },
      });

      render(<StepNode data={data} id="test" type="custom" />);

      expect(screen.getByTestId('markdown-renderer')).toBeInTheDocument();
      expect(screen.getByTestId('markdown-renderer')).toHaveTextContent(htmlWithJsProtocol);
    });

    it('passes HTML with data protocol to MarkdownRenderer', () => {
      const htmlWithDataProtocol = '<object data="data:text/html;base64,PHNjcmlwdD5hbGVydCgnWFNTJyk8L3NjcmlwdD4="></object>';
      const data = createStepNodeData({
        data: { html: htmlWithDataProtocol },
      });

      render(<StepNode data={data} id="test" type="custom" />);

      expect(screen.getByTestId('markdown-renderer')).toBeInTheDocument();
      expect(screen.getByTestId('markdown-renderer')).toHaveTextContent(htmlWithDataProtocol);
    });
  });

  describe('Workflow HTML Rendering', () => {
    it('renders workflow step HTML with classes and structure', () => {
      const workflowHtml = `
        <div class="workflow-standard-template human-finished">
          <div class="workflow-top">
            <span class="workflow-step-type">HUMAN</span>
          </div>
        </div>
      `;

      const data = createStepNodeData({
        data: { html: workflowHtml },
      });

      render(<StepNode data={data} id="test" type="custom" />);

      expect(screen.getByTestId('markdown-renderer')).toBeInTheDocument();
      expect(screen.getByTestId('markdown-renderer')).toHaveTextContent('workflow-standard-template');
    });

    it('renders workflow HTML with SVG icons', () => {
      const workflowHtml = `
        <div class="workflow-step-main">
          <svg width="24" height="24">
            <circle cx="12" cy="12" r="10" />
          </svg>
        </div>
      `;

      const data = createStepNodeData({
        data: { html: workflowHtml },
      });

      render(<StepNode data={data} id="test" type="custom" />);

      expect(screen.getByTestId('markdown-renderer')).toBeInTheDocument();
    });

    it('renders workflow HTML with Material Icons', () => {
      const workflowHtml = '<span class="material-icons">code</span>';

      const data = createStepNodeData({
        data: { html: workflowHtml },
      });

      render(<StepNode data={data} id="test" type="custom" />);

      expect(screen.getByTestId('markdown-renderer')).toBeInTheDocument();
      expect(screen.getByTestId('markdown-renderer')).toHaveTextContent('material-icons');
    });

    it('renders empty workflow HTML gracefully', () => {
      const data = createStepNodeData({
        data: { html: '' },
      });

      render(<StepNode data={data} id="test" type="custom" />);

      expect(screen.getByTestId('markdown-renderer')).toBeInTheDocument();
      expect(screen.getByTestId('markdown-renderer')).toHaveTextContent('');
    });
  });

  describe('Node Styling', () => {
    it('applies custom background color', () => {
      const data = createStepNodeData({
        bgColor: '#67C083',
      });

      render(<StepNode data={data} id="test" type="custom" />);

      const nodeContainer = screen.getByTestId('markdown-renderer').parentElement;
      expect(nodeContainer).toHaveStyle({ backgroundColor: '#67C083' });
    });

    it('applies custom border styling', () => {
      const data = createStepNodeData({
        borderColor: '#FF5252',
        borderRadius: 12,
      });

      render(<StepNode data={data} id="test" type="custom" />);

      const nodeContainer = screen.getByTestId('markdown-renderer').parentElement;
      expect(nodeContainer).toHaveStyle({
        borderColor: '#FF5252',
        borderRadius: '12px',
        borderWidth: '2px',
        borderStyle: 'solid',
      });
    });

    it('applies custom text color', () => {
      const data = createStepNodeData({
        textColor: '#FFFFFF',
      });

      render(<StepNode data={data} id="test" type="custom" />);

      const nodeContainer = screen.getByTestId('markdown-renderer').parentElement;
      expect(nodeContainer).toHaveStyle({ color: '#FFFFFF' });
    });

    it('applies custom dimensions', () => {
      const data = createStepNodeData({
        width: 300,
        height: 150,
      });

      render(<StepNode data={data} id="test" type="custom" />);

      const nodeContainer = screen.getByTestId('markdown-renderer').parentElement;
      expect(nodeContainer).toHaveStyle({
        width: '300px',
        height: '150px',
      });
    });
  });

  describe('Handle Connections', () => {
    it('renders target handle for non-start nodes', () => {
      const data = createStepNodeData({
        id: 'regular-node',
      });

      render(<StepNode data={data} id="test" type="custom" />);

      expect(screen.getByTestId('handle-target')).toBeInTheDocument();
    });

    it('does not render target handle for start node', () => {
      const data = createStepNodeData({
        id: 'start',
      });

      render(<StepNode data={data} id="test" type="custom" />);

      expect(screen.queryByTestId('handle-target')).not.toBeInTheDocument();
    });

    it('renders source handle for regular nodes', () => {
      const data = createStepNodeData({
        id: 'regular-node',
      });

      render(<StepNode data={data} id="test" type="custom" />);

      expect(screen.getByTestId('handle-source')).toBeInTheDocument();
    });

    it('does not render source handle for system.succeed node', () => {
      const data = createStepNodeData({
        id: 'system.succeed',
      });

      render(<StepNode data={data} id="test" type="custom" />);

      expect(screen.queryByTestId('handle-source')).not.toBeInTheDocument();
    });

    it('does not render source handle for system.fail node', () => {
      const data = createStepNodeData({
        id: 'system.fail',
      });

      render(<StepNode data={data} id="test" type="custom" />);

      expect(screen.queryByTestId('handle-source')).not.toBeInTheDocument();
    });

    it('disables target handle in project view mode', () => {
      const data = createStepNodeData({
        project_view: true,
      });

      render(<StepNode data={data} id="test" type="custom" />);

      const targetHandle = screen.getByTestId('handle-target');
      expect(targetHandle).toHaveAttribute('data-connectable', 'false');
    });

    it('disables source handle in project view mode', () => {
      const data = createStepNodeData({
        project_view: true,
      });

      render(<StepNode data={data} id="test" type="custom" />);

      const sourceHandle = screen.getByTestId('handle-source');
      expect(sourceHandle).toHaveAttribute('data-connectable', 'false');
    });
  });

  describe('IfCondition Special Handling', () => {
    it('applies special handle class for IfCondition step type', () => {
      const data = createStepNodeData({
        stepType: 'IfCondition',
      });

      render(<StepNode data={data} id="test" type="custom" />);

      const targetHandle = screen.getByTestId('handle-target');
      expect(targetHandle).toHaveClass('workflow-if-condition-left-handle');
    });

    it('disables source handle for IfCondition nodes', () => {
      const data = createStepNodeData({
        stepType: 'IfCondition',
      });

      render(<StepNode data={data} id="test" type="custom" />);

      const sourceHandle = screen.getByTestId('handle-source');
      expect(sourceHandle).toHaveAttribute('data-connectable', 'false');
    });
  });

  describe('Project View Mode', () => {
    it('applies project view class when enabled', () => {
      const data = createStepNodeData({
        project_view: true,
      });

      const { container } = render(<StepNode data={data} id="test" type="custom" />);

      const wrapper = container.querySelector('.workflow-flow-project-view');
      expect(wrapper).toBeInTheDocument();
    });

    it('applies small drag handle class in project view', () => {
      const data = createStepNodeData({
        project_view: true,
      });

      render(<StepNode data={data} id="test" type="custom" />);

      const targetHandle = screen.getByTestId('handle-target');
      expect(targetHandle).toHaveClass('workflow-drag-handle__custom_small');
    });

    it('applies regular drag handle class in normal view', () => {
      const data = createStepNodeData({
        project_view: false,
      });

      render(<StepNode data={data} id="test" type="custom" />);

      const targetHandle = screen.getByTestId('handle-target');
      expect(targetHandle).toHaveClass('workflow-drag-handle__custom');
    });
  });
});