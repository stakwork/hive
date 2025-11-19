# Drag and Drop Image Upload Feature

## Overview
Added drag and drop image upload functionality to all text areas in the roadmap feature detail pages. Users can now drag images directly into textareas or paste them from clipboard, and they will be automatically uploaded to S3 and inserted as markdown image syntax.

## What Was Implemented

### 1. Image Upload API (`/src/app/api/upload/image/route.ts`)
- New endpoint: `POST /api/upload/image`
- Accepts image file metadata (filename, contentType, size, featureId)
- Validates file type (JPEG, PNG, GIF, WebP only)
- Validates file size (max 10MB)
- Generates presigned S3 upload URL
- Returns both presigned URL and public URL for use in markdown

### 2. Custom Hook (`/src/hooks/useImageUpload.ts`)
- `useImageUpload` hook handles all drag and drop logic
- Features:
  - Drag enter/leave/over/drop event handling
  - Clipboard paste support for images
  - Automatic image upload to S3 via presigned URL
  - Markdown image syntax insertion at cursor position
  - Visual feedback during drag and upload
  - Error handling and validation

### 3. Enhanced Textarea Component (`/src/components/ui/textarea.tsx`)
- Added visual states for drag and upload
- Shows "Drop image here" overlay when dragging over textarea
- Shows "Uploading image..." overlay during upload
- Styled with primary colors for better UX

### 4. AutoSaveTextarea Component (`/src/components/features/AutoSaveTextarea.tsx`)
- Added `featureId` prop
- Added `enableImageUpload` prop (defaults to false)
- Integrated `useImageUpload` hook
- Passes drag/drop/paste handlers to Textarea component

### 5. AITextareaSection Component (`/src/components/features/AITextareaSection.tsx`)
- Integrated `useImageUpload` hook
- Works in edit mode (drag/drop enabled)
- Preview mode shows rendered markdown with images

### 6. Feature Detail Page (`/src/app/w/[slug]/roadmap/[featureId]/page.tsx`)
- Enabled image upload for "Brief" textarea
- Image upload automatically enabled for "Requirements" and "Architecture" sections (via AITextareaSection)

## How It Works

1. **User Action**: User drags an image file over a textarea or pastes from clipboard
2. **Visual Feedback**: Textarea shows highlighted border and "Drop image here" message
3. **File Validation**: Hook validates file type and size
4. **Request Presigned URL**: Frontend requests presigned upload URL from backend
5. **Direct S3 Upload**: Image is uploaded directly to S3 using presigned URL
6. **Markdown Insertion**: Markdown image syntax is inserted at cursor position: `![filename](url)`
7. **Auto-save**: The updated content triggers the auto-save mechanism

## Features

✅ Drag and drop images into any textarea
✅ Paste images from clipboard (Ctrl+V / Cmd+V)
✅ Multiple image upload support (sequential)
✅ File type validation (JPEG, PNG, GIF, WebP)
✅ File size validation (max 10MB)
✅ Visual feedback during drag and upload
✅ Automatic markdown syntax insertion
✅ Cursor position preservation
✅ Error handling with user feedback
✅ Works with auto-save functionality
✅ Compatible with preview mode

## Usage

### For Brief Field:
```typescript
<AutoSaveTextarea
  id="brief"
  label="Brief"
  value={feature.brief}
  featureId={featureId}
  enableImageUpload={true}
  // ... other props
/>
```

### For Requirements/Architecture (automatic):
```typescript
<AITextareaSection
  id="requirements"
  label="Requirements"
  featureId={featureId}
  // Image upload is automatically enabled
  // ... other props
/>
```

## File Structure
```
src/
├── app/
│   └── api/
│       └── upload/
│           └── image/
│               └── route.ts          # New image upload endpoint
├── hooks/
│   └── useImageUpload.ts             # New drag/drop hook
└── components/
    ├── ui/
    │   └── textarea.tsx              # Enhanced with drag/drop visual states
    └── features/
        ├── AutoSaveTextarea.tsx      # Updated with image upload support
        └── AITextareaSection.tsx     # Updated with image upload support
```

## Environment Variables Required
```bash
AWS_REGION=us-east-1
AWS_ROLE_ARN=<your-aws-role-arn>
S3_BUCKET_NAME=<your-s3-bucket>
NEXT_PUBLIC_S3_URL=<your-s3-public-url>
```

## Testing Checklist
- [ ] Drag and drop JPEG images
- [ ] Drag and drop PNG images
- [ ] Drag and drop GIF images
- [ ] Drag and drop WebP images
- [ ] Paste images from clipboard
- [ ] Try uploading files > 10MB (should fail with error)
- [ ] Try uploading non-image files (should fail with error)
- [ ] Upload multiple images sequentially
- [ ] Verify markdown syntax is correct
- [ ] Verify images render in preview mode
- [ ] Verify auto-save triggers after upload
- [ ] Test in different browsers (Chrome, Firefox, Safari)

## Future Enhancements
- [ ] Add toast notifications for success/error messages
- [ ] Add progress indicator for large file uploads
- [ ] Support batch upload of multiple images at once
- [ ] Image compression before upload
- [ ] Thumbnail generation
- [ ] Image editing capabilities (crop, resize)
- [ ] Support for drag and drop in more text areas (phases, user stories, etc.)
