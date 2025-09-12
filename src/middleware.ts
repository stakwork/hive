/**
 * Next.js Middleware for Environment Variable Validation
 * 
 * Validates critical environment variables early in the request lifecycle
 * to prevent runtime failures and provide clear error messages.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Environment validation middleware
 */
export function middleware(request: NextRequest) {
  // Skip validation for static files and API health checks
  if (
    request.nextUrl.pathname.startsWith('/_next/') ||
    request.nextUrl.pathname.startsWith('/favicon.ico') ||
    request.nextUrl.pathname === '/health' ||
    request.nextUrl.pathname === '/api/health'
  ) {
    return NextResponse.next();
  }

  // Only perform validation check on server-side requests
  // Environment validation is already done during module loading in env.ts
  // This middleware serves as a backup validation point for critical API routes
  
  if (request.nextUrl.pathname.startsWith('/api/')) {
    try {
      // Check if critical environment variables are present
      const criticalVars = ['DATABASE_URL', 'NEXTAUTH_SECRET', 'JWT_SECRET'];
      const missingVars = criticalVars.filter(envVar => !process.env[envVar]);
      
      if (missingVars.length > 0) {
        return NextResponse.json(
          {
            error: 'Environment configuration error',
            message: `Missing critical environment variables: ${missingVars.join(', ')}`,
            details: 'Application is not properly configured. Please check your environment variables.',
            timestamp: new Date().toISOString()
          },
          { status: 503 } // Service Unavailable
        );
      }
    } catch (error) {
      console.error('Environment validation error in middleware:', error);
      
      return NextResponse.json(
        {
          error: 'Environment validation failed',
          message: 'Application configuration is invalid',
          details: 'Please check server logs for more information.',
          timestamp: new Date().toISOString()
        },
        { status: 503 }
      );
    }
  }

  // For non-API routes, redirect to error page if environment is not configured
  if (process.env.NODE_ENV === 'production') {
    try {
      const criticalVars = ['DATABASE_URL', 'NEXTAUTH_SECRET', 'JWT_SECRET'];
      const missingVars = criticalVars.filter(envVar => !process.env[envVar]);
      
      if (missingVars.length > 0) {
        // Redirect to a configuration error page
        const url = request.nextUrl.clone();
        url.pathname = '/error/configuration';
        url.search = `?missing=${missingVars.join(',')}`;
        return NextResponse.redirect(url);
      }
    } catch (error) {
      console.error('Environment validation error in middleware:', error);
    }
  }

  return NextResponse.next();
}

/**
 * Configure which paths this middleware should run on
 */
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - health (health check endpoints)
     */
    '/((?!_next/static|_next/image|favicon.ico|health).*)',
  ],
};