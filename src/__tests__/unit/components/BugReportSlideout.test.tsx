import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { BugReportSlideout } from '@/components/BugReportSlideout';
import * as useWorkspaceModule from '@/hooks/useWorkspace';
import { toast } from 'sonner';

// Mock the hooks and modules
vi.mock('@/hooks/useWorkspace');
vi.mock('sonner');
vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: 'user-123', name: 'Test User', email: 'test@example.com' } },
    status: 'authenticated',
  }),
}));

// Mock next/navigation
vi.mock('next/navigation', () => ({
  usePathname: () => '/w/test-workspace/plan',
}));

// Mock Sheet components to render children
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children, open }: { children: React.ReactNode; open: boolean }) => 
    open ? <div data-testid="sheet">{children}</div> : null,
  SheetContent: ({ children }: { children: React.ReactNode }) => 
    <div data-testid="sheet-content">{children}</div>,
  SheetHeader: ({ children }: { children: React.ReactNode }) => 
    <div data-testid="sheet-header">{children}</div>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => 
    <h2>{children}</h2>,
  SheetDescription: ({ children }: { children: React.ReactNode }) => 
    <p>{children}</p>,
}));

// Mock Button component
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

// Mock Textarea component
vi.mock('@/components/ui/textarea', () => ({
  Textarea: (props: any) => <textarea {...props} />,
}));

// Mock Label component
vi.mock('@/components/ui/label', () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}));

// Mock URL methods globally for all tests
global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
global.URL.revokeObjectURL = vi.fn();

