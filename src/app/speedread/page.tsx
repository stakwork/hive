"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Play, Pause, RotateCcw, SkipBack, SkipForward, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";

/**
 * Speed Reading App using RSVP (Rapid Serial Visual Presentation) with ORP highlighting
 * 
 * RSVP Science:
 * - RSVP eliminates saccadic eye movements (jumps between words), which consume 10-20% of reading time
 * - By presenting words sequentially at a fixed point, the eye stays stationary
 * - This reduces cognitive load and allows faster processing
 * 
 * ORP (Optimal Recognition Point):
 * - Research shows each word has an "optimal viewing position" for fastest recognition
 * - For most words, this is slightly left of center (around 25-40% into the word)
 * - Highlighting the ORP guides fixation and improves recognition speed by 10-20%
 * - ORP position varies by word length (shorter words: center, longer words: left-of-center)
 */

interface WordToken {
  text: string;
  pauseMultiplier: number; // How much longer to display this word
  isEndOfSentence: boolean;
}

/**
 * Calculate the Optimal Recognition Point position for a word
 * Based on cognitive research on word recognition patterns
 */
function calculateORP(word: string): number {
  const n = word.length;
  
  if (n === 1) return 0; // Single character: position 0 (1st letter)
  if (n === 2) return 0; // Two characters: position 0 (1st letter)
  if (n === 3) return 1; // Three characters: position 1 (2nd letter)
  if (n === 4) return 1; // Four characters: position 1 (2nd letter)
  
  // For longer words, use formula: approximately (n+1)/2 - 1
  // This places ORP slightly left of center for optimal recognition
  return Math.floor((n + 1) / 2) - 1;
}

/**
 * Process text into word tokens with intelligent punctuation handling
 * Adds appropriate pauses for commas, periods, etc.
 */
function processText(text: string): WordToken[] {
  if (!text.trim()) return [];
  
  const tokens: WordToken[] = [];
  // Split on whitespace while preserving punctuation
  const words = text.split(/\s+/).filter(w => w.length > 0);
  
  words.forEach((word) => {
    let pauseMultiplier = 1.0;
    let isEndOfSentence = false;
    
    // Check for ending punctuation
    if (/[.!?]$/.test(word)) {
      pauseMultiplier = 2.0; // Double pause for sentence endings
      isEndOfSentence = true;
    } else if (/[,;:]$/.test(word)) {
      pauseMultiplier = 1.5; // 50% longer pause for commas and semicolons
    } else if (/[-–—]$/.test(word)) {
      pauseMultiplier = 1.3; // Slight pause for dashes
    }
    
    tokens.push({
      text: word,
      pauseMultiplier,
      isEndOfSentence,
    });
  });
  
  return tokens;
}

/**
 * Extract text from PDF file using PDF.js
 */
async function extractTextFromPDF(file: File): Promise<string> {
  try {
    // Dynamically import PDF.js to avoid SSR issues
    const pdfjsLib = await import('pdfjs-dist');
    
    // Set worker source
    pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
    
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    
    let fullText = '';
    
    // Extract text from each page
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ');
      fullText += pageText + '\n\n';
    }
    
    return fullText;
  } catch (error) {
    console.error('Error extracting PDF text:', error);
    throw new Error('Failed to extract text from PDF. Please try a different file.');
  }
}

