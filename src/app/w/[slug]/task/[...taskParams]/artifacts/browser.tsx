"use client";

import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Monitor, RefreshCw, ExternalLink, Bug } from "lucide-react";
import { Artifact, BrowserContent } from "@/lib/chat";

interface DebugOverlayProps {
  isActive: boolean;
  isSubmitting: boolean;
  onDebugSelection: (x: number, y: number, width: number, height: number) => void;
}

function DebugOverlay({ isActive, isSubmitting, onDebugSelection }: DebugOverlayProps) {
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
  const [selectionCurrent, setSelectionCurrent] = useState<{ x: number; y: number } | null>(null);

  if (!isActive) return null;

  const handleMouseDown = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    setIsSelecting(true);
    setSelectionStart({ x, y });
    setSelectionCurrent({ x, y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isSelecting || !selectionStart) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    setSelectionCurrent({ x, y });
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!selectionStart) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const endX = e.clientX - rect.left;
    const endY = e.clientY - rect.top;
    
    // Calculate selection area (works for both clicks and drags)
    const x = Math.min(selectionStart.x, endX);
    const y = Math.min(selectionStart.y, endY);
    const width = Math.abs(endX - selectionStart.x);
    const height = Math.abs(endY - selectionStart.y);
    
    onDebugSelection(x, y, width, height);
    
    // Reset selection state
    setIsSelecting(false);
    setSelectionStart(null);
    setSelectionCurrent(null);
  };

  const getSelectionStyle = () => {
    if (!isSelecting || !selectionStart || !selectionCurrent) return {};
    
    const x = Math.min(selectionStart.x, selectionCurrent.x);
    const y = Math.min(selectionStart.y, selectionCurrent.y);
    const width = Math.abs(selectionCurrent.x - selectionStart.x);
    const height = Math.abs(selectionCurrent.y - selectionStart.y);
    
    return {
      left: x,
      top: y,
      width,
      height,
    };
  };

  return (
    <div
      className="absolute inset-0 z-10 cursor-crosshair"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)' }}
    >
      {/* Selection rectangle (only show if actively selecting and has some size) */}
      {isSelecting && selectionStart && selectionCurrent && (
        <div
          className="absolute border-2 border-blue-500 bg-blue-200/20"
          style={getSelectionStyle()}
        />
      )}
      
      {/* Debug mode indicator */}
      <div className="absolute top-2 left-2 bg-blue-600 text-white text-xs px-2 py-1 rounded">
        {isSubmitting ? (
          <>⏳ Sending debug info...</>
        ) : (
          <>🐛 Debug Mode: Click or drag to identify elements</>
        )}
      </div>
    </div>
  );
}

