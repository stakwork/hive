"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Copy, Check, Loader2, ExternalLink } from "lucide-react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/components/ui/use-toast";
import { BrowserArtifactPanel } from "@/app/w/[slug]/task/[...taskParams]/artifacts/browser";
import { Artifact, BrowserContent } from "@/lib/chat";

interface E2eTest {
  node_type: string;
  ref_id: string;
  properties: {
    token_count: number;
    file: string;
    test_kind: string;
    node_key: string;
    start: number;
    name: string;
    end: number;
    body: string;
  };
}

export default function UserJourneys() {
  const { id, slug } = useWorkspace();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [frontend, setFrontend] = useState<string | null>(null);
  const [e2eTests, setE2eTests] = useState<E2eTest[]>([]);
  const [fetchingTests, setFetchingTests] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchE2eTests = useCallback(async () => {
    if (!slug) return;
    
    try {
      setFetchingTests(true);
      const response = await fetch(
        `/api/workspaces/${slug}/graph/nodes?node_type=E2etest&output=json`
      );
      
      if (!response.ok) {
        console.error("Failed to fetch e2e tests");
        return;
      }
      
      const result = await response.json();
      if (result.success && result.data) {
        setE2eTests(result.data);
      }
    } catch (error) {
      console.error("Error fetching e2e tests:", error);
    } finally {
      setFetchingTests(false);
    }
  }, [slug]);

  useEffect(() => {
    if (!frontend) {
      fetchE2eTests();
    }
  }, [frontend, fetchE2eTests]);

  const handleCopyCode = async (code: string, refId: string) => {
    await navigator.clipboard.writeText(code);
    setCopiedId(refId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCreateUserJourney = async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/pool-manager/claim-pod/${id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("Failed to claim pod:", errorData);
        
        // Show error message to user
        toast({
          variant: "destructive",
          title: "Unable to Create User Journey",
          description: "No virtual machines are available right now. Please try again later.",
        });
        return;
      }

      const data = await response.json();
      console.log("Pod claimed successfully:", data);
      
      if (data.frontend) {
        setFrontend(data.frontend);
      }
    } catch (error) {
      console.error("Error claiming pod:", error);
      toast({
        variant: "destructive",
        title: "Connection Error",
        description: "Unable to connect to the service. Please try again later.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const saveUserJourneyTest = async (
    filename: string,
    generatedCode: string,
  ) => {
    try {
      console.log("Saving user journey:", filename, generatedCode);

      const response = await fetch("/api/stakwork/user-journey", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: generatedCode,
          workspaceId: id,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("Failed to save user journey:", errorData);
        return;
      }

      const data = await response.json();
      console.log("User journey saved successfully:", data);

      // You can add success handling UI here, such as showing a toast notification
    } catch (error) {
      console.error("Error saving user journey:", error);
      // You can add error handling UI here
    }
  };

  // Create artifacts array for BrowserArtifactPanel when frontend is defined
  const browserArtifacts: Artifact[] = frontend
    ? [
        {
          id: "frontend-preview",
          messageId: "",
          type: "BROWSER",
          content: { url: frontend } as BrowserContent,
          icon: "Code",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]
    : [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">User Journeys</h1>
          <p className="text-muted-foreground mt-2">
            Track and optimize user experiences through your product
          </p>
        </div>
        {frontend ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFrontend(null)}
            className="h-8 w-8 p-0"
          >
            ✕
          </Button>
        ) : (
          <Button
            className="flex items-center gap-2"
            onClick={handleCreateUserJourney}
            disabled={isLoading}
          >
            <Plus className="w-4 h-4" />
            Create User Journey
          </Button>
        )}
      </div>

      {frontend ? (
        <div className="h-[600px] border rounded-lg overflow-hidden">
          <BrowserArtifactPanel
            artifacts={browserArtifacts}
            ide={false}
            onUserJourneySave={saveUserJourneyTest}
          />
        </div>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>E2E Tests</CardTitle>
              <CardDescription>
                End-to-end tests from your codebase
              </CardDescription>
            </CardHeader>
            <CardContent>
              {fetchingTests ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : e2eTests.length > 0 ? (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Test Name</TableHead>
                        <TableHead>File Path</TableHead>
                        <TableHead className="w-[100px]">Code</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {e2eTests.map((test) => (
                        <TableRow key={test.ref_id}>
                          <TableCell className="font-medium">
                            {test.properties.name}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-muted-foreground">
                                {test.properties.file}
                              </span>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  // Extract repo and path from file path like "stakwork/hive/src/__tests__/e2e/auth.spec.ts"
                                  const parts = test.properties.file.split('/');
                                  if (parts.length >= 2) {
                                    const owner = parts[0];
                                    const repo = parts[1];
                                    const filePath = parts.slice(2).join('/');
                                    // Using HEAD which GitHub redirects to the default branch
                                    window.open(`https://github.com/${owner}/${repo}/blob/HEAD/${filePath}`, '_blank');
                                  }
                                }}
                                className="h-6 w-6 p-0"
                              >
                                <ExternalLink className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleCopyCode(test.properties.body, test.ref_id)}
                              className="h-8 w-8 p-0"
                            >
                              {copiedId === test.ref_id ? (
                                <Check className="h-4 w-4 text-green-500" />
                              ) : (
                                <Copy className="h-4 w-4" />
                              )}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-sm text-muted-foreground">
                    No E2E tests found in your codebase.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
