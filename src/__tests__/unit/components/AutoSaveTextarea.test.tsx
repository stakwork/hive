import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AutoSaveTextarea } from '@/components/features/AutoSaveTextarea';
import { filterBase64FromDisplay } from '@/lib/utils/text-filters';

// Verify the function is available
beforeAll(() => {
  if (typeof filterBase64FromDisplay !== 'function') {
    throw new Error('filterBase64FromDisplay is not a function');
  }
});

// Mock the useImageUpload hook
vi.mock('@/hooks/useImageUpload', () => ({
  useImageUpload: () => ({
    isDragging: false,
    isUploading: false,
    handleDragEnter: vi.fn(),
    handleDragLeave: vi.fn(),
    handleDragOver: vi.fn(),
    handleDrop: vi.fn(),
    handlePaste: vi.fn(),
  }),
}));

describe('AutoSaveTextarea', () => {
  const defaultProps = {
    id: 'test-textarea',
    label: 'Test Field',
    value: '',
    savedField: null,
    saving: false,
    saved: false,
    onChange: vi.fn(),
    onBlur: vi.fn(),
  };

  it('should display [Image] placeholder when value contains base64', () => {
    const base64Content = 'Some text ![screenshot](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==) more text';
    
    render(
      <AutoSaveTextarea
        {...defaultProps}
        value={base64Content}
      />
    );

    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveValue('Some text ![screenshot][Image] more text');
  });

  it('should display multiple [Image] placeholders for multiple base64 images', () => {
    const content = '![img1](data:image/png;base64,ABC123) text ![img2](data:image/jpeg;base64,XYZ789)';
    
    render(
      <AutoSaveTextarea
        {...defaultProps}
        value={content}
      />
    );

    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveValue('![img1][Image] text ![img2][Image]');
  });

  it('should not filter S3 URLs', () => {
    const content = 'Text ![s3image](https://s3.amazonaws.com/bucket/image.png) more text';
    
    render(
      <AutoSaveTextarea
        {...defaultProps}
        value={content}
      />
    );

    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveValue(content);
  });

  it('should preserve alt text in placeholder', () => {
    const content = '![My Screenshot](data:image/png;base64,ABC123)';
    
    render(
      <AutoSaveTextarea
        {...defaultProps}
        value={content}
      />
    );

    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveValue('![My Screenshot][Image]');
  });

  it('should handle typing text normally without base64 interference', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    
    // Use a wrapper to properly handle state updates
    const TestWrapper = () => {
      const [value, setValue] = React.useState('');
      
      return (
        <AutoSaveTextarea
          {...defaultProps}
          value={value}
          onChange={(newValue) => {
            setValue(newValue);
            onChange(newValue);
          }}
        />
      );
    };
    
    render(<TestWrapper />);

    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'Hello world');

    // user.type() triggers onChange for each keystroke
    expect(onChange).toHaveBeenCalled();
    // Check the last call has the full text
    expect(onChange).toHaveBeenLastCalledWith('Hello world');
  });

  it('should preserve complete value with base64 on blur', async () => {
    const user = userEvent.setup();
    const onBlur = vi.fn();
    const base64Content = '![screenshot](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==)';
    
    render(
      <AutoSaveTextarea
        {...defaultProps}
        value={base64Content}
        onBlur={onBlur}
      />
    );

    const textarea = screen.getByRole('textbox');
    await user.click(textarea);
    await user.tab(); // Trigger blur

    expect(onBlur).toHaveBeenCalledWith(base64Content);
  });

  it('should handle null value gracefully', () => {
    render(
      <AutoSaveTextarea
        {...defaultProps}
        value={null}
      />
    );

    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveValue('');
  });

  it('should handle empty string value', () => {
    render(
      <AutoSaveTextarea
        {...defaultProps}
        value=""
      />
    );

    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveValue('');
  });

  it('should show ImagePreview when enableImageUpload is true and featureId is provided', () => {
    render(
      <AutoSaveTextarea
        {...defaultProps}
        enableImageUpload={true}
        featureId="test-feature-id"
        value="![test](https://example.com/image.png)"
      />
    );

    // ImagePreview component should be rendered and show "Uploaded Images"
    expect(screen.getByText(/Uploaded Images/i)).toBeInTheDocument();
  });

  it('should not show ImagePreview when enableImageUpload is false', () => {
    const { container } = render(
      <AutoSaveTextarea
        {...defaultProps}
        enableImageUpload={false}
        value="![test](https://example.com/image.png)"
      />
    );

    // ImagePreview should not be rendered
    expect(container.querySelector('[class*="image"]')).toBeFalsy();
  });

  it('should filter mixed content with text, S3 URLs, and base64', () => {
    const content = `
# Bug Report

Here's the issue:

![s3-screenshot](https://s3.amazonaws.com/bucket/screen1.png)

Some description text here.

![base64-screenshot](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==)

More text after the image.
    `;
    
    render(
      <AutoSaveTextarea
        {...defaultProps}
        value={content}
      />
    );

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    const displayValue = textarea.value;
    
    expect(displayValue).toContain('![s3-screenshot](https://s3.amazonaws.com/bucket/screen1.png)');
    expect(displayValue).toContain('![base64-screenshot][Image]');
    expect(displayValue).toContain('# Bug Report');
    expect(displayValue).toContain('More text after the image.');
  });

  it('should show listening placeholder when isListening is true', () => {
    render(
      <AutoSaveTextarea
        {...defaultProps}
        isListening={true}
      />
    );

    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveAttribute('placeholder', 'Listening...');
  });

  it('should show transcript in placeholder when listening with transcript', () => {
    render(
      <AutoSaveTextarea
        {...defaultProps}
        isListening={true}
        transcript="This is what I'm hearing"
      />
    );

    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveAttribute('placeholder', "This is what I'm hearing...");
  });

  it('should call onFocus when textarea is focused', async () => {
    const user = userEvent.setup();
    const onFocus = vi.fn();
    
    render(
      <AutoSaveTextarea
        {...defaultProps}
        onFocus={onFocus}
      />
    );

    const textarea = screen.getByRole('textbox');
    await user.click(textarea);

    expect(onFocus).toHaveBeenCalled();
  });
});
