import { useState, DragEvent, ClipboardEvent } from 'react';
import { useFileDrop } from './useFileDrop';

interface UseImageUploadOptions {
  featureId: string;
  onImageInserted?: (markdownImage: string) => void;
  onError?: (error: string) => void;
  disabled?: boolean;
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
  insertImageAtCursor: (url: string, filename: string, textarea: HTMLTextAreaElement) => void;
}

export function useImageUpload({
  featureId,
  onImageInserted,
  onError,
  disabled = false,
}: UseImageUploadOptions): ImageUploadResult {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uploadImage = async (file: File): Promise<string> => {
    const response = await fetch('/api/upload/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type,
        size: file.size,
        featureId,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to get upload URL');
    }

    const { presignedUrl, publicUrl } = await response.json();

    const uploadResponse = await fetch(presignedUrl, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type },
    });

    if (!uploadResponse.ok) {
      throw new Error('Failed to upload image to S3');
    }

    return publicUrl;
  };

  const insertImageAtCursor = (
    url: string,
    filename: string,
    textarea: HTMLTextAreaElement
  ) => {
    const cursorPos = textarea.selectionStart;
    const textBefore = textarea.value.substring(0, cursorPos);
    const textAfter = textarea.value.substring(cursorPos);

    const markdownImage = `![${filename}](${url})`;
    const newValue = textBefore + markdownImage + textAfter;

    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(textarea, newValue);
      const event = new Event('input', { bubbles: true });
      textarea.dispatchEvent(event);
      const newCursorPos = cursorPos + markdownImage.length;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
      textarea.focus();
    }

    if (onImageInserted) {
      onImageInserted(markdownImage);
    }
  };

  const processFiles = async (files: FileList | File[], textarea: HTMLTextAreaElement) => {
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
      try {
        const imageUrl = await uploadImage(file);
        insertImageAtCursor(imageUrl, file.name, textarea);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to upload image';
        setError(errorMsg);
        if (onError) onError(errorMsg);
        console.error('Image upload error:', err);
      }
    }

    setIsUploading(false);
  };

  const { isDragging, dragProps } = useFileDrop<HTMLTextAreaElement>({
    disabled,
    onDrop: (files, e) => {
      processFiles(files, e.currentTarget);
    },
  });

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData.items;
    const files: File[] = [];

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) files.push(file);
      }
    }

    if (files.length > 0) {
      e.preventDefault();
      processFiles(files, e.currentTarget);
    }
  };

  return {
    isDragging,
    isUploading,
    error,
    handleDragEnter: dragProps.onDragEnter,
    handleDragLeave: dragProps.onDragLeave,
    handleDragOver: dragProps.onDragOver,
    handleDrop: dragProps.onDrop,
    handlePaste,
    insertImageAtCursor,
  };
}
