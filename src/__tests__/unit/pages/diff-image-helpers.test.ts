import { describe, it, expect } from 'vitest';
import { isImageFile, extractImageDataUri } from '@/app/w/[slug]/task/[...taskParams]/artifacts/diff';

describe('isImageFile', () => {
  it('returns true for known image extensions', () => {
    expect(isImageFile('logo.png')).toBe(true);
    expect(isImageFile('photo.jpg')).toBe(true);
    expect(isImageFile('image.jpeg')).toBe(true);
    expect(isImageFile('animation.gif')).toBe(true);
    expect(isImageFile('bitmap.bmp')).toBe(true);
    expect(isImageFile('modern.webp')).toBe(true);
    expect(isImageFile('favicon.ico')).toBe(true);
    expect(isImageFile('vector.svg')).toBe(true);
    expect(isImageFile('photo.tiff')).toBe(true);
    expect(isImageFile('scan.tif')).toBe(true);
    expect(isImageFile('nextgen.avif')).toBe(true);
  });

  it('returns false for non-image extensions', () => {
    expect(isImageFile('script.ts')).toBe(false);
    expect(isImageFile('component.tsx')).toBe(false);
    expect(isImageFile('styles.css')).toBe(false);
    expect(isImageFile('data.json')).toBe(false);
    expect(isImageFile('README.md')).toBe(false);
    expect(isImageFile('main.js')).toBe(false);
    expect(isImageFile('index.html')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isImageFile('LOGO.PNG')).toBe(true);
    expect(isImageFile('Photo.JPG')).toBe(true);
    expect(isImageFile('Image.JPEG')).toBe(true);
    expect(isImageFile('Animation.GIF')).toBe(true);
    expect(isImageFile('Vector.SVG')).toBe(true);
  });

  it('handles files with multiple dots in the name', () => {
    expect(isImageFile('logo.backup.png')).toBe(true);
    expect(isImageFile('my.photo.2024.jpg')).toBe(true);
    expect(isImageFile('config.production.json')).toBe(false);
  });

  it('handles files with no extension', () => {
    expect(isImageFile('README')).toBe(false);
    expect(isImageFile('Makefile')).toBe(false);
  });
});

describe('extractImageDataUri', () => {
  it('extracts a data URI from backend image diff content', () => {
    const content = `--- /dev/null
+++ b/logo.png
Binary image file (image/png, 68 B)
data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==`;
    
    expect(extractImageDataUri(content)).toBe(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    );
  });

  it('extracts data URI from content with extra whitespace', () => {
    const content = `--- /dev/null
+++ b/icon.svg
Binary image file (image/svg+xml, 1.2 KB)
   data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQi   `;
    
    expect(extractImageDataUri(content)).toBe(
      'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQi'
    );
  });

  it('returns null when no data URI line is present', () => {
    const content = `--- /dev/null
+++ b/image.png
Binary image file changed`;
    
    expect(extractImageDataUri(content)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractImageDataUri('')).toBeNull();
  });

  it('returns null for regular code diff', () => {
    const content = `diff --git a/src/App.tsx b/src/App.tsx
index 1234567..abcdefg 100644
--- a/src/App.tsx
+++ b/src/App.tsx
@@ -1,3 +1,3 @@
-import React from 'react';
+import React, { useState } from 'react';`;
    
    expect(extractImageDataUri(content)).toBeNull();
  });

  it('extracts the first data URI when multiple lines exist', () => {
    const content = `--- /dev/null
+++ b/image.png
data:image/png;base64,firstImageData
Some other text
data:image/png;base64,secondImageData`;
    
    expect(extractImageDataUri(content)).toBe('data:image/png;base64,firstImageData');
  });

  it('handles JPEG data URIs', () => {
    const content = `--- /dev/null
+++ b/photo.jpg
Binary image file (image/jpeg, 45 KB)
data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD`;
    
    expect(extractImageDataUri(content)).toBe('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD');
  });

  it('handles WebP data URIs', () => {
    const content = `--- /dev/null
+++ b/modern.webp
Binary image file (image/webp, 12 KB)
data:image/webp;base64,UklGRiQAAABXRUJQVlA4`;
    
    expect(extractImageDataUri(content)).toBe('data:image/webp;base64,UklGRiQAAABXRUJQVlA4');
  });

  it('handles GIF data URIs', () => {
    const content = `--- /dev/null
+++ b/animation.gif
Binary image file (image/gif, 234 KB)
data:image/gif;base64,R0lGODlhAQABAAAAACw=`;
    
    expect(extractImageDataUri(content)).toBe('data:image/gif;base64,R0lGODlhAQABAAAAACw=');
  });
});