export default function SpeedReadPage() {
  const [inputText, setInputText] = useState("");
  const [words, setWords] = useState<WordToken[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [wpm, setWpm] = useState(300);
  const [showControls, setShowControls] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastInteractionRef = useRef<number>(Date.now());
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Calculate delay for current word (in milliseconds)
  const calculateDelay = useCallback((wordToken: WordToken) => {
    const baseDelay = (60 / wpm) * 1000; // Convert WPM to ms per word
    return baseDelay * wordToken.pauseMultiplier;
  }, [wpm]);

  // Auto-hide controls during reading
  useEffect(() => {
    if (!isPlaying) {
      setShowControls(true);
      return;
    }

    const checkActivity = () => {
      const now = Date.now();
      if (now - lastInteractionRef.current > 2000) {
        setShowControls(false);
      }
    };

    const interval = setInterval(checkActivity, 500);
    return () => clearInterval(interval);
  }, [isPlaying]);

  const handleUserInteraction = () => {
    lastInteractionRef.current = Date.now();
    setShowControls(true);
  };

  // RSVP playback engine
  useEffect(() => {
    if (isPlaying && currentIndex < words.length) {
      const currentWord = words[currentIndex];
      const delay = calculateDelay(currentWord);
      
      timeoutRef.current = setTimeout(() => {
        setCurrentIndex(prev => prev + 1);
      }, delay);
    } else if (currentIndex >= words.length && isPlaying) {
      setIsPlaying(false);
      setCurrentIndex(0); // Reset for replay
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [isPlaying, currentIndex, words, calculateDelay]);

  const handlePlayPause = () => {
    if (words.length === 0) {
      setWords(processText(inputText));
      setCurrentIndex(0);
      setIsPlaying(true);
    } else {
      setIsPlaying(!isPlaying);
    }
    handleUserInteraction();
  };

  const handleRestart = () => {
    setCurrentIndex(0);
    setIsPlaying(false);
    handleUserInteraction();
  };

  const handleSkipBack = () => {
    setCurrentIndex(prev => Math.max(0, prev - 1));
    handleUserInteraction();
  };

  const handleSkipForward = () => {
    setCurrentIndex(prev => Math.min(words.length - 1, prev + 1));
    handleUserInteraction();
  };

  const handleRewind = () => {
    // Go back to previous sentence
    let newIndex = currentIndex - 1;
    while (newIndex > 0 && !words[newIndex].isEndOfSentence) {
      newIndex--;
    }
    setCurrentIndex(Math.max(0, newIndex));
    handleUserInteraction();
  };

  const handleForward = () => {
    // Skip to next sentence
    let newIndex = currentIndex;
    while (newIndex < words.length - 1 && !words[newIndex].isEndOfSentence) {
      newIndex++;
    }
    setCurrentIndex(Math.min(words.length - 1, newIndex + 1));
    handleUserInteraction();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);

    if (file.type === 'application/pdf') {
      try {
        const text = await extractTextFromPDF(file);
        setInputText(text);
        setWords([]);
        setCurrentIndex(0);
        setIsPlaying(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load PDF');
      }
    } else if (file.type.startsWith('text/')) {
      try {
        const text = await file.text();
        setInputText(text);
        setWords([]);
        setCurrentIndex(0);
        setIsPlaying(false);
      } catch (err) {
        setError('Failed to load text file');
      }
    } else {
      setError('Please upload a PDF or text file');
    }
  };

  // Render the current word with ORP highlighting
  const renderWord = () => {
    if (words.length === 0 || currentIndex >= words.length) {
      return (
        <div className="text-2xl md:text-4xl text-muted-foreground">
          Enter text below to begin
        </div>
      );
    }

    const currentWord = words[currentIndex].text;
    const orpIndex = calculateORP(currentWord);
    
    // Split word into three parts: before ORP, ORP character, after ORP
    const before = currentWord.slice(0, orpIndex);
    const orpChar = currentWord[orpIndex];
    const after = currentWord.slice(orpIndex + 1);

    return (
      <div className="text-4xl md:text-6xl font-mono tracking-wide">
        <span className="text-foreground">{before}</span>
        <span className="text-red-500 font-bold">{orpChar}</span>
        <span className="text-foreground">{after}</span>
      </div>
    );
  };

  const progress = words.length > 0 ? (currentIndex / words.length) * 100 : 0;

  return (
    <div 
      className="min-h-screen bg-background text-foreground flex flex-col"
      onMouseMove={handleUserInteraction}
      onTouchStart={handleUserInteraction}
    >
      {/* Header */}
      <header className="p-4 border-b">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1 className="text-2xl font-bold">SpeedRead</h1>
          <div className="text-sm text-muted-foreground">
            RSVP with ORP Highlighting
          </div>
        </div>
      </header>

      {/* Main Reading Area */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-3xl">
          {/* ORP Alignment Guide */}
          <div className="relative">
            {/* Vertical guide line for ORP alignment */}
            <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-red-500/20 -translate-x-1/2 pointer-events-none" />
            
            {/* Word Display */}
            <div className="text-center py-8 min-h-[200px] flex items-center justify-center">
              {renderWord()}
            </div>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-muted rounded-full h-1 mt-8">
            <div 
              className="bg-primary h-1 rounded-full transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
          
          {/* Progress Text */}
          <div className="text-center mt-2 text-sm text-muted-foreground">
            {words.length > 0 ? `${currentIndex + 1} / ${words.length} words` : 'Ready'}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div 
        className={`fixed bottom-0 left-0 right-0 transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* WPM Slider */}
        <div className="bg-background/95 backdrop-blur border-t">
          <div className="max-w-3xl mx-auto px-8 py-4">
            <div className="flex items-center gap-4">
              <label className="text-sm font-medium whitespace-nowrap">
                Speed: {wpm} WPM
              </label>
              <Slider
                value={[wpm]}
                onValueChange={(value) => setWpm(value[0])}
                min={100}
                max={1000}
                step={25}
                className="flex-1"
              />
            </div>
          </div>
        </div>

        {/* Playback Controls */}
        <div className="bg-background/95 backdrop-blur border-t">
          <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={handleRewind}
              disabled={currentIndex === 0}
              title="Previous sentence"
            >
              <SkipBack className="h-4 w-4" />
            </Button>
            
            <Button
              variant="outline"
              size="icon"
              onClick={handleSkipBack}
              disabled={currentIndex === 0}
              title="Previous word"
            >
              <SkipBack className="h-3 w-3" />
            </Button>

            <Button
              variant="outline"
              size="icon"
              onClick={handleRestart}
              title="Restart"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>

            <Button
              size="icon"
              onClick={handlePlayPause}
              className="h-12 w-12"
              title={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? (
                <Pause className="h-6 w-6" />
              ) : (
                <Play className="h-6 w-6 ml-0.5" />
              )}
            </Button>

            <Button
              variant="outline"
              size="icon"
              onClick={handleSkipForward}
              disabled={currentIndex >= words.length - 1}
              title="Next word"
            >
              <SkipForward className="h-3 w-3" />
            </Button>

            <Button
              variant="outline"
              size="icon"
              onClick={handleForward}
              disabled={currentIndex >= words.length - 1}
              title="Next sentence"
            >
              <SkipForward className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Text Input Panel */}
      {!isPlaying && words.length === 0 && (
        <div className="fixed inset-0 bg-background z-50 overflow-auto">
          <div className="max-w-4xl mx-auto p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold">Enter Text to Read</h2>
              <div className="flex gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.txt,text/plain,application/pdf"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Upload PDF/Text
                </Button>
              </div>
            </div>

            {error && (
              <div className="mb-4 p-4 bg-destructive/10 border border-destructive rounded-lg text-destructive">
                {error}
              </div>
            )}

            <Textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Paste or type your text here..."
              className="min-h-[400px] font-mono text-base"
            />

            <div className="mt-6 flex gap-4">
              <Button
                onClick={handlePlayPause}
                disabled={!inputText.trim()}
                size="lg"
                className="flex-1"
              >
                <Play className="h-5 w-5 mr-2" />
                Start Reading
              </Button>
            </div>

            <div className="mt-8 p-6 bg-muted rounded-lg">
              <h3 className="font-semibold mb-3">How It Works</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>
                  <strong className="text-foreground">RSVP (Rapid Serial Visual Presentation):</strong> Words
                  appear one at a time in a fixed position, eliminating eye movements and increasing reading speed.
                </li>
                <li>
                  <strong className="text-foreground">ORP (Optimal Recognition Point):</strong> The red letter
                  marks the optimal point for word recognition, helping your brain process words faster.
                </li>
                <li>
                  <strong className="text-foreground">Smart Pacing:</strong> Automatic pauses at punctuation help
                  comprehension while maintaining flow.
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
