import { describe, it, expect } from 'vitest';
import { filterBase64FromDisplay, extractBase64Images } from '@/lib/utils/text-filters';

describe('filterBase64FromDisplay', () => {
  it('should replace single base64 image with [Image] placeholder', () => {
    const content = '![screenshot](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==)';
    const result = filterBase64FromDisplay(content);
    expect(result).toBe('![screenshot][Image]');
  });

  it('should replace multiple base64 images with [Image] placeholders', () => {
    const content = 'First ![img1](data:image/png;base64,ABC123) and second ![img2](data:image/jpeg;base64,XYZ789) images';
    const result = filterBase64FromDisplay(content);
    expect(result).toBe('First ![img1][Image] and second ![img2][Image] images');
  });

  it('should only filter base64 images and preserve S3 URLs', () => {
    const content = 'S3 image ![s3img](https://s3.amazonaws.com/bucket/image.png) and base64 ![b64](data:image/png;base64,ABC123)';
    const result = filterBase64FromDisplay(content);
    expect(result).toBe('S3 image ![s3img](https://s3.amazonaws.com/bucket/image.png) and base64 ![b64][Image]');
  });

  it('should preserve alt text in placeholder', () => {
    const content = '![My Screenshot](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==)';
    const result = filterBase64FromDisplay(content);
    expect(result).toBe('![My Screenshot][Image]');
  });

  it('should handle empty alt text', () => {
    const content = '![](data:image/png;base64,ABC123)';
    const result = filterBase64FromDisplay(content);
    expect(result).toBe('![][Image]');
  });

  it('should return empty string for null input', () => {
    const result = filterBase64FromDisplay(null);
    expect(result).toBe('');
  });

  it('should return empty string for undefined input', () => {
    const result = filterBase64FromDisplay(undefined);
    expect(result).toBe('');
  });

  it('should return empty string for empty string input', () => {
    const result = filterBase64FromDisplay('');
    expect(result).toBe('');
  });

  it('should return unchanged content when no images present', () => {
    const content = 'This is just plain text without any images';
    const result = filterBase64FromDisplay(content);
    expect(result).toBe(content);
  });

  it('should handle different image formats (png, jpeg, webp)', () => {
    const content = '![png](data:image/png;base64,ABC) ![jpeg](data:image/jpeg;base64,DEF) ![webp](data:image/webp;base64,GHI)';
    const result = filterBase64FromDisplay(content);
    expect(result).toBe('![png][Image] ![jpeg][Image] ![webp][Image]');
  });

  it('should handle mixed content with text, S3 URLs, and base64', () => {
    const content = `
# Bug Report

Here's the issue:

![s3-screenshot](https://s3.amazonaws.com/bucket/screen1.png)

Some description text here.

![base64-screenshot](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==)

More text after the image.
    `;
    
    const result = filterBase64FromDisplay(content);
    expect(result).toContain('![s3-screenshot](https://s3.amazonaws.com/bucket/screen1.png)');
    expect(result).toContain('![base64-screenshot][Image]');
    expect(result).toContain('# Bug Report');
    expect(result).toContain('More text after the image.');
  });
});

describe('extractBase64Images', () => {
  it('should extract single base64 image', () => {
    const content = '![screenshot](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==)';
    const result = extractBase64Images(content);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
  });

  it('should extract multiple base64 images', () => {
    const content = '![img1](data:image/png;base64,ABC123) and ![img2](data:image/jpeg;base64,XYZ789)';
    const result = extractBase64Images(content);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe('data:image/png;base64,ABC123');
    expect(result[1]).toBe('data:image/jpeg;base64,XYZ789');
  });

  it('should return empty array when no base64 images found', () => {
    const content = 'Just text with ![s3img](https://s3.amazonaws.com/bucket/image.png)';
    const result = extractBase64Images(content);
    expect(result).toHaveLength(0);
  });

  it('should return empty array for null input', () => {
    const result = extractBase64Images(null);
    expect(result).toHaveLength(0);
  });

  it('should return empty array for undefined input', () => {
    const result = extractBase64Images(undefined);
    expect(result).toHaveLength(0);
  });

  it('should return empty array for empty string', () => {
    const result = extractBase64Images('');
    expect(result).toHaveLength(0);
  });

  it('should handle different image formats (png, jpeg, webp)', () => {
    const content = '![png](data:image/png;base64,ABC) ![jpeg](data:image/jpeg;base64,DEF) ![webp](data:image/webp;base64,GHI)';
    const result = extractBase64Images(content);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe('data:image/png;base64,ABC');
    expect(result[1]).toBe('data:image/jpeg;base64,DEF');
    expect(result[2]).toBe('data:image/webp;base64,GHI');
  });

  it('should only extract base64 URIs from markdown images', () => {
    const content = 'Plain data:image/png;base64,ABC ![real](data:image/png;base64,DEF)';
    const result = extractBase64Images(content);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('data:image/png;base64,DEF');
  });
});
