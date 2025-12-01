"use client";

import { useState, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";

interface PresignedImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt: string;
  onRefetchUrl?: () => Promise<string | null>;
  maxRetries?: number;
  fallback?: React.ReactNode;
  loadingClassName?: string;
}

/**
 * Component that handles presigned S3 URLs with automatic retry on load failure.
 * When an image fails to load (e.g., due to expired presigned URL), it will
 * automatically attempt to refetch a fresh URL and retry loading.
 */
export function PresignedImage({
  src,
  alt,
  onRefetchUrl,
  maxRetries = 3,
  fallback,
  loadingClassName = "",
  className = "",
  ...props
}: PresignedImageProps) {
  const [currentSrc, setCurrentSrc] = useState(src);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const retryCount = useRef(0);
  const isRetrying = useRef(false);

  // Update currentSrc when src prop changes
  useEffect(() => {
    setCurrentSrc(src);
    setHasError(false);
    retryCount.current = 0;
    isRetrying.current = false;
  }, [src]);

  const handleError = async () => {
    // If already retrying or no refetch function, just show error
    if (isRetrying.current || !onRefetchUrl) {
      setHasError(true);
      return;
    }

    // Check if we've exceeded max retries
    if (retryCount.current >= maxRetries) {
      console.error(`Failed to load image after ${maxRetries} retries:`, src);
      setHasError(true);
      return;
    }

    // Mark as retrying to prevent concurrent retries
    isRetrying.current = true;
    setIsLoading(true);
    retryCount.current += 1;

    try {
      console.log(`Image load failed, refetching URL (attempt ${retryCount.current}/${maxRetries})`);
      
      const newUrl = await onRefetchUrl();
      
      if (newUrl && newUrl !== currentSrc) {
        setCurrentSrc(newUrl);
        setHasError(false);
      } else {
        setHasError(true);
      }
    } catch (error) {
      console.error("Error refetching presigned URL:", error);
      setHasError(true);
    } finally {
      setIsLoading(false);
      isRetrying.current = false;
    }
  };

  const handleLoad = () => {
    setIsLoading(false);
    setHasError(false);
  };

  // Show fallback if error and no loading state
  if (hasError && !isLoading && fallback) {
    return <>{fallback}</>;
  }

  return (
    <div className="relative inline-block">
      {isLoading && (
        <div
          className={`absolute inset-0 flex items-center justify-center bg-muted ${loadingClassName}`}
        >
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      )}
      <img
        {...props}
        src={currentSrc}
        alt={alt}
        className={className}
        onError={handleError}
        onLoad={handleLoad}
        style={{
          ...props.style,
          opacity: isLoading ? 0.5 : 1,
        }}
      />
    </div>
  );
}
