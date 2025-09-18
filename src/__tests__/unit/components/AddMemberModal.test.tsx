import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AddMemberModal } from '@/components/workspace/AddMemberModal';
import { WorkspaceRole } from '@/lib/auth/roles';

// Mock dependencies
vi.mock('@/hooks/useDebounce', () => ({
  useDebounce: (value: string) => value,
}));

vi.mock('react-hook-form', () => ({
  useForm: () => ({
    control: {},
    handleSubmit: vi.fn((fn) => (e: Event) => {
      e.preventDefault();
      fn({ githubUsername: 'testuser', role: WorkspaceRole.DEVELOPER });
    }),
    reset: vi.fn(),
    setValue: vi.fn(),
    watch: vi.fn(() => 'testuser'),
  }),
}));

// Mock UI components
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: any) => open ? <div data-testid="modal">{children}</div> : null,
  DialogContent: ({ children }: any) => <div data-testid="modal-content">{children}</div>,
  DialogHeader: ({ children }: any) => <div data-testid="modal-header">{children}</div>,
  DialogTitle: ({ children }: any) => <h1>{children}</h1>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
}));

vi.mock('@/components/ui/form', () => ({
  Form: ({ children }: any) => <div data-testid="form">{children}</div>,
  FormField: ({ render }: any) => render({ field: { onChange: vi.fn(), value: '' } }),
  FormItem: ({ children }: any) => <div>{children}</div>,
  FormLabel: ({ children }: any) => <label>{children}</label>,
  FormControl: ({ children }: any) => <div>{children}</div>,
  FormDescription: ({ children }: any) => <span>{children}</span>,
  FormMessage: () => <span data-testid="form-message" />,
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: any) => <input data-testid="github-input" {...props} />,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, type }: any) => (
    <button 
      onClick={onClick} 
      disabled={disabled} 
      type={type} 
      data-testid={type === 'submit' ? 'submit-button' : 'cancel-button'}
    >
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/alert', () => ({
  Alert: ({ children, variant }: any) => (
    <div data-testid="alert" data-variant={variant}>{children}</div>
  ),
  AlertDescription: ({ children }: any) => <span data-testid="alert-description">{children}</span>,
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({ children, onValueChange, defaultValue }: any) => (
    <select data-testid="role-select" onChange={(e) => onValueChange(e.target.value)} defaultValue={defaultValue}>
      {children}
    </select>
  ),
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
}));

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children, variant }: any) => <span data-testid="badge" data-variant={variant}>{children}</span>,
}));

vi.mock('@/components/ui/avatar', () => ({
  Avatar: ({ children, className }: any) => <div className={className}>{children}</div>,
  AvatarImage: ({ src, alt }: any) => <img src={src} alt={alt} />,
  AvatarFallback: ({ children }: any) => <span>{children}</span>,
}));

