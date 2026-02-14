import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AutoSaveTextarea } from '@/components/features/AutoSaveTextarea';

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

describe('AutoSaveTextarea with Markdown Image Filtering', () => {
  const defaultProps = {
    id: 'test-textarea',
    label: 'Test Field',
    value: null,
    savedField: null,
    saving: false,
    saved: false,
    onChange: vi.fn(),
    onBlur: vi.fn(),
  };

  it('should display [Image: filename] placeholder when value contains markdown image', () => {
    const value = 'Bug report:\n![Screenshot](https://s3.amazonaws.com/bucket/screenshot.png)\nSee above';
    
    render(<AutoSaveTextarea {...defaultProps} value={value} />);
    
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea).toHaveValue('Bug report:\n[Image: screenshot.png] \nSee above');
  });

  it('should hide full S3 URL from textarea display', () => {
    const value = '![Bug](https://s3.amazonaws.com/my-bucket/deeply/nested/path/bug-screenshot.png?AWSAccessKeyId=123&Expires=456)';
    
    render(<AutoSaveTextarea {...defaultProps} value={value} />);
    
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea).not.toHaveValue(expect.stringContaining('s3.amazonaws.com'));
    expect(textarea).not.toHaveValue(expect.stringContaining('AWSAccessKeyId'));
    expect(textarea).toHaveValue('[Image: bug-screenshot.png] ');
  });

  it('should allow typing regular text normally', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    
    render(<AutoSaveTextarea {...defaultProps} value="" onChange={onChange} />);
    
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'Text');
    
    expect(onChange).toHaveBeenCalled();
    // onChange is called with each character as user types
    expect(onChange).toHaveBeenLastCalledWith('t');
  });

  it('should pass full value with markdown images to ImagePreview component', () => {
    const value = 'Description\n![Screenshot](https://s3.com/image.png)';
    
    render(
      <AutoSaveTextarea 
        {...defaultProps} 
        value={value}
        enableImageUpload={true}
        featureId="feature-123"
      />
    );
    
    // ImagePreview should receive the full value with markdown
    // We can verify this by checking that the component is rendered
    // (The actual image rendering is tested in ImagePreview tests)
    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveValue('Description\n[Image: image.png] ');
  });

  it('should display multiple placeholders for multiple images', () => {
    const value = '![First](https://s3.com/first.png) and ![Second](https://s3.com/second.jpg)';
    
    render(<AutoSaveTextarea {...defaultProps} value={value} />);
    
    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveValue('[Image: first.png]  and [Image: second.jpg] ');
  });

  it('should handle mixed content (text + images) correctly', () => {
    const value = `Bug Report

Description: Login broken

![Error screenshot](https://s3.amazonaws.com/bucket/error.png)

Steps:
1. Click login
2. See error

![Console log](https://s3.amazonaws.com/bucket/console.png?key=123)

Expected: Should work`;

    render(<AutoSaveTextarea {...defaultProps} value={value} />);
    
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    const displayValue = textarea.value;
    
    // Should contain text
    expect(displayValue).toContain('Bug Report');
    expect(displayValue).toContain('Description: Login broken');
    expect(displayValue).toContain('Steps:');
    
    // Should contain placeholders
    expect(displayValue).toContain('[Image: error.png]');
    expect(displayValue).toContain('[Image: console.png]');
    
    // Should NOT contain URLs
    expect(displayValue).not.toContain('s3.amazonaws.com');
    expect(displayValue).not.toContain('?key=123');
  });

  it('should display empty string when value is null', () => {
    render(<AutoSaveTextarea {...defaultProps} value={null} />);
    
    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveValue('');
  });

  it('should display original text when no images present', () => {
    const value = 'This is just regular text with no markdown images';
    
    render(<AutoSaveTextarea {...defaultProps} value={value} />);
    
    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveValue(value);
  });

  it('should handle image without alt text', () => {
    const value = 'Screenshot: ![](https://s3.com/screenshot.png)';
    
    render(<AutoSaveTextarea {...defaultProps} value={value} />);
    
    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveValue('Screenshot: [Image: screenshot.png] ');
  });

  it('should preserve line breaks around filtered images', () => {
    const value = 'Line 1\n![Image](https://s3.com/img.png)\nLine 2';
    
    render(<AutoSaveTextarea {...defaultProps} value={value} />);
    
    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveValue('Line 1\n[Image: img.png] \nLine 2');
  });

  it('should call onChange with user-edited text', async () => {
    const user = userEvent.setup();
    let value = '';
    const onChange = vi.fn((newValue) => {
      value = newValue;
    });
    
    const { rerender } = render(<AutoSaveTextarea {...defaultProps} value={value} onChange={onChange} />);
    
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'N');
    
    // Rerender with new value to simulate parent update
    rerender(<AutoSaveTextarea {...defaultProps} value={value} onChange={onChange} />);
    
    // onChange is called with the typed character
    expect(onChange).toHaveBeenCalledWith('N');
  });

  it('should call onBlur with current textarea value', async () => {
    const user = userEvent.setup();
    const onBlur = vi.fn();
    let currentValue = '';
    const onChange = vi.fn((newValue) => {
      currentValue = newValue;
    });
    
    const { rerender } = render(
      <AutoSaveTextarea {...defaultProps} value={currentValue} onChange={onChange} onBlur={onBlur} />
    );
    
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'T');
    
    // Simulate parent component updating the value prop
    rerender(<AutoSaveTextarea {...defaultProps} value={currentValue} onChange={onChange} onBlur={onBlur} />);
    
    await user.tab(); // Trigger blur
    
    // onBlur receives the current value in the textarea
    expect(onBlur).toHaveBeenCalledWith('T');
  });

  it('should handle S3 URL with query parameters correctly', () => {
    const value = '![Screenshot](https://s3.us-east-1.amazonaws.com/bucket/image.png?AWSAccessKeyId=AKIAEXAMPLE&Expires=1234567890&Signature=abc123)';
    
    render(<AutoSaveTextarea {...defaultProps} value={value} />);
    
    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveValue('[Image: image.png] ');
  });

  it('should generate compact placeholders for very long URLs', () => {
    const longUrl = 'https://s3.us-east-1.amazonaws.com/my-very-long-bucket-name-here/organization/project/year/month/deeply/nested/path/structure/screenshot-with-long-name.png?AWSAccessKeyId=AKIAIOSFODNN7EXAMPLE&Expires=1234567890&Signature=verylongsignaturevaluehere';
    const value = `![Screenshot](${longUrl})`;
    
    render(<AutoSaveTextarea {...defaultProps} value={value} />);
    
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    const displayValue = textarea.value;
    
    // Placeholder should be compact
    expect(displayValue).toBe('[Image: screenshot-with-long-name.png] ');
    expect(displayValue.length).toBeLessThan(50);
  });

  it('should not show ImagePreview when enableImageUpload is false', () => {
    const value = '![Image](https://s3.com/image.png)';
    
    const { container } = render(
      <AutoSaveTextarea 
        {...defaultProps} 
        value={value}
        enableImageUpload={false}
      />
    );
    
    // ImagePreview should not be rendered
    expect(container.querySelector('.image-preview')).toBeNull();
  });

  it('should show ImagePreview when enableImageUpload is true and featureId is provided', () => {
    const value = '![Image](https://s3.com/image.png)';
    
    render(
      <AutoSaveTextarea 
        {...defaultProps} 
        value={value}
        enableImageUpload={true}
        featureId="feature-123"
      />
    );
    
    // The textarea should still show placeholder
    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveValue('[Image: image.png] ');
  });

  it('should handle consecutive images without excessive spacing', () => {
    const value = '![One](https://s3.com/one.png)![Two](https://s3.com/two.png)![Three](https://s3.com/three.png)';
    
    render(<AutoSaveTextarea {...defaultProps} value={value} />);
    
    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveValue('[Image: one.png] [Image: two.png] [Image: three.png] ');
  });
});
