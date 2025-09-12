/**
 * Configuration Error Page
 * 
 * Displays user-friendly error messages when critical environment variables
 * are missing or invalid, preventing the application from starting properly.
 */

'use client';

import { useSearchParams } from 'next/navigation';
import { AlertCircle, Server, Settings, ExternalLink } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Suspense } from 'react';

function ConfigurationErrorContent() {
  const searchParams = useSearchParams();
  const missingVars = searchParams?.get('missing')?.split(',') || [];

  const getVariableInfo = (varName: string) => {
    const varInfo: Record<string, { description: string; example: string; docs?: string }> = {
      DATABASE_URL: {
        description: 'Database connection URL for Prisma ORM',
        example: 'postgresql://user:password@localhost:5432/database',
        docs: 'https://www.prisma.io/docs/reference/database-reference/connection-urls'
      },
      NEXTAUTH_SECRET: {
        description: 'Secret key for NextAuth.js session encryption (minimum 32 characters)',
        example: 'your-super-secret-nextauth-key-here-32-chars-min',
        docs: 'https://next-auth.js.org/configuration/options#secret'
      },
      JWT_SECRET: {
        description: 'Secret key for JWT token signing (minimum 32 characters)',
        example: 'your-jwt-secret-key-here-32-characters-minimum',
      },
      NEXTAUTH_URL: {
        description: 'Base URL for NextAuth.js callbacks and redirects',
        example: 'http://localhost:3000 or https://your-app.com',
        docs: 'https://next-auth.js.org/configuration/options#nextauth_url'
      }
    };

    return varInfo[varName] || {
      description: 'Required environment variable for application functionality',
      example: 'Set appropriate value for your environment'
    };
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-2xl w-full space-y-6">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertCircle className="w-8 h-8 text-destructive" />
            </div>
          </div>
          <div>
            <h1 className="text-3xl font-bold text-destructive">Configuration Error</h1>
            <p className="text-muted-foreground mt-2">
              The application cannot start due to missing or invalid environment variables.
            </p>
          </div>
        </div>

        {/* Error Details */}
        <Alert variant="destructive">
          <Server className="h-4 w-4" />
          <AlertDescription className="space-y-2">
            <p className="font-medium">Missing Critical Environment Variables:</p>
            <ul className="list-disc list-inside space-y-1 text-sm">
              {missingVars.length > 0 ? (
                missingVars.map((varName) => (
                  <li key={varName} className="font-mono">{varName}</li>
                ))
              ) : (
                <li>One or more critical environment variables are not configured</li>
              )}
            </ul>
          </AlertDescription>
        </Alert>

        {/* Configuration Instructions */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              How to Fix This Issue
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <h3 className="font-semibold mb-3">1. Create Environment File</h3>
              <p className="text-sm text-muted-foreground mb-2">
                Create a <code className="bg-muted px-1 py-0.5 rounded">.env.local</code> file in your project root with the following variables:
              </p>
              <div className="bg-muted p-3 rounded-lg font-mono text-sm">
                {missingVars.length > 0 ? (
                  missingVars.map((varName) => {
                    const info = getVariableInfo(varName);
                    return (
                      <div key={varName} className="space-y-1">
                        <div className="text-muted-foreground"># {info.description}</div>
                        <div>{varName}={info.example}</div>
                        {varName !== missingVars[missingVars.length - 1] && <div className="h-2" />}
                      </div>
                    );
                  })
                ) : (
                  <div>
                    <div className="text-muted-foreground"># Add your environment variables here</div>
                    <div>DATABASE_URL=postgresql://user:password@localhost:5432/database</div>
                    <div>NEXTAUTH_SECRET=your-super-secret-nextauth-key-here-32-chars-min</div>
                    <div>JWT_SECRET=your-jwt-secret-key-here-32-characters-minimum</div>
                  </div>
                )}
              </div>
            </div>

            <div>
              <h3 className="font-semibold mb-3">2. Environment Variable Details</h3>
              <div className="space-y-3">
                {(missingVars.length > 0 ? missingVars : ['DATABASE_URL', 'NEXTAUTH_SECRET', 'JWT_SECRET']).map((varName) => {
                  const info = getVariableInfo(varName);
                  return (
                    <div key={varName} className="border rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <code className="font-mono font-semibold text-sm">{varName}</code>
                        {info.docs && (
                          <Button variant="outline" size="sm" asChild>
                            <a href={info.docs} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="w-3 h-3 mr-1" />
                              Docs
                            </a>
                          </Button>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">{info.description}</p>
                      <div className="text-xs font-mono bg-muted p-2 rounded">
                        Example: {info.example}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <h3 className="font-semibold mb-3">3. Restart the Application</h3>
              <p className="text-sm text-muted-foreground">
                After setting up your environment variables, restart the application server to apply the changes.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Additional Help */}
        <Card>
          <CardContent className="pt-6">
            <div className="text-center space-y-2">
              <h3 className="font-semibold">Need Help?</h3>
              <p className="text-sm text-muted-foreground">
                Check the application documentation for detailed setup instructions or contact your system administrator.
              </p>
              <Button variant="outline" onClick={() => window.location.reload()}>
                Retry After Configuration
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function ConfigurationErrorPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-16 h-16 rounded-full bg-muted animate-pulse" />
      </div>
    }>
      <ConfigurationErrorContent />
    </Suspense>
  );
}