describe('AddMemberModal - addMember function', () => {
  const mockProps = {
    open: true,
    onOpenChange: vi.fn(),
    workspaceSlug: 'test-workspace',
    onMemberAdded: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Successful member addition', () => {
    it('should successfully add member and execute callbacks', async () => {
      // Arrange
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          member: { id: '123', githubUsername: 'testuser', role: WorkspaceRole.DEVELOPER }
        }),
      };
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const onMemberAddedMock = vi.fn().mockResolvedValue(undefined);
      const onOpenChangeMock = vi.fn();

      // Act
      render(
        <AddMemberModal
          {...mockProps}
          onMemberAdded={onMemberAddedMock}
          onOpenChange={onOpenChangeMock}
        />
      );

      const submitButton = screen.getByTestId('submit-button');
      fireEvent.click(submitButton);

      // Assert
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/workspaces/test-workspace/members',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              githubUsername: 'testuser',
              role: WorkspaceRole.DEVELOPER,
            }),
          }
        );
      });

      await waitFor(() => {
        expect(onMemberAddedMock).toHaveBeenCalledTimes(1);
      });

      await waitFor(() => {
        expect(onOpenChangeMock).toHaveBeenCalledWith(false);
      });
    });

    it('should reset form state after successful addition', async () => {
      // Arrange
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          member: { id: '123', githubUsername: 'testuser', role: WorkspaceRole.DEVELOPER }
        }),
      };
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      // Act
      render(<AddMemberModal {...mockProps} />);
      const submitButton = screen.getByTestId('submit-button');
      fireEvent.click(submitButton);

      // Assert - verify form reset through modal closing
      await waitFor(() => {
        expect(mockProps.onOpenChange).toHaveBeenCalledWith(false);
      });
    });

    it('should handle loading state during member addition', async () => {
      // Arrange
      let resolvePromise: (value: any) => void;
      const mockPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      global.fetch = vi.fn().mockReturnValue(mockPromise);

      // Act
      render(<AddMemberModal {...mockProps} />);
      const submitButton = screen.getByTestId('submit-button');
      
      // Verify initial state
      expect(submitButton).toHaveTextContent('Add Member');
      expect(submitButton).not.toBeDisabled();

      fireEvent.click(submitButton);

      // Should show loading state immediately
      await waitFor(() => {
        const updatedButton = screen.getByTestId('submit-button');
        expect(updatedButton).toHaveTextContent('Adding...');
        expect(updatedButton).toBeDisabled();
      });

      // Complete the request
      resolvePromise!({
        ok: true,
        json: () => Promise.resolve({ member: { id: '123' } }),
      });

      // Should reset loading state
      await waitFor(() => {
        expect(mockProps.onOpenChange).toHaveBeenCalledWith(false);
      });
    });
  });

  describe('Error handling', () => {
    it('should handle API error responses', async () => {
      // Arrange
      const mockResponse = {
        ok: false,
        json: vi.fn().mockResolvedValue({
          error: 'User is already a member of this workspace',
        }),
      };
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      // Act
      render(<AddMemberModal {...mockProps} />);
      const submitButton = screen.getByTestId('submit-button');
      fireEvent.click(submitButton);

      // Assert
      await waitFor(() => {
        const alert = screen.getByTestId('alert');
        expect(alert).toBeInTheDocument();
        expect(alert).toHaveAttribute('data-variant', 'destructive');
      });

      await waitFor(() => {
        const alertDescription = screen.getByTestId('alert-description');
        expect(alertDescription).toHaveTextContent('User is already a member of this workspace');
      });

      // Should not call success callbacks
      expect(mockProps.onMemberAdded).not.toHaveBeenCalled();
      expect(mockProps.onOpenChange).not.toHaveBeenCalled();
    });

    it('should handle network failures', async () => {
      // Arrange
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      // Act
      render(<AddMemberModal {...mockProps} />);
      const submitButton = screen.getByTestId('submit-button');
      fireEvent.click(submitButton);

      // Assert
      await waitFor(() => {
        const alert = screen.getByTestId('alert');
        expect(alert).toBeInTheDocument();
      });

      await waitFor(() => {
        const alertDescription = screen.getByTestId('alert-description');
        expect(alertDescription).toHaveTextContent('Network error');
      });

      // Should not call success callbacks
      expect(mockProps.onMemberAdded).not.toHaveBeenCalled();
      expect(mockProps.onOpenChange).not.toHaveBeenCalled();
    });

    it('should handle API responses without error message', async () => {
      // Arrange
      const mockResponse = {
        ok: false,
        json: vi.fn().mockResolvedValue({}),
      };
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      // Act
      render(<AddMemberModal {...mockProps} />);
      const submitButton = screen.getByTestId('submit-button');
      fireEvent.click(submitButton);

      // Assert
      await waitFor(() => {
        const alertDescription = screen.getByTestId('alert-description');
        expect(alertDescription).toHaveTextContent('Failed to add member');
      });
    });

    it('should handle non-Error exceptions', async () => {
      // Arrange
      global.fetch = vi.fn().mockRejectedValue('String error');

      // Act
      render(<AddMemberModal {...mockProps} />);
      const submitButton = screen.getByTestId('submit-button');
      fireEvent.click(submitButton);

      // Assert
      await waitFor(() => {
        const alertDescription = screen.getByTestId('alert-description');
        expect(alertDescription).toHaveTextContent('Failed to add member');
      });
    });

    it('should reset loading state after error', async () => {
      // Arrange
      global.fetch = vi.fn().mockRejectedValue(new Error('API Error'));

      // Act
      render(<AddMemberModal {...mockProps} />);
      const submitButton = screen.getByTestId('submit-button');
      fireEvent.click(submitButton);

      // Verify loading state appears
      await waitFor(() => {
        expect(submitButton).toHaveTextContent('Adding...');
        expect(submitButton).toBeDisabled();
      });

      // Verify loading state is reset after error
      await waitFor(() => {
        const updatedButton = screen.getByTestId('submit-button');
        expect(updatedButton).toHaveTextContent('Add Member');
        expect(updatedButton).not.toBeDisabled();
      });
    });
  });

  describe('State reset functionality', () => {
    it('should reset all form states when handleClose is called', async () => {
      // Arrange
      render(<AddMemberModal {...mockProps} />);

      // Act - trigger close via cancel button
      const cancelButton = screen.getByTestId('cancel-button');
      fireEvent.click(cancelButton);

      // Assert - verify modal close callback
      expect(mockProps.onOpenChange).toHaveBeenCalledWith(false);
    });

    it('should clear error state on new submission', async () => {
      // Arrange - first create an error
      global.fetch = vi.fn().mockRejectedValueOnce(new Error('First error'));

      render(<AddMemberModal {...mockProps} />);
      const submitButton = screen.getByTestId('submit-button');
      
      // Create error
      fireEvent.click(submitButton);
      await waitFor(() => {
        expect(screen.getByTestId('alert')).toBeInTheDocument();
      });

      // Act - make successful request
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ member: { id: '123' } }),
      });

      fireEvent.click(submitButton);

      // Assert - error should be cleared and success should occur
      await waitFor(() => {
        expect(mockProps.onOpenChange).toHaveBeenCalledWith(false);
      });
    });
  });

  describe('Business logic validation', () => {
    it('should make API call with correct payload structure', async () => {
      // Arrange
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ member: { id: '123' } }),
      });

      // Act
      render(<AddMemberModal {...mockProps} />);
      const submitButton = screen.getByTestId('submit-button');
      fireEvent.click(submitButton);

      // Assert
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/workspaces/test-workspace/members',
          expect.objectContaining({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              githubUsername: 'testuser',
              role: WorkspaceRole.DEVELOPER,
            }),
          })
        );
      });
    });

    it('should handle different workspace slugs correctly', async () => {
      // Arrange
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ member: { id: '123' } }),
      });

      const customProps = { ...mockProps, workspaceSlug: 'custom-workspace-123' };

      // Act
      render(<AddMemberModal {...customProps} />);
      const submitButton = screen.getByTestId('submit-button');
      fireEvent.click(submitButton);

      // Assert
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/workspaces/custom-workspace-123/members',
          expect.any(Object)
        );
      });
    });

    it('should handle callback execution order correctly', async () => {
      // Arrange
      const callOrder: string[] = [];
      
      const onMemberAddedMock = vi.fn().mockImplementation(async () => {
        callOrder.push('onMemberAdded');
      });
      
      const onOpenChangeMock = vi.fn().mockImplementation(() => {
        callOrder.push('onOpenChange');
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ member: { id: '123' } }),
      });

      // Act
      render(
        <AddMemberModal
          {...mockProps}
          onMemberAdded={onMemberAddedMock}
          onOpenChange={onOpenChangeMock}
        />
      );

      const submitButton = screen.getByTestId('submit-button');
      fireEvent.click(submitButton);

      // Assert
      await waitFor(() => {
        expect(callOrder).toEqual(['onMemberAdded', 'onOpenChange']);
      });
    });
  });

  describe('Edge cases', () => {
    it('should handle component unmounting during API call', async () => {
      // Arrange
      let resolvePromise: (value: any) => void;
      const mockPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      global.fetch = vi.fn().mockReturnValue(mockPromise);

      // Act
      const { unmount } = render(<AddMemberModal {...mockProps} />);
      const submitButton = screen.getByTestId('submit-button');
      fireEvent.click(submitButton);

      // Unmount before API resolves
      unmount();

      // Complete the API call
      resolvePromise!({
        ok: true,
        json: () => Promise.resolve({ member: { id: '123' } }),
      });

      // Assert - should not throw errors
      await new Promise(resolve => setTimeout(resolve, 100));
      // Note: The onMemberAdded callback may still be called because the API resolved successfully
      // This is expected behavior - the test is mainly to verify no errors are thrown
    });

    it('should handle malformed API responses', async () => {
      // Arrange
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: vi.fn().mockRejectedValue(new Error('Invalid JSON')),
      });

      // Act
      render(<AddMemberModal {...mockProps} />);
      const submitButton = screen.getByTestId('submit-button');
      fireEvent.click(submitButton);

      // Assert
      await waitFor(() => {
        const alertDescription = screen.getByTestId('alert-description');
        expect(alertDescription).toHaveTextContent('Invalid JSON');
      });
    });

    it('should handle onMemberAdded callback errors', async () => {
      // Arrange
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ member: { id: '123' } }),
      });

      const onMemberAddedMock = vi.fn().mockRejectedValue(new Error('Callback error'));

      // Act
      render(
        <AddMemberModal
          {...mockProps}
          onMemberAdded={onMemberAddedMock}
        />
      );

      const submitButton = screen.getByTestId('submit-button');
      fireEvent.click(submitButton);

      // Assert - should handle callback error gracefully
      await waitFor(() => {
        const alertDescription = screen.getByTestId('alert-description');
        expect(alertDescription).toHaveTextContent('Callback error');
      });
    });

    it('should prevent multiple simultaneous submissions', async () => {
      // Arrange
      let resolvePromise: (value: any) => void;
      const mockPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      global.fetch = vi.fn().mockReturnValue(mockPromise);

      // Act
      render(<AddMemberModal {...mockProps} />);
      const submitButton = screen.getByTestId('submit-button');
      
      // First submission
      fireEvent.click(submitButton);
      
      await waitFor(() => {
        expect(submitButton).toBeDisabled();
      });

      // Try second submission while first is pending
      fireEvent.click(submitButton);

      // Complete first request
      resolvePromise!({
        ok: true,
        json: () => Promise.resolve({ member: { id: '123' } }),
      });

      // Assert - should only make one API call
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(1);
      });
    });

    it('should handle empty workspace slug gracefully', async () => {
      // Arrange
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ member: { id: '123' } }),
      });

      const emptySlugProps = { ...mockProps, workspaceSlug: '' };

      // Act
      render(<AddMemberModal {...emptySlugProps} />);
      const submitButton = screen.getByTestId('submit-button');
      fireEvent.click(submitButton);

      // Assert
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/workspaces//members',
          expect.any(Object)
        );
      });
    });
  });

  describe('Form validation edge cases', () => {
    it('should handle form submission with empty github username', () => {
      // This test verifies the component handles the disabled state correctly
      // when githubUsername is empty (controlled by form.watch return value)

      // Mock useForm to return empty username
      vi.mocked(require('react-hook-form').useForm).mockReturnValue({
        control: {},
        handleSubmit: vi.fn(),
        reset: vi.fn(),
        setValue: vi.fn(),
        watch: vi.fn(() => ''), // Empty username
      });

      render(<AddMemberModal {...mockProps} />);
      const submitButton = screen.getByTestId('submit-button');
      
      // Submit button should be disabled when no username
      expect(submitButton).toBeDisabled();
    });

    it('should handle different workspace roles', async () => {
      // Arrange
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ member: { id: '123' } }),
      });

      // Mock form with admin role
      vi.mocked(require('react-hook-form').useForm).mockReturnValue({
        control: {},
        handleSubmit: vi.fn((fn) => () => {
          fn({ githubUsername: 'testuser', role: WorkspaceRole.ADMIN });
        }),
        reset: vi.fn(),
        setValue: vi.fn(),
        watch: vi.fn(() => 'testuser'),
      });

      // Act
      render(<AddMemberModal {...mockProps} />);
      const submitButton = screen.getByTestId('submit-button');
      fireEvent.click(submitButton);

      // Assert
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            body: JSON.stringify({
              githubUsername: 'testuser',
              role: WorkspaceRole.ADMIN,
            }),
          })
        );
      });
    });
  });
});