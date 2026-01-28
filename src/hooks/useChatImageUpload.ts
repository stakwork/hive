import { useState, DragEvent, ClipboardEvent } from 'react';

interface UseChatImageUploadOptions {
  taskId: string;
  onImageAdded?: (file: File, s3Path: string) => void;
  onError?: (error: string) => void;
}

interface ImageUploadResult {
  isDragging: boolean;
  isUploading: boolean;
  error: string | null;
  handleDragEnter: (e: DragEvent<HTMLTextAreaElement>) => void;
  handleDragLeave: (e: DragEvent<HTMLTextAreaElement>) => void;
  handleDragOver: (e: DragEvent<HTMLTextAreaElement>) => void;
  handleDrop: (e: DragEvent<HTMLTextAreaElement>) => void;
  handlePaste: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
  uploadImage: (file: File) => Promise<{ s3Path: string; presignedUrl: string } | null>;
}

export function useChatImageUpload({
  taskId,
  onImageAdded,
  onError,
}: UseChatImageUploadOptions): ImageUploadResult {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uploadImage = async (file: File): Promise<{ s3Path: string; presignedUrl: string } | null> => {
    try {
      // Request presigned URL from backend
      const response = await fetch('/api/upload/presigned-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          size: file.size,
          taskId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to get upload URL');
      }

      const { presignedUrl, s3Path } = await response.json();

      // Upload file directly to S3
      const uploadResponse = await fetch(presignedUrl, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type,
        },
      });

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload image to S3');
      }

      return { s3Path, presignedUrl };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to upload image';
      setError(errorMsg);
      if (onError) onError(errorMsg);
      console.error('Image upload error:', err);
      return null;
    }
  };

  const processFiles = async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const imageFiles = fileArray.filter(file => file.type.startsWith('image/'));
    
    if (imageFiles.length === 0) {
      const errorMsg = 'No valid image files found. Please drop image files only.';
      setError(errorMsg);
      if (onError) onError(errorMsg);
      return;
    }

    setIsUploading(true);
    setError(null);

    for (const file of imageFiles) {
      const result = await uploadImage(file);
      if (result && onImageAdded) {
        onImageAdded(file, result.s3Path);
      }
    }

    setIsUploading(false);
  };

  const handleDragEnter = (e: DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Only set dragging to false if we're leaving the textarea element itself
    if (e.currentTarget === e.target) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      processFiles(files);
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData.items;
    const files: File[] = [];

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) {
          files.push(file);
        }
      }
    }

    if (files.length > 0) {
      e.preventDefault();
      processFiles(files);
    }
  };

  return {
    isDragging,
    isUploading,
    error,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handlePaste,
    uploadImage,
  };
}