export function BrowserArtifactPanel({ 
  artifacts, 
  onDebugMessage 
}: { 
  artifacts: Artifact[];
  onDebugMessage?: (message: string) => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [debugMode, setDebugMode] = useState(false);
  const [isSubmittingDebug, setIsSubmittingDebug] = useState(false);

  // Reset debug mode when switching tabs
  const handleTabChange = (newTab: number) => {
    setActiveTab(newTab);
    if (debugMode) {
      setDebugMode(false);
    }
  };

  const handleRefresh = () => {
    setRefreshKey((prev) => prev + 1);
  };

  const handleTabOut = (url: string) => {
    window.open(url, "_blank");
  };

  const handleDebugElement = () => {
    setDebugMode(!debugMode);
  };

  const handleDebugSelection = async (x: number, y: number, width: number, height: number) => {
    const activeArtifact = artifacts[activeTab];
    const content = activeArtifact.content as BrowserContent;
    
    setIsSubmittingDebug(true);
    
    try {
      // Get the iframe element for the active tab
      const iframeElement = document.querySelector(`iframe[title="Live Preview ${activeTab + 1}"]`) as HTMLIFrameElement;
      
      if (!iframeElement?.contentWindow) {
        throw new Error('Could not access iframe content window');
      }
      
      // Create unique message ID for tracking responses
      const messageId = `debug-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      // Set up response listener
      const responsePromise = new Promise<Array<{file: string; lines: number[]; context?: string}>>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timeout waiting for iframe response'));
        }, 10000); // 10 second timeout
        
        const handleMessage = (event: MessageEvent) => {
          // Verify origin matches iframe URL for security
          const iframeOrigin = new URL(content.url).origin;
          if (event.origin !== iframeOrigin) return;
          
          if (event.data?.type === 'debug-response' && event.data?.messageId === messageId) {
            clearTimeout(timeout);
            window.removeEventListener('message', handleMessage);
            
            if (event.data.success) {
              resolve(event.data.sourceFiles);
            } else {
              reject(new Error(event.data.error || 'Unknown error from iframe'));
            }
          }
        };
        
        window.addEventListener('message', handleMessage);
      });
      
      // Send coordinates to iframe via postMessage
      iframeElement.contentWindow.postMessage({
        type: 'debug-request',
        messageId,
        coordinates: { x, y, width, height }
      }, new URL(content.url).origin);
      
      // Wait for response from iframe
      await responsePromise;
      
      // Format message for chat system
      const coordinateText = width === 0 && height === 0 
        ? `click at (${x}, ${y})`
        : `selection (${width}×${height} at ${x},${y})`;
      
      const message = `🐛 Debug ${coordinateText} on ${content.url}`;
      
      // Send debug message to chat system
      if (onDebugMessage) {
        await onDebugMessage(message);
      }
      
      // Auto-disable debug mode after successful interaction
      setDebugMode(false);
      
    } catch (error) {
      console.error('Failed to process debug selection:', error);
      
      // Fallback: send coordinates without source mapping if iframe communication fails
      const message = width === 0 && height === 0 
        ? `🐛 Debug click at (${x}, ${y}) on ${content.url}`
        : `🐛 Debug selection (${width}×${height} at ${x},${y}) on ${content.url}`;
      
      if (onDebugMessage) {
        try {
          await onDebugMessage(message);
          setDebugMode(false);
        } catch (chatError) {
          console.error('Failed to send fallback debug message:', chatError);
          // Keep debug mode active on error so user can retry
        }
      }
    } finally {
      setIsSubmittingDebug(false);
    }
  };

  if (artifacts.length === 0) return null;

  return (
    <div className="h-full flex flex-col">
      {artifacts.length > 1 && (
        <div className="border-b bg-muted/20">
          <div className="flex overflow-x-auto">
            {artifacts.map((artifact, index) => (
              <button
                key={artifact.id}
                onClick={() => handleTabChange(index)}
                className={`px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === index
                    ? "border-primary text-primary bg-background"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                Preview {index + 1}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        {artifacts.map((artifact, index) => {
          const content = artifact.content as BrowserContent;
          return (
            <div
              key={artifact.id}
              className={`h-full flex flex-col ${activeTab === index ? "block" : "hidden"}`}
            >
              <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-b">
                <div className="flex items-center gap-2 min-w-0">
                  <Monitor className="w-4 h-4 flex-shrink-0" />
                  <span className="text-sm font-medium truncate">
                    {content.url}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleTabOut(content.url)}
                    className="h-8 w-8 p-0"
                    title="Open in new tab"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </Button>
                  <Button
                    variant={debugMode ? "default" : "ghost"}
                    size="sm"
                    onClick={handleDebugElement}
                    className="h-8 w-8 p-0"
                    title="Debug Element"
                  >
                    <Bug className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRefresh}
                    className="h-8 w-8 p-0"
                    title="Refresh"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div className="flex-1 overflow-hidden relative">
                <iframe
                  key={`${artifact.id}-${refreshKey}`}
                  src={content.url}
                  className="w-full h-full border-0"
                  title={`Live Preview ${index + 1}`}
                />
                {/* Debug overlay - only active for the current tab */}
                {activeTab === index && (
                  <DebugOverlay
                    isActive={debugMode}
                    isSubmitting={isSubmittingDebug}
                    onDebugSelection={handleDebugSelection}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
