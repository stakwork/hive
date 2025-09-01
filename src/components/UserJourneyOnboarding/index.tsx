"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Code2, 
  Copy, 
  CheckCircle2, 
  RefreshCw,
  FileCode,
  Info,
  ArrowRight
} from "lucide-react";
import { useState } from "react";

interface UserJourneyOnboardingProps {
  onRetry: () => void;
  targetUrl?: string;
}

export function UserJourneyOnboarding({ 
  onRetry, 
  targetUrl 
}: UserJourneyOnboardingProps) {
  const [copiedScript, setCopiedScript] = useState(false);

  const scriptContent = `<!-- Add this before the closing </body> tag -->
<script src="https://yourdomain.com/js/staktrak.js"></script>`;

  const handleCopy = (content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 2000);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[600px] p-6">
      <Card className="max-w-3xl w-full">
        <CardHeader className="text-center pb-4">
          <div className="flex justify-center mb-4">
            <div className="rounded-full bg-primary/10 p-4">
              <FileCode className="w-8 h-8 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl">Setup Required: Add Recording Script</CardTitle>
          <CardDescription className="text-base mt-2">
            To enable user journey recording, you need to add the Staktrak script to your website
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-6">
          <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-900/20">
            <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <AlertDescription className="text-blue-800 dark:text-blue-200">
              The Staktrak script enables recording user interactions, form inputs, and navigation 
              patterns to generate E2E tests of your user journeys through your application.
            </AlertDescription>
          </Alert>

          <div className="space-y-4">
            <div>
              <h3 className="font-semibold mb-3">
                Add via HTML Script Tag
              </h3>
              <div className="relative">
                <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
                  <code>{scriptContent}</code>
                </pre>
                <Button
                  size="sm"
                  variant="outline"
                  className="absolute top-2 right-2"
                  onClick={() => handleCopy(scriptContent)}
                >
                  {copiedScript ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 mr-1" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 mr-1" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
            </div>

          </div>

          <div className="border-t pt-6">
            <h3 className="font-semibold mb-3">Quick Setup Guide:</h3>
            <ol className="space-y-3 text-sm">
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold">
                  1
                </span>
                <span>Copy the script tag above</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold">
                  2
                </span>
                <span>Add it to your website's HTML, just before the closing {'</body>'} tag</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold">
                  3
                </span>
                <span>Deploy your changes</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold">
                  4
                </span>
                <span>Click the retry button below to check if the script is detected</span>
              </li>
            </ol>
          </div>

          <div className="flex justify-end pt-4 border-t">
            <Button onClick={onRetry} className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4" />
              Check Again
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}