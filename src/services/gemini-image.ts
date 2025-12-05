/**
 * Gemini Image Generation Service
 * 
 * Provides AI-powered image generation for architecture diagrams using
 * Google's Gemini 2.5 Flash Image model.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { getGeminiApiKey } from '@/config/env';

/**
 * Error types for Gemini API failures
 */
export enum GeminiErrorType {
  AUTHENTICATION = 'AUTHENTICATION',
  RATE_LIMIT = 'RATE_LIMIT',
  INVALID_RESPONSE = 'INVALID_RESPONSE',
  NETWORK = 'NETWORK',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Custom error class for Gemini API errors
 */
export class GeminiError extends Error {
  constructor(
    message: string,
    public type: GeminiErrorType,
    public originalError?: unknown
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}

/**
 * Constructs a well-engineered prompt for architecture diagram generation
 */
export function buildArchitectureDiagramPrompt(architectureText: string): string {
  return `Convert the following architecture description into a clear, professional system architecture diagram with components, connections, and labels. Use a technical diagram style with clean lines and clear text.

Requirements:
- Show all major components as labeled boxes
- Draw arrows to indicate data flow and connections between components
- Include labels on arrows to describe the relationship/interaction
- Use a clean, technical style with good contrast
- Make text readable and properly sized
- Organize components in a logical layout (e.g., client → server → database)
- Use standard shapes: rectangles for services/components, cylinders for databases, clouds for external services

Architecture:
${architectureText}`;
}

/**
 * Determines error type from API error response
 */
function categorizeError(error: unknown): GeminiErrorType {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    
    // Authentication errors
    if (message.includes('api key') || message.includes('unauthorized') || message.includes('forbidden')) {
      return GeminiErrorType.AUTHENTICATION;
    }
    
    // Rate limit errors
    if (message.includes('rate limit') || message.includes('quota') || message.includes('429')) {
      return GeminiErrorType.RATE_LIMIT;
    }
    
    // Network errors
    if (message.includes('network') || message.includes('fetch') || message.includes('econnrefused')) {
      return GeminiErrorType.NETWORK;
    }
    
    // Invalid response errors
    if (message.includes('invalid') || message.includes('parse') || message.includes('format')) {
      return GeminiErrorType.INVALID_RESPONSE;
    }
  }
  
  return GeminiErrorType.UNKNOWN;
}

/**
 * Generates an architecture diagram from text description using Gemini AI
 * 
 * @param text - Architecture description text
 * @returns PNG image as Buffer
 * @throws GeminiError on API failures
 */
export async function generateArchitectureDiagram(text: string): Promise<Buffer> {
  try {
    // Validate input
    if (!text || text.trim().length === 0) {
      throw new GeminiError(
        'Architecture text cannot be empty',
        GeminiErrorType.INVALID_RESPONSE
      );
    }
    
    // Get API key
    const apiKey = getGeminiApiKey();
    
    // Initialize Gemini client
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.5-flash-image' 
    });
    
    // Build prompt
    const prompt = buildArchitectureDiagramPrompt(text);
    
    // Generate image
    const result = await model.generateContent(prompt);
    const response = await result.response;
    
    // Validate response
    if (!response) {
      throw new GeminiError(
        'No response received from Gemini API',
        GeminiErrorType.INVALID_RESPONSE
      );
    }
    
    // Extract image data
    const candidates = response.candidates;
    if (!candidates || candidates.length === 0) {
      throw new GeminiError(
        'No image candidates returned from Gemini API',
        GeminiErrorType.INVALID_RESPONSE
      );
    }
    
    const candidate = candidates[0];
    if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
      throw new GeminiError(
        'Invalid candidate structure in Gemini API response',
        GeminiErrorType.INVALID_RESPONSE
      );
    }
    
    // Find inline data part (image)
    const imagePart = candidate.content.parts.find((part: any) => part.inlineData);
    if (!imagePart || !imagePart.inlineData || !imagePart.inlineData.data) {
      throw new GeminiError(
        'No image data found in Gemini API response',
        GeminiErrorType.INVALID_RESPONSE
      );
    }
    
    // Convert base64 to buffer
    const base64Data = imagePart.inlineData.data;
    const imageBuffer = Buffer.from(base64Data, 'base64');
    
    // Validate buffer
    if (imageBuffer.length === 0) {
      throw new GeminiError(
        'Generated image buffer is empty',
        GeminiErrorType.INVALID_RESPONSE
      );
    }
    
    return imageBuffer;
    
  } catch (error) {
    // Re-throw GeminiError as-is
    if (error instanceof GeminiError) {
      throw error;
    }
    
    // Categorize and wrap other errors
    const errorType = categorizeError(error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    
    throw new GeminiError(
      `Failed to generate architecture diagram: ${errorMessage}`,
      errorType,
      error
    );
  }
}