import { describe, it, expect } from 'vitest';
import { filterImagesFromDisplay, extractImageInfo } from '@/lib/utils/markdown-filters';

describe('filterImagesFromDisplay', () => {
  it('should replace single markdown image with placeholder', () => {
    const input = '![Screenshot](https://s3.amazonaws.com/bucket/screenshot.png)';
    const output = filterImagesFromDisplay(input);
    expect(output).toBe('[Image: screenshot.png] ');
  });

  it('should replace multiple markdown images with individual placeholders', () => {
    const input = '![First](https://s3.com/first.png) and ![Second](https://s3.com/second.jpg)';
    const output = filterImagesFromDisplay(input);
    expect(output).toBe('[Image: first.png]  and [Image: second.jpg] ');
  });

  it('should preserve text and only replace images', () => {
    const input = 'Bug report:\n![Screenshot](https://s3.com/bug.png)\nSee above for details';
    const output = filterImagesFromDisplay(input);
    expect(output).toBe('Bug report:\n[Image: bug.png] \nSee above for details');
  });

  it('should use filename from URL, not alt text', () => {
    const input = '![My Custom Alt Text](https://s3.com/actual-filename.png)';
    const output = filterImagesFromDisplay(input);
    expect(output).toBe('[Image: actual-filename.png] ');
  });

  it('should handle image without alt text', () => {
    const input = '![](https://s3.com/image.png)';
    const output = filterImagesFromDisplay(input);
    expect(output).toBe('[Image: image.png] ');
  });

  it('should extract clean filename from S3 URL with query params', () => {
    const input = '![Screenshot](https://s3.amazonaws.com/bucket/screenshot.png?AWSAccessKeyId=123&Expires=456)';
    const output = filterImagesFromDisplay(input);
    expect(output).toBe('[Image: screenshot.png] ');
  });

  it('should handle multiple consecutive images with proper spacing', () => {
    const input = '![First](https://s3.com/first.png)![Second](https://s3.com/second.png)![Third](https://s3.com/third.png)';
    const output = filterImagesFromDisplay(input);
    expect(output).toBe('[Image: first.png] [Image: second.png] [Image: third.png] ');
  });

  it('should return empty string for empty input', () => {
    expect(filterImagesFromDisplay('')).toBe('');
  });

  it('should return empty string for null input', () => {
    expect(filterImagesFromDisplay(null as any)).toBe('');
  });

  it('should return original text unchanged when no images present', () => {
    const input = 'This is just regular text with no images';
    const output = filterImagesFromDisplay(input);
    expect(output).toBe(input);
  });

  it('should generate compact placeholder for long S3 URLs', () => {
    const longUrl = 'https://s3.us-east-1.amazonaws.com/my-very-long-bucket-name/deeply/nested/path/structure/image.png?AWSAccessKeyId=AKIAIOSFODNN7EXAMPLE&Expires=1234567890&Signature=verylongsignaturehere';
    const input = `![Screenshot](${longUrl})`;
    const output = filterImagesFromDisplay(input);
    expect(output).toBe('[Image: image.png] ');
    expect(output.length).toBeLessThan(30);
  });

  it('should handle URL without file extension', () => {
    const input = '![Image](https://s3.com/bucket/imagefile)';
    const output = filterImagesFromDisplay(input);
    expect(output).toBe('[Image: imagefile] ');
  });

  it('should preserve line breaks around images', () => {
    const input = 'Line 1\n![Image](https://s3.com/img.png)\nLine 2';
    const output = filterImagesFromDisplay(input);
    expect(output).toBe('Line 1\n[Image: img.png] \nLine 2');
  });

  it('should handle mixed S3 URLs and regular text in multiline content', () => {
    const input = `Bug Report

Description: The login button is broken

![Screenshot 1](https://s3.amazonaws.com/bugs/login-error.png?key=123)

Steps to reproduce:
1. Navigate to login page
2. Click submit

![Screenshot 2](https://s3.amazonaws.com/bugs/console-error.png?key=456)

Expected: Should login
Actual: Error thrown`;

    const output = filterImagesFromDisplay(input);
    
    expect(output).toContain('[Image: login-error.png]');
    expect(output).toContain('[Image: console-error.png]');
    expect(output).toContain('Bug Report');
    expect(output).toContain('Steps to reproduce:');
    expect(output).not.toContain('s3.amazonaws.com');
  });
});

describe('extractImageInfo', () => {
  it('should extract multiple images with metadata', () => {
    const input = '![Alt1](https://s3.com/img1.png) and ![Alt2](https://s3.com/img2.jpg)';
    const images = extractImageInfo(input);
    
    expect(images).toHaveLength(2);
    expect(images[0]).toEqual({
      markdown: '![Alt1](https://s3.com/img1.png)',
      alt: 'Alt1',
      url: 'https://s3.com/img1.png',
      filename: 'img1.png',
    });
    expect(images[1]).toEqual({
      markdown: '![Alt2](https://s3.com/img2.jpg)',
      alt: 'Alt2',
      url: 'https://s3.com/img2.jpg',
      filename: 'img2.jpg',
    });
  });

  it('should return empty array when no images found', () => {
    const input = 'Just regular text with no images';
    const images = extractImageInfo(input);
    expect(images).toEqual([]);
  });

  it('should correctly parse alt text and URLs', () => {
    const input = '![Bug Screenshot](https://s3.amazonaws.com/bucket/bug.png?key=123)';
    const images = extractImageInfo(input);
    
    expect(images).toHaveLength(1);
    expect(images[0].alt).toBe('Bug Screenshot');
    expect(images[0].url).toBe('https://s3.amazonaws.com/bucket/bug.png?key=123');
    expect(images[0].filename).toBe('bug.png');
  });

  it('should handle empty alt text', () => {
    const input = '![](https://s3.com/image.png)';
    const images = extractImageInfo(input);
    
    expect(images).toHaveLength(1);
    expect(images[0].alt).toBe('');
    expect(images[0].filename).toBe('image.png');
  });

  it('should handle malformed markdown gracefully', () => {
    const input = '![Missing closing paren](https://s3.com/img.png and ![Valid](https://s3.com/valid.png)';
    const images = extractImageInfo(input);
    
    // Should only extract the valid image
    expect(images).toHaveLength(1);
    expect(images[0].filename).toBe('valid.png');
  });

  it('should extract filename before query parameters', () => {
    const input = '![Img](https://s3.com/path/to/file.jpg?param1=value1&param2=value2)';
    const images = extractImageInfo(input);
    
    expect(images[0].filename).toBe('file.jpg');
  });

  it('should return empty array for empty input', () => {
    expect(extractImageInfo('')).toEqual([]);
  });

  it('should return empty array for null input', () => {
    expect(extractImageInfo(null as any)).toEqual([]);
  });

  it('should handle deeply nested URL paths', () => {
    const input = '![Screenshot](https://s3.amazonaws.com/bucket/org/project/2024/screenshots/bug-123.png)';
    const images = extractImageInfo(input);
    
    expect(images[0].filename).toBe('bug-123.png');
  });

  it('should use fallback filename when URL has no path segments', () => {
    const input = '![Img](https://s3.com/)';
    const images = extractImageInfo(input);
    
    expect(images[0].filename).toBe('image');
  });
});
