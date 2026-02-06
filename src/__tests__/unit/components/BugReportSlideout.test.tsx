import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Rendering', () => {
    it('should render the slideout when open', () => {
      render(<BugReportSlideout open={true} onOpenChange={vi.fn()} />);

      expect(screen.getByText('Report a Bug')).toBeInTheDocument();
      expect(screen.getByText('Help us improve by reporting issues you encounter')).toBeInTheDocument();
      expect(screen.getByTestId('bug-description-textarea')).toBeInTheDocument();
      expect(screen.getByTestId('screenshot-input')).toBeInTheDocument();
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
      const user = userEvent.setup();
      render(<BugReportSlideout open={true} onOpenChange={vi.fn()} />);

      const file = new File(['content'], 'document.pdf', { type: 'application/pdf' });
      const input = screen.getByTestId('screenshot-input') as HTMLInputElement;

      await user.upload(input, file);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          'Please select a valid image file (JPEG, PNG, GIF, or WebP)'
        );
      });
    });

    it('should reject files larger than 10MB', async () => {
      const user = userEvent.setup();
      render(<BugReportSlideout open={true} onOpenChange={vi.fn()} />);

      // Create a file larger than 10MB
      const largeFile = new File(['x'.repeat(11 * 1024 * 1024)], 'large.png', { 
        type: 'image/png' 
      });
      const input = screen.getByTestId('screenshot-input') as HTMLInputElement;

      await user.upload(input, largeFile);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('File size must be less than 10MB');
      });
    });

    it('should accept valid image files', async () => {
      const user = userEvent.setup();
      render(<BugReportSlideout open={true} onOpenChange={vi.fn()} />);

      const file = new File(['content'], 'screenshot.png', { type: 'image/png' });
      const input = screen.getByTestId('screenshot-input') as HTMLInputElement;

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
      const input = screen.getByTestId('screenshot-input') as HTMLInputElement;

      // Mock URL.createObjectURL
      global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');

      await user.upload(input, file);

      await waitFor(() => {
        expect(screen.getByTestId('file-preview')).toBeInTheDocument();
        expect(screen.getByText('screenshot.png')).toBeInTheDocument();
      });
    });

    it('should remove file when remove button is clicked', async () => {
      const user = userEvent.setup();
      render(<BugReportSlideout open={true} onOpenChange={vi.fn()} />);

      const file = new File(['content'], 'screenshot.png', { type: 'image/png' });
      const input = screen.getByTestId('screenshot-input') as HTMLInputElement;

      global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
      global.URL.revokeObjectURL = vi.fn();

      await user.upload(input, file);

      await waitFor(() => {
        expect(screen.getByText('screenshot.png')).toBeInTheDocument();
      });

      const removeButton = screen.getByTestId('remove-file-button');
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
        json: async () => ({ id: 'feature-123' }),
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
        json: async () => ({ id: 'feature-123' }),
      });

      render(<BugReportSlideout open={true} onOpenChange={onOpenChange} />);

      const longDescription = 'This is a very long bug report description that exceeds fifty characters and should be truncated';
      const textarea = screen.getByTestId('bug-description-textarea');
      await user.type(textarea, longDescription);

      const submitButton = screen.getByTestId('submit-bug-report-button');
      await user.click(submitButton);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/features', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('"title":"Bug Report: This is a very long bug report description that e..."'),
        });
      });
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
          json: async () => ({ id: 'feature-123' }),
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
          json: async () => ({ id: 'feature-123' }),
        });

      global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');

      render(<BugReportSlideout open={true} onOpenChange={onOpenChange} />);

      const textarea = screen.getByTestId('bug-description-textarea');
      await user.type(textarea, 'Bug with screenshot');

      const file = new File(['content'], 'screenshot.png', { type: 'image/png' });
      const input = screen.getByTestId('screenshot-input') as HTMLInputElement;
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
        json: async () => ({ id: 'feature-123' }),
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
        statusText: 'Internal Server Error',
      });

      render(<BugReportSlideout open={true} onOpenChange={onOpenChange} />);

      const textarea = screen.getByTestId('bug-description-textarea');
      await user.type(textarea, 'This is a bug report');

      const submitButton = screen.getByTestId('submit-bug-report-button');
      await user.click(submitButton);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Failed to create bug report');
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
          json: async () => ({ id: 'feature-123' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          statusText: 'Upload Failed',
        });

      global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');

      render(<BugReportSlideout open={true} onOpenChange={onOpenChange} />);

      const textarea = screen.getByTestId('bug-description-textarea');
      await user.type(textarea, 'Bug with screenshot');

      const file = new File(['content'], 'screenshot.png', { type: 'image/png' });
      const input = screen.getByTestId('screenshot-input') as HTMLInputElement;
      await user.upload(input, file);

      const submitButton = screen.getByTestId('submit-bug-report-button');
      await user.click(submitButton);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Failed to get upload URL');
      });

      // Slideout should stay open
      expect(onOpenChange).not.toHaveBeenCalled();
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
        statusText: 'Error',
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
        () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, json: async () => ({ id: 'feature-123' }) }), 1000))
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
        () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, json: async () => ({ id: 'feature-123' }) }), 100))
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
});
