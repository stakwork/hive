import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as NextAuth from 'next-auth/react';
import { VoiceSignatureSettings } from '@/components/settings/VoiceSignatureSettings';
import { toast } from 'sonner';

// Mock modules
vi.mock('next-auth/react');
vi.mock('sonner');
vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: any) => <div data-testid="card">{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <h3>{children}</h3>,
  CardDescription: ({ children }: any) => <p>{children}</p>,
  CardContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: any) => (open ? <div data-testid="dialog">{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));

describe('VoiceSignatureSettings', () => {
  let mockUpdate: ReturnType<typeof vi.fn>;
  let mockMediaRecorder: any;
  let mockStream: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockUpdate = vi.fn();
    
    // Mock fetch
    global.fetch = vi.fn();
    
    // Mock MediaRecorder
    mockStream = {
      getTracks: vi.fn(() => [{ stop: vi.fn() }]),
    };
    
    mockMediaRecorder = {
      start: vi.fn(),
      stop: vi.fn(),
      ondataavailable: null,
      onstop: null,
      state: 'inactive',
    };
    
    global.MediaRecorder = vi.fn(() => mockMediaRecorder) as any;
    (global.MediaRecorder as any).isTypeSupported = vi.fn(() => true);
    
    // Mock getUserMedia
    global.navigator.mediaDevices = {
      getUserMedia: vi.fn().mockResolvedValue(mockStream),
    } as any;
    
    // Mock URL.createObjectURL and revokeObjectURL
    global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = vi.fn();
  });

  describe('idle state', () => {
    it('should render with "No voice signature" badge when user has no signature', () => {
      vi.mocked(NextAuth.useSession).mockReturnValue({
        data: { user: { id: 'user-123', hasVoiceSignature: false } } as any,
        status: 'authenticated',
        update: mockUpdate,
      });

      render(<VoiceSignatureSettings />);

      expect(screen.getByText('Voice Signature')).toBeInTheDocument();
      expect(screen.getByText('No voice signature')).toBeInTheDocument();
      expect(screen.getByText('Record')).toBeInTheDocument();
      expect(screen.queryByText('Delete')).not.toBeInTheDocument();
    });

    it('should render with "Voice signature on file" badge when user has a signature', () => {
      vi.mocked(NextAuth.useSession).mockReturnValue({
        data: { user: { id: 'user-123', hasVoiceSignature: true } } as any,
        status: 'authenticated',
        update: mockUpdate,
      });

      render(<VoiceSignatureSettings />);

      expect(screen.getByText('Voice signature on file')).toBeInTheDocument();
      expect(screen.getByText('Record')).toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });
  });

  describe('recording state', () => {
    it('should open modal and start recording when Record button is clicked', async () => {
      vi.mocked(NextAuth.useSession).mockReturnValue({
        data: { user: { id: 'user-123', hasVoiceSignature: false } } as any,
        status: 'authenticated',
        update: mockUpdate,
      });

      render(<VoiceSignatureSettings />);

      const recordButton = screen.getByText('Record');
      await userEvent.click(recordButton);

      await waitFor(() => {
        expect(screen.getByText('Recording Voice Signature')).toBeInTheDocument();
        expect(mockMediaRecorder.start).toHaveBeenCalled();
      });
    });

    it('should display the scripted prompt text', async () => {
      vi.mocked(NextAuth.useSession).mockReturnValue({
        data: { user: { id: 'user-123', hasVoiceSignature: false } } as any,
        status: 'authenticated',
        update: mockUpdate,
      });

      render(<VoiceSignatureSettings />);

      const recordButton = screen.getByText('Record');
      await userEvent.click(recordButton);

      await waitFor(() => {
        expect(screen.getByText(/I am recording this audio/i)).toBeInTheDocument();
        expect(screen.getByText(/birch canoe/i)).toBeInTheDocument();
      });
    });

    it('should handle microphone permission denial', async () => {
      vi.mocked(NextAuth.useSession).mockReturnValue({
        data: { user: { id: 'user-123', hasVoiceSignature: false } } as any,
        status: 'authenticated',
        update: mockUpdate,
      });

      const error = new Error('Permission denied');
      (global.navigator.mediaDevices.getUserMedia as any).mockRejectedValueOnce(error);

      render(<VoiceSignatureSettings />);

      const recordButton = screen.getByText('Record');
      await userEvent.click(recordButton);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          'Microphone access denied. Please allow microphone access and try again.'
        );
      });
    });
  });

  describe('review state', () => {
    it('should transition to review state when Done is clicked', async () => {
      vi.mocked(NextAuth.useSession).mockReturnValue({
        data: { user: { id: 'user-123', hasVoiceSignature: false } } as any,
        status: 'authenticated',
        update: mockUpdate,
      });

      render(<VoiceSignatureSettings />);

      const recordButton = screen.getByText('Record');
      await userEvent.click(recordButton);

      await waitFor(() => {
        expect(mockMediaRecorder.start).toHaveBeenCalled();
      });

      const doneButton = screen.getByText('Done');
      await userEvent.click(doneButton);

      // Simulate MediaRecorder events
      const mockBlob = new Blob(['audio data'], { type: 'audio/wav' });
      mockMediaRecorder.ondataavailable?.({ data: mockBlob } as BlobEvent);
      mockMediaRecorder.onstop?.({} as Event);

      await waitFor(() => {
        expect(screen.getByText('Review Recording')).toBeInTheDocument();
        expect(screen.getByText('Re-record')).toBeInTheDocument();
        expect(screen.getByText('Save')).toBeInTheDocument();
      });
    });

    it('should return to recording state when Re-record is clicked', async () => {
      vi.mocked(NextAuth.useSession).mockReturnValue({
        data: { user: { id: 'user-123', hasVoiceSignature: false } } as any,
        status: 'authenticated',
        update: mockUpdate,
      });

      render(<VoiceSignatureSettings />);

      // Start recording
      await userEvent.click(screen.getByText('Record'));
      await waitFor(() => expect(mockMediaRecorder.start).toHaveBeenCalled());

      // Move to review
      await userEvent.click(screen.getByText('Done'));
      const mockBlob = new Blob(['audio data'], { type: 'audio/wav' });
      mockMediaRecorder.ondataavailable?.({ data: mockBlob } as BlobEvent);
      mockMediaRecorder.onstop?.({} as Event);

      await waitFor(() => expect(screen.getByText('Review Recording')).toBeInTheDocument());

      // Re-record
      await userEvent.click(screen.getByText('Re-record'));

      await waitFor(() => {
        expect(screen.getByText('Recording Voice Signature')).toBeInTheDocument();
      });
    });
  });

  describe('saving state', () => {
    it('should call the API endpoints when Save is clicked', async () => {
      vi.mocked(NextAuth.useSession).mockReturnValue({
        data: { user: { id: 'user-123', hasVoiceSignature: false } } as any,
        status: 'authenticated',
        update: mockUpdate,
      });

      const mockFetch = global.fetch as any;
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            presignedUrl: 'https://s3.aws.com/upload',
            s3Path: 'voice-signatures/user-123/signature.wav',
          }),
        })
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ success: true }) });

      render(<VoiceSignatureSettings />);

      // Record
      await userEvent.click(screen.getByText('Record'));
      await waitFor(() => expect(mockMediaRecorder.start).toHaveBeenCalled());

      // Done
      await userEvent.click(screen.getByText('Done'));
      const mockBlob = new Blob(['audio data'], { type: 'audio/wav' });
      mockMediaRecorder.ondataavailable?.({ data: mockBlob } as BlobEvent);
      mockMediaRecorder.onstop?.({} as Event);

      await waitFor(() => expect(screen.getByText('Save')).toBeInTheDocument());

      // Save
      await userEvent.click(screen.getByText('Save'));

      // Verify API calls
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/user/voice-signature',
          expect.objectContaining({ method: 'POST' })
        );
      }, { timeout: 3000 });
    });
  });

  describe('delete functionality', () => {
    it('should call DELETE endpoint when Delete button is clicked', async () => {
      vi.mocked(NextAuth.useSession).mockReturnValue({
        data: { user: { id: 'user-123', hasVoiceSignature: true } } as any,
        status: 'authenticated',
        update: mockUpdate,
      });

      const mockFetch = global.fetch as any;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true }),
      });

      render(<VoiceSignatureSettings />);

      const deleteButton = screen.getByText('Delete');
      await userEvent.click(deleteButton);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/user/voice-signature', {
          method: 'DELETE',
        });
      }, { timeout: 3000 });
    });
  });
});