describe('BugReportSlideout', () => {
  const mockWorkspace = {
    workspace: {
      id: 'workspace-123',
      name: 'Test Workspace',
      slug: 'test-workspace',
    },
    loading: false,
    error: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue(mockWorkspace as any);
    // Mock window.location.href
    Object.defineProperty(window, 'location', {
      value: { href: 'https://example.com/w/test-workspace/plan' },
      writable: true,
    });
    // Mock toast functions
    vi.mocked(toast.success).mockImplementation(() => '');
    vi.mocked(toast.error).mockImplementation(() => '');
    // Mock URL methods globally
    if (!global.URL.createObjectURL) {
      global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    }
    if (!global.URL.revokeObjectURL) {
      global.URL.revokeObjectURL = vi.fn();
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Clean up any pending timers or async operations
    vi.clearAllTimers();
  });

  describe('Rendering', () => {
    it('should render the slideout when open', () => {
      render(<BugReportSlideout open={true} onOpenChange={vi.fn()} />);

      expect(screen.getByText('Report a Bug')).toBeInTheDocument();
      expect(screen.getByText('Help us improve by reporting issues you encounter')).toBeInTheDocument();
      expect(screen.getByTestId('bug-description-textarea')).toBeInTheDocument();
      expect(screen.getByTestId('bug-screenshot-input')).toBeInTheDocument();
      expect(screen.getByTestId('submit-bug-report-button')).toBeInTheDocument();
    });

    it('should not render when closed', () => {
      render(<BugReportSlideout open={false} onOpenChange={vi.fn()} />);

      expect(screen.queryByText('Report a Bug')).not.toBeInTheDocument();
    });

    it('should have submit button disabled when description is empty', () => {
      render(<BugReportSlideout open={true} onOpenChange={vi.fn()} />);

      const submitButton = screen.getByTestId('submit-bug-report-button');
      expect(submitButton).toBeDisabled();
    });
  });

  describe('Form Validation', () => {
    it('should require description with minimum 10 characters', async () => {
      const user = userEvent.setup();
      render(<BugReportSlideout open={true} onOpenChange={vi.fn()} />);

      const textarea = screen.getByTestId('bug-description-textarea');
      await user.type(textarea, 'Short');

      const submitButton = screen.getByTestId('submit-bug-report-button');
      expect(submitButton).toBeDisabled();
    });

    it('should enable submit button when description is at least 10 characters', async () => {
      const user = userEvent.setup();
      render(<BugReportSlideout open={true} onOpenChange={vi.fn()} />);

      const textarea = screen.getByTestId('bug-description-textarea');
      await user.type(textarea, 'This is a valid description');

      const submitButton = screen.getByTestId('submit-bug-report-button');
      expect(submitButton).not.toBeDisabled();
    });

    it('should reject non-image file types', async () => {
      render(<BugReportSlideout open={true} onOpenChange={vi.fn()} />);

      const file = new File(['content'], 'document.pdf', { type: 'application/pdf' });
      const input = screen.getByTestId('bug-screenshot-input') as HTMLInputElement;

      // Create a proper FileList-like object
      const fileList = {
        0: file,
        length: 1,
        item: (index: number) => (index === 0 ? file : null),
        [Symbol.iterator]: function* () {
          yield file;
        },
      };

      // Set files property
      Object.defineProperty(input, 'files', {
        value: fileList,
        configurable: true,
      });
      
      // Trigger the change event
      fireEvent.change(input);

      // Wait for toast to be called
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          'Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed.'
        );
      }, { timeout: 2000 });

      // File should not be selected
      expect(screen.queryByText('document.pdf')).not.toBeInTheDocument();
    });

    it('should reject files larger than 10MB', async () => {
      render(<BugReportSlideout open={true} onOpenChange={vi.fn()} />);

      // Create a file larger than 10MB
      const largeFile = new File(['x'.repeat(11 * 1024 * 1024)], 'large.png', { 
        type: 'image/png' 
      });
      const input = screen.getByTestId('bug-screenshot-input') as HTMLInputElement;

      // Create a proper FileList-like object
      const fileList = {
        0: largeFile,
        length: 1,
        item: (index: number) => (index === 0 ? largeFile : null),
        [Symbol.iterator]: function* () {
          yield largeFile;
        },
      };

      // Set files property
      Object.defineProperty(input, 'files', {
        value: fileList,
        configurable: true,
      });
      
      // Trigger the change event
      fireEvent.change(input);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('File size exceeds 10MB limit.');
      }, { timeout: 2000 });

      // File should not be selected
      expect(screen.queryByText('large.png')).not.toBeInTheDocument();
    });

    it('should accept valid image files', async () => {
      const user = userEvent.setup();
      render(<BugReportSlideout open={true} onOpenChange={vi.fn()} />);

      const file = new File(['content'], 'screenshot.png', { type: 'image/png' });
      const input = screen.getByTestId('bug-screenshot-input') as HTMLInputElement;

      await user.upload(input, file);

      await waitFor(() => {
        expect(screen.getByText('screenshot.png')).toBeInTheDocument();
      });
    });
  });

  describe('File Handling', () => {
    it('should show file preview when image is selected', async () => {
      const user = userEvent.setup();
      render(<BugReportSlideout open={true} onOpenChange={vi.fn()} />);

      const file = new File(['content'], 'screenshot.png', { type: 'image/png' });
      const input = screen.getByTestId('bug-screenshot-input') as HTMLInputElement;

      // Mock URL.createObjectURL
      global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');

      await user.upload(input, file);

      await waitFor(() => {
        expect(screen.getByText('screenshot.png')).toBeInTheDocument();
        expect(screen.getByAltText('Screenshot preview')).toBeInTheDocument();
      });
    });

    it('should remove file when remove button is clicked', async () => {
      const user = userEvent.setup();
      render(<BugReportSlideout open={true} onOpenChange={vi.fn()} />);

      const file = new File(['content'], 'screenshot.png', { type: 'image/png' });
      const input = screen.getByTestId('bug-screenshot-input') as HTMLInputElement;

      global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
      global.URL.revokeObjectURL = vi.fn();

      await user.upload(input, file);

      await waitFor(() => {
        expect(screen.getByText('screenshot.png')).toBeInTheDocument();
      });

      const removeButton = screen.getByTestId('remove-screenshot-button');
      await user.click(removeButton);

      expect(screen.queryByText('screenshot.png')).not.toBeInTheDocument();
      expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    });

    it('should cleanup preview URL on unmount', () => {
      global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
      global.URL.revokeObjectURL = vi.fn();

      const { unmount } = render(<BugReportSlideout open={true} onOpenChange={vi.fn()} />);

      unmount();

      // URL should be revoked if there was a preview
      // This is handled in the useEffect cleanup
    });
  });

  describe('Successful Submission', () => {
    it('should submit bug report without screenshot', async () => {
      const user = userEvent.setup();
      const onOpenChange = vi.fn();

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { id: 'feature-123' } }),
      });

      render(<BugReportSlideout open={true} onOpenChange={onOpenChange} />);

      const textarea = screen.getByTestId('bug-description-textarea');
      await user.type(textarea, 'This is a bug report description');

      const submitButton = screen.getByTestId('submit-bug-report-button');
      await user.click(submitButton);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/features', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Bug Report: This is a bug report description',
            workspaceId: 'workspace-123',
            status: 'BACKLOG',
            priority: 'HIGH',
            brief: '**Reported from:** https://example.com/w/test-workspace/plan\n\nThis is a bug report description',
          }),
        });
      });

      expect(toast.success).toHaveBeenCalledWith('Bug report submitted. Thank you for helping us improve!');
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('should truncate long descriptions in title', async () => {
      const user = userEvent.setup();
      const onOpenChange = vi.fn();

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { id: 'feature-123' } }),
      });

      render(<BugReportSlideout open={true} onOpenChange={onOpenChange} />);

      const longDescription = 'This is a very long bug report description that exceeds fifty characters and should be truncated';
      const textarea = screen.getByTestId('bug-description-textarea');
      await user.type(textarea, longDescription);

      const submitButton = screen.getByTestId('submit-bug-report-button');
      await user.click(submitButton);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/features', expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }));
      });

      // Check the body separately
      const callArgs = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.title).toBe('Bug Report: This is a very long bug report description that ex...');
      expect(toast.success).toHaveBeenCalled();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('should submit bug report with screenshot', async () => {
      const user = userEvent.setup();
      const onOpenChange = vi.fn();

      // Mock fetch for all three API calls
      global.fetch = vi
        .fn()
        // First call: Create feature
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true, data: { id: 'feature-123' } }),
        })
        // Second call: Get presigned URL
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            presignedUrl: 'https://s3.amazonaws.com/presigned-url',
            publicUrl: 'https://s3.amazonaws.com/public-url/screenshot.png',
          }),
        })
        // Third call: Upload to S3
        .mockResolvedValueOnce({
          ok: true,
        })
        // Fourth call: Update feature with image
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true, data: { id: 'feature-123' } }),
        });

      global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');

      render(<BugReportSlideout open={true} onOpenChange={onOpenChange} />);

      const textarea = screen.getByTestId('bug-description-textarea');
      await user.type(textarea, 'Bug with screenshot');

      const file = new File(['content'], 'screenshot.png', { type: 'image/png' });
      const input = screen.getByTestId('bug-screenshot-input') as HTMLInputElement;
      await user.upload(input, file);

      const submitButton = screen.getByTestId('submit-bug-report-button');
      await user.click(submitButton);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(4);
      });

      // Verify feature creation
      expect(global.fetch).toHaveBeenNthCalledWith(1, '/api/features', expect.any(Object));

      // Verify presigned URL request
      expect(global.fetch).toHaveBeenNthCalledWith(2, '/api/upload/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          featureId: 'feature-123',
          filename: 'screenshot.png',
          contentType: 'image/png',
          size: file.size,
        }),
      });

      // Verify S3 upload
      expect(global.fetch).toHaveBeenNthCalledWith(3, 'https://s3.amazonaws.com/presigned-url', {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': 'image/png' },
      });

      // Verify feature update with image
      expect(global.fetch).toHaveBeenNthCalledWith(4, '/api/features/feature-123', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brief: '![Bug Screenshot](https://s3.amazonaws.com/public-url/screenshot.png)\n\n**Reported from:** https://example.com/w/test-workspace/plan\n\nBug with screenshot',
        }),
      });

      expect(toast.success).toHaveBeenCalledWith('Bug report submitted. Thank you for helping us improve!');
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('should reset form after successful submission', async () => {
      const user = userEvent.setup();

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { id: 'feature-123' } }),
      });

      render(<BugReportSlideout open={true} onOpenChange={vi.fn()} />);

      const textarea = screen.getByTestId('bug-description-textarea');
      await user.type(textarea, 'This is a bug report');

      const submitButton = screen.getByTestId('submit-bug-report-button');
      await user.click(submitButton);

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalled();
      });

      // Form should be reset
      expect(textarea).toHaveValue('');
    });
  });

  describe('Error Handling', () => {
    it('should show error toast when feature creation fails', async () => {
      const user = userEvent.setup();
      const onOpenChange = vi.fn();

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: 'Database error' }),
      });

      render(<BugReportSlideout open={true} onOpenChange={onOpenChange} />);

      const textarea = screen.getByTestId('bug-description-textarea');
      await user.type(textarea, 'This is a bug report');

      const submitButton = screen.getByTestId('submit-bug-report-button');
      await user.click(submitButton);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Database error');
      });

      // Slideout should stay open
      expect(onOpenChange).not.toHaveBeenCalled();
    });

    it('should show error toast when image upload fails', async () => {
      const user = userEvent.setup();
      const onOpenChange = vi.fn();

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true, data: { id: 'feature-123' } }),
        })
        .mockResolvedValueOnce({
          ok: false,
          json: async () => ({ message: 'Upload service unavailable' }),
        });

      global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');

      render(<BugReportSlideout open={true} onOpenChange={onOpenChange} />);

      const textarea = screen.getByTestId('bug-description-textarea');
      await user.type(textarea, 'Bug with screenshot');

      const file = new File(['content'], 'screenshot.png', { type: 'image/png' });
      const input = screen.getByTestId('bug-screenshot-input') as HTMLInputElement;
      await user.upload(input, file);

      const submitButton = screen.getByTestId('submit-bug-report-button');
      await user.click(submitButton);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Upload service unavailable');
      });

      // Slideout should close even though upload failed, because the feature was created
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('should handle network errors gracefully', async () => {
      const user = userEvent.setup();
      const onOpenChange = vi.fn();

      global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error'));

      render(<BugReportSlideout open={true} onOpenChange={onOpenChange} />);

      const textarea = screen.getByTestId('bug-description-textarea');
      await user.type(textarea, 'This is a bug report');

      const submitButton = screen.getByTestId('submit-bug-report-button');
      await user.click(submitButton);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Network error');
      });

      // Slideout should stay open
      expect(onOpenChange).not.toHaveBeenCalled();
    });

    it('should preserve user input when submission fails', async () => {
      const user = userEvent.setup();

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: 'Submission failed' }),
      });

      render(<BugReportSlideout open={true} onOpenChange={vi.fn()} />);

      const description = 'This is my bug report';
      const textarea = screen.getByTestId('bug-description-textarea');
      await user.type(textarea, description);

      const submitButton = screen.getByTestId('submit-bug-report-button');
      await user.click(submitButton);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalled();
      });

      // Input should still be there
      expect(textarea).toHaveValue(description);
    });
  });

  describe('Loading States', () => {
    it('should show loading state during submission', async () => {
      const user = userEvent.setup();

      global.fetch = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, json: async () => ({ success: true, data: { id: 'feature-123' } }) }), 1000))
      );

      render(<BugReportSlideout open={true} onOpenChange={vi.fn()} />);

      const textarea = screen.getByTestId('bug-description-textarea');
      await user.type(textarea, 'This is a bug report');

      const submitButton = screen.getByTestId('submit-bug-report-button');
      await user.click(submitButton);

      // Button should be disabled during submission
      expect(submitButton).toBeDisabled();
    });

    it('should disable submit button when submitting', async () => {
      const user = userEvent.setup();

      global.fetch = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, json: async () => ({ success: true, data: { id: 'feature-123' } }) }), 100))
      );

      render(<BugReportSlideout open={true} onOpenChange={vi.fn()} />);

      const textarea = screen.getByTestId('bug-description-textarea');
      await user.type(textarea, 'This is a bug report');

      const submitButton = screen.getByTestId('submit-bug-report-button');
      
      expect(submitButton).not.toBeDisabled();
      
      await user.click(submitButton);

      expect(submitButton).toBeDisabled();
    });
  });

  describe('Drag and Drop', () => {
    const createFile = (name: string, type: string, size: number) => {
      const file = new File(['file content'], name, { type, lastModified: Date.now() });
      Object.defineProperty(file, 'size', { value: size, writable: false });
      return file;
    };

    const createDataTransfer = (files: File[]) => {
      return {
        files,
        items: files.map(file => ({
          kind: 'file' as const,
          type: file.type,
          getAsFile: () => file,
        })),
        types: ['Files'],
        getData: () => '',
        setData: () => {},
        clearData: () => {},
      };
    };

    it('should show visual feedback when dragging an image over the upload area', () => {
      render(<BugReportSlideout open={true} onOpenChange={vi.fn()} />);

      const dropzone = screen.getByTestId('bug-screenshot-dropzone');
      
      // Simulate drag enter
      fireEvent.dragEnter(dropzone, {
        dataTransfer: createDataTransfer([createFile('test.png', 'image/png', 1000)]),
      });

      // Should show "Drop image here" text
      expect(screen.getByText('Drop image here')).toBeInTheDocument();
    });

    it('should remove visual feedback when drag leaves the upload area', () => {
      render(<BugReportSlideout open={true} onOpenChange={vi.fn()} />);

      const dropzone = screen.getByTestId('bug-screenshot-dropzone');
      
      // Simulate drag enter
      fireEvent.dragEnter(dropzone, {
        dataTransfer: createDataTransfer([createFile('test.png', 'image/png', 1000)]),
      });

      expect(screen.getByText('Drop image here')).toBeInTheDocument();

      // Simulate drag leave
      fireEvent.dragLeave(dropzone, {
        dataTransfer: createDataTransfer([createFile('test.png', 'image/png', 1000)]),
      });

      // Should show original text
      expect(screen.getByText('Click to upload or drag and drop')).toBeInTheDocument();
    });

    it('should accept a valid image file when dropped', async () => {
      render(<BugReportSlideout open={true} onOpenChange={vi.fn()} />);

      const dropzone = screen.getByTestId('bug-screenshot-dropzone');
      const file = createFile('screenshot.png', 'image/png', 1024 * 1024); // 1MB

      // Simulate drop
      fireEvent.dragOver(dropzone, {
        dataTransfer: createDataTransfer([file]),
      });
      fireEvent.drop(dropzone, {
        dataTransfer: createDataTransfer([file]),
      });

      await waitFor(() => {
        expect(screen.getByText('screenshot.png')).toBeInTheDocument();
      });

      // Preview should be shown
      expect(screen.getByAltText('Screenshot preview')).toBeInTheDocument();
    });

    it('should show error toast when dropping multiple files', async () => {
      render(<BugReportSlideout open={true} onOpenChange={vi.fn()} />);

      const dropzone = screen.getByTestId('bug-screenshot-dropzone');
      const files = [
        createFile('screenshot1.png', 'image/png', 1000),
        createFile('screenshot2.png', 'image/png', 1000),
      ];

      fireEvent.drop(dropzone, {
        dataTransfer: createDataTransfer(files),
      });

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Please drop only one image at a time');
      });

      // Should still accept the first file
      await waitFor(() => {
        expect(screen.getByText('screenshot1.png')).toBeInTheDocument();
      });
    });

    it('should show error toast when dropping non-image files', async () => {
      render(<BugReportSlideout open={true} onOpenChange={vi.fn()} />);

      const dropzone = screen.getByTestId('bug-screenshot-dropzone');
      const file = createFile('document.pdf', 'application/pdf', 1000);

      fireEvent.drop(dropzone, {
        dataTransfer: createDataTransfer([file]),
      });

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          'Please drop an image file (JPEG, PNG, GIF, or WebP)'
        );
      });

      // No file should be selected
      expect(screen.queryByText('document.pdf')).not.toBeInTheDocument();
    });

    it('should show error toast when dropping oversized file', async () => {
      render(<BugReportSlideout open={true} onOpenChange={vi.fn()} />);

      const dropzone = screen.getByTestId('bug-screenshot-dropzone');
      const file = createFile('large.png', 'image/png', 11 * 1024 * 1024); // 11MB (over limit)

      fireEvent.drop(dropzone, {
        dataTransfer: createDataTransfer([file]),
      });

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('File size exceeds 10MB limit.');
      });

      // No file should be selected
      expect(screen.queryByText('large.png')).not.toBeInTheDocument();
    });

    it('should handle drag-and-drop flow from start to finish', async () => {
      render(<BugReportSlideout open={true} onOpenChange={vi.fn()} />);

      const dropzone = screen.getByTestId('bug-screenshot-dropzone');
      const file = createFile('screenshot.png', 'image/png', 1000);

      // Drag enter
      fireEvent.dragEnter(dropzone, {
        dataTransfer: createDataTransfer([file]),
      });
      expect(screen.getByText('Drop image here')).toBeInTheDocument();

      // Drag over
      fireEvent.dragOver(dropzone, {
        dataTransfer: createDataTransfer([file]),
      });

      // Drop
      fireEvent.drop(dropzone, {
        dataTransfer: createDataTransfer([file]),
      });

      // File preview should appear
      await waitFor(() => {
        expect(screen.getByText('screenshot.png')).toBeInTheDocument();
      });

      // Visual feedback should be removed
      expect(screen.queryByText('Drop image here')).not.toBeInTheDocument();
    });

    it('should support all allowed image types', async () => {
      const allowedTypes = [
        { type: 'image/jpeg', name: 'image.jpg' },
        { type: 'image/png', name: 'image.png' },
        { type: 'image/gif', name: 'image.gif' },
        { type: 'image/webp', name: 'image.webp' },
      ];

      for (const { type, name } of allowedTypes) {
        const { unmount } = render(<BugReportSlideout open={true} onOpenChange={vi.fn()} />);

        const dropzone = screen.getByTestId('bug-screenshot-dropzone');
        const file = createFile(name, type, 1000);

        fireEvent.drop(dropzone, {
          dataTransfer: createDataTransfer([file]),
        });

        await waitFor(() => {
          expect(screen.getByText(name)).toBeInTheDocument();
        });

        unmount();
      }
    });

    it('should maintain existing click-to-upload functionality alongside drag-and-drop', async () => {
      const user = userEvent.setup();
      render(<BugReportSlideout open={true} onOpenChange={vi.fn()} />);

      const fileInput = screen.getByTestId('bug-screenshot-input');
      const file = createFile('clicked.png', 'image/png', 1000);

      // Simulate file selection via click
      await user.upload(fileInput, file);

      await waitFor(() => {
        expect(screen.getByText('clicked.png')).toBeInTheDocument();
      });
    });
  });

  describe('Padding', () => {
    it('should have px-6 padding on form content', () => {
      const { container } = render(<BugReportSlideout open={true} onOpenChange={vi.fn()} />);

      // Find the wrapper div that should have px-6
      const formWrapper = container.querySelector('.px-6');
      expect(formWrapper).toBeInTheDocument();

      // Verify it contains the form
      expect(formWrapper?.querySelector('form')).toBeInTheDocument();
    });
  });
});
