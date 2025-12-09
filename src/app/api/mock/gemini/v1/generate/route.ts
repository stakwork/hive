/**
 * Mock Gemini Image Generation Endpoint
 * 
 * Simulates Google Gemini's generateContent API for architecture diagrams.
 * Only active when USE_MOCKS=true
 */

import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/config/env';
import { geminiMockState } from '@/lib/mock/gemini-state';

const USE_MOCKS = config.USE_MOCKS;

export async function POST(request: NextRequest) {
  // Mock gating - return 404 if mocks are disabled
  if (!USE_MOCKS) {
    return NextResponse.json(
      { error: 'Mock endpoints are disabled' },
      { status: 404 }
    );
  }
  
  try {
    // Validate API key
    const apiKey = request.headers.get('x-api-key');
    if (!apiKey || !apiKey.startsWith('mock-gemini-key-')) {
      return NextResponse.json(
        { error: 'Invalid API key' },
        { status: 401 }
      );
    }
    
    // Parse request body
    const body = await request.json();
    const { model, prompt } = body;
    
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return NextResponse.json(
        { error: 'Prompt is required and must be a non-empty string' },
        { status: 400 }
      );
    }
    
    // Generate mock image
    const image = geminiMockState.generateArchitectureDiagram(prompt);
    
    // Return response matching Google Gemini API format
    return NextResponse.json({
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  data: image.base64Data,
                  mimeType: image.mimeType,
                },
              },
            ],
          },
        },
      ],
    });
    
  } catch (error) {
    console.error('[Mock Gemini] Error generating image:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}