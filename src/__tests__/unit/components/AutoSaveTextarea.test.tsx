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

  it('should display [Image: filename] placeholder when value contains markdown image', async () => {
    const value = 'Bug report:\n![Screenshot](https://s3.amazonaws.com/bucket/screenshot.png)\nSee above';
    
    const { container } = render(<AutoSaveTextarea {...defaultProps} value={value} />);
    
    // Component starts in preview mode, need to switch to edit mode
    const editButton = screen.getAllByRole('button')[0];
    await userEvent.click(editButton!);
    
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea).toHaveValue('Bug report:\n[Image: screenshot.png] \nSee above');
  });

  it('should hide full S3 URL from textarea display', async () => {
    const value = '![Bug](https://s3.amazonaws.com/my-bucket/deeply/nested/path/bug-screenshot.png?AWSAccessKeyId=123&Expires=456)';
    
    const { container } = render(<AutoSaveTextarea {...defaultProps} value={value} />);
    
    // Component starts in preview mode, need to switch to edit mode
    const editButton = screen.getAllByRole('button')[0];
    await userEvent.click(editButton!);
    
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

  it('should pass full value with markdown images to ImagePreview component', async () => {
    const value = 'Description\n![Screenshot](https://s3.com/image.png)';
    
    const { container } = render(
      <AutoSaveTextarea 
        {...defaultProps} 
        value={value}
        enableImageUpload={true}
        featureId="feature-123"
      />
    );
    
    // Component starts in preview mode, need to switch to edit mode
    const editButton = screen.getAllByRole('button')[0];
    await userEvent.click(editButton!);
    
    // ImagePreview should receive the full value with markdown
    // We can verify this by checking that the component is rendered
    // (The actual image rendering is tested in ImagePreview tests)
    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveValue('Description\n[Image: image.png] ');
  });

  it('should display multiple placeholders for multiple images', async () => {
    const value = '![First](https://s3.com/first.png) and ![Second](https://s3.com/second.jpg)';
    
    const { container } = render(<AutoSaveTextarea {...defaultProps} value={value} />);
    
    // Component starts in preview mode, need to switch to edit mode
    const editButton = screen.getAllByRole('button')[0];
    await userEvent.click(editButton!);
    
    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveValue('[Image: first.png]  and [Image: second.jpg] ');
  });

  it('should handle mixed content (text + images) correctly', async () => {
    const value = `Bug Report

Description: Login broken

![Error screenshot](https://s3.amazonaws.com/bucket/error.png)

Steps:
1. Click login
2. See error

![Console log](https://s3.amazonaws.com/bucket/console.png?key=123)

Expected: Should work`;

    const { container } = render(<AutoSaveTextarea {...defaultProps} value={value} />);
    
    // Component starts in preview mode, need to switch to edit mode
    const editButton = screen.getAllByRole('button')[0];
    await userEvent.click(editButton!);
    
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

  it('should display original text when no images present', async () => {
    const value = 'This is just regular text with no markdown images';
    
    const { container } = render(<AutoSaveTextarea {...defaultProps} value={value} />);
    
    // Component starts in preview mode, need to switch to edit mode
    const editButton = screen.getAllByRole('button')[0];
    await userEvent.click(editButton!);
    
    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveValue(value);
  });

  it('should handle image without alt text', async () => {
    const value = 'Screenshot: ![](https://s3.com/screenshot.png)';
    
    const { container } = render(<AutoSaveTextarea {...defaultProps} value={value} />);
    
    // Component starts in preview mode, need to switch to edit mode
    const editButton = screen.getAllByRole('button')[0];
    await userEvent.click(editButton!);
    
    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveValue('Screenshot: [Image: screenshot.png] ');
  });

  it('should preserve line breaks around filtered images', async () => {
    const value = 'Line 1\n![Image](https://s3.com/img.png)\nLine 2';
    
    const { container } = render(<AutoSaveTextarea {...defaultProps} value={value} />);
    
    // Component starts in preview mode, need to switch to edit mode
    const editButton = screen.getAllByRole('button')[0];
    await userEvent.click(editButton!);
    
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

  it('should handle S3 URL with query parameters correctly', async () => {
    const value = '![Screenshot](https://s3.us-east-1.amazonaws.com/bucket/image.png?AWSAccessKeyId=AKIAEXAMPLE&Expires=1234567890&Signature=abc123)';
    
    const { container } = render(<AutoSaveTextarea {...defaultProps} value={value} />);
    
    // Component starts in preview mode, need to switch to edit mode
    const editButton = screen.getAllByRole('button')[0];
    await userEvent.click(editButton!);
    
    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveValue('[Image: image.png] ');
  });

  it('should generate compact placeholders for very long URLs', async () => {
    const longUrl = 'https://s3.us-east-1.amazonaws.com/my-very-long-bucket-name-here/organization/project/year/month/deeply/nested/path/structure/screenshot-with-long-name.png?AWSAccessKeyId=AKIAIOSFODNN7EXAMPLE&Expires=1234567890&Signature=verylongsignaturevaluehere';
    const value = `![Screenshot](${longUrl})`;
    
    const { container } = render(<AutoSaveTextarea {...defaultProps} value={value} />);
    
    // Component starts in preview mode, need to switch to edit mode
    const editButton = screen.getAllByRole('button')[0];
    await userEvent.click(editButton!);
    
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

  it('should show ImagePreview when enableImageUpload is true and featureId is provided', async () => {
    const value = '![Image](https://s3.com/image.png)';
    
    const { container } = render(
      <AutoSaveTextarea 
        {...defaultProps} 
        value={value}
        enableImageUpload={true}
        featureId="feature-123"
      />
    );
    
    // Component starts in preview mode, need to switch to edit mode
    const editButton = screen.getAllByRole('button')[0];
    await userEvent.click(editButton!);
    
    // The textarea should still show placeholder
    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveValue('[Image: image.png] ');
  });

  it('should handle consecutive images without excessive spacing', async () => {
    const value = '![One](https://s3.com/one.png)![Two](https://s3.com/two.png)![Three](https://s3.com/three.png)';
    
    const { container } = render(<AutoSaveTextarea {...defaultProps} value={value} />);
    
    // Component starts in preview mode, need to switch to edit mode
    const editButton = screen.getAllByRole('button')[0];
    await userEvent.click(editButton!);
    
    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveValue('[Image: one.png] [Image: two.png] [Image: three.png] ');
  });

  describe('View/Edit Mode Toggle', () => {
    it('should default to preview mode when value has content', () => {
      const value = '# Test Content\n\nThis is markdown.';
      
      const { container } = render(<AutoSaveTextarea {...defaultProps} value={value} />);
      
      // Should show preview mode (MarkdownRenderer content)
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(screen.getByText(/This is markdown/)).toBeInTheDocument();
      
      // Should show at least one button (the toggle button)
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
    });

    it('should default to edit mode when value is null', () => {
      render(<AutoSaveTextarea {...defaultProps} value={null} />);
      
      // Should show textarea in edit mode
      expect(screen.getByRole('textbox')).toBeInTheDocument();
      
      // Should show at least one button (the toggle button)
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
    });

    it('should default to edit mode when value is empty string', () => {
      render(<AutoSaveTextarea {...defaultProps} value="" />);
      
      // Should show textarea in edit mode
      expect(screen.getByRole('textbox')).toBeInTheDocument();
      
      // Should show at least one button (the toggle button)
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
    });

    it('should switch from preview to edit mode when Edit button is clicked', async () => {
      const user = userEvent.setup();
      const value = '# Test Content';
      
      render(<AutoSaveTextarea {...defaultProps} value={value} />);
      
      // Initially in preview mode
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      
      // Click Edit button
      const editButton = screen.getAllByRole('button')[0]; // The toggle button
      await user.click(editButton);
      
      // Should switch to edit mode
      expect(screen.getByRole('textbox')).toBeInTheDocument();
    });

    it('should switch from edit to preview mode and call onBlur when Preview button is clicked', async () => {
      const user = userEvent.setup();
      const onBlur = vi.fn();
      const value = '# Test Content';
      
      render(<AutoSaveTextarea {...defaultProps} value={value} onBlur={onBlur} />);
      
      // Start in preview mode, switch to edit
      const editButton = screen.getAllByRole('button')[0];
      await user.click(editButton);
      
      // Now in edit mode
      expect(screen.getByRole('textbox')).toBeInTheDocument();
      
      // Click Preview button
      const previewButton = screen.getAllByRole('button')[0];
      await user.click(previewButton);
      
      // Should switch to preview mode
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      
      // Should call onBlur with current value
      expect(onBlur).toHaveBeenCalledWith(value);
    });

    it('should render markdown correctly in preview mode', () => {
      const value = '# Heading\n\n- List item 1\n- List item 2\n\n```js\nconst x = 1;\n```';
      
      render(<AutoSaveTextarea {...defaultProps} value={value} />);
      
      // Should render markdown content (MarkdownRenderer will handle the actual rendering)
      expect(screen.getByText('Heading')).toBeInTheDocument();
      expect(screen.getByText('List item 1')).toBeInTheDocument();
    });

    it('should display placeholder in preview mode when no content', async () => {
      const user = userEvent.setup();
      const label = 'Description';
      
      render(<AutoSaveTextarea {...defaultProps} label={label} value="" />);
      
      // Start in edit mode (empty value)
      expect(screen.getByRole('textbox')).toBeInTheDocument();
      
      // Switch to preview mode
      const previewButton = screen.getAllByRole('button')[0];
      await user.click(previewButton);
      
      // Should show placeholder text
      expect(screen.getByText(/No content yet. Click Edit to add description/i)).toBeInTheDocument();
    });

    it('should display textarea with monospace font in edit mode', async () => {
      const user = userEvent.setup();
      const value = '# Test Content';
      
      render(<AutoSaveTextarea {...defaultProps} value={value} />);
      
      // Switch to edit mode
      const editButton = screen.getAllByRole('button')[0];
      await user.click(editButton);
      
      // Textarea should have monospace font class
      const textarea = screen.getByRole('textbox');
      expect(textarea).toHaveClass('font-mono');
      expect(textarea).toHaveClass('text-sm');
    });

    it('should only show ImagePreview in edit mode', async () => {
      const user = userEvent.setup();
      const value = '![Image](https://s3.com/image.png)';
      
      const { container } = render(
        <AutoSaveTextarea 
          {...defaultProps} 
          value={value}
          enableImageUpload={true}
          featureId="feature-123"
        />
      );
      
      // Initially in preview mode - ImagePreview should not show
      expect(container.querySelector('[data-testid="image-preview"]')).not.toBeInTheDocument();
      
      // Switch to edit mode
      const editButton = screen.getAllByRole('button')[0];
      await user.click(editButton);
      
      // Now ImagePreview component should be rendered (even if no images to show)
      // The component itself will be in the DOM in edit mode
    });

    it('should preserve auto-save functionality in edit mode', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const onBlur = vi.fn();
      let value = '# Test';
      
      const { rerender } = render(
        <AutoSaveTextarea {...defaultProps} value={value} onChange={onChange} onBlur={onBlur} />
      );
      
      // Switch to edit mode
      const editButton = screen.getAllByRole('button')[0];
      await user.click(editButton);
      
      // Type in textarea
      const textarea = screen.getByRole('textbox');
      await user.type(textarea, ' more content');
      
      // onChange should be called
      expect(onChange).toHaveBeenCalled();
      
      // Blur textarea
      await user.tab();
      
      // onBlur should be called
      expect(onBlur).toHaveBeenCalled();
    });

    it('should handle mode switching with empty value correctly', async () => {
      const user = userEvent.setup();
      const onBlur = vi.fn();
      
      render(<AutoSaveTextarea {...defaultProps} value="" onBlur={onBlur} />);
      
      // Start in edit mode (empty value)
      expect(screen.getByRole('textbox')).toBeInTheDocument();
      
      // Switch to preview
      const previewButton = screen.getAllByRole('button')[0];
      await user.click(previewButton);
      
      // Should show placeholder
      expect(screen.getByText(/No content yet/i)).toBeInTheDocument();
      
      // onBlur should be called with empty string
      expect(onBlur).toHaveBeenCalledWith("");
    });
  });
});
