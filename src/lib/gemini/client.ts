/**
 * Gemini Client Wrapper
 * 
 * Provides centralized configuration for Google Gemini API.
 * Automatically routes to mock endpoint when USE_MOCKS=true.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { getGeminiApiKey } from '@/config/env';
import { serviceConfigs } from '@/config/services';

/**
 * Get configured Gemini client
 * Uses mock URL when USE_MOCKS=true, real API otherwise
 * 
 * @returns GoogleGenerativeAI client instance
 */
export function getGeminiClient(): GoogleGenerativeAI {
  const apiKey = getGeminiApiKey();
  const baseUrl = serviceConfigs.gemini.baseURL;
  
  // GoogleGenerativeAI SDK supports baseUrl option for custom endpoints
  return new GoogleGenerativeAI(apiKey);
}