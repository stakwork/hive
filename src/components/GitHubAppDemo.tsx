"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Code2,
  GitPullRequest,
  Upload,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { GitHubAppLink } from "@/components/GitHubAppLink";
import {
  generateGitHubAppToken,
  createPullRequest,
  pushFilesToRepository,
  type GitHubAppTokenResponse,
} from "@/lib/github-app-client";

interface GitHubAppDemoProps {
  repositoryFullName: string;
  repositoryName: string;
}

export function GitHubAppDemo({
  repositoryFullName,
  repositoryName,
}: GitHubAppDemoProps) {
  const [isGeneratingToken, setIsGeneratingToken] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isCreatingPR, setIsCreatingPR] = useState(false);
  const [tokenResponse, setTokenResponse] =
    useState<GitHubAppTokenResponse | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Demo form data
  const [fileName, setFileName] = useState("demo-file.md");
  const [fileContent, setFileContent] = useState(`# Demo File

This file was created using the GitHub App integration.

Generated at: ${new Date().toISOString()}
`);
  const [commitMessage, setCommitMessage] = useState(
    "Add demo file via GitHub App",
  );
  const [branchName, setBranchName] = useState("github-app-demo");
  const [prTitle, setPrTitle] = useState("Demo: GitHub App Integration");
  const [prBody, setPrBody] = useState(
    "This pull request was created using our GitHub App integration to demonstrate automated code deployment.",
  );

  const handleGenerateToken = async () => {
    setIsGeneratingToken(true);
    setError(null);
    setResult(null);

    try {
      const response = await generateGitHubAppToken(repositoryFullName);
      setTokenResponse(response);
      setResult(
        `Token generated successfully! Installation ID: ${response.installationId}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate token");
    } finally {
      setIsGeneratingToken(false);
    }
  };

  const handlePushFiles = async () => {
    setIsPushing(true);
    setError(null);
    setResult(null);

    try {
      const result = await pushFilesToRepository(
        repositoryFullName,
        [{ path: fileName, content: fileContent }],
        {
          message: commitMessage,
          branch: branchName,
          baseBranch: "main",
        },
      );

      setResult(
        `Files pushed successfully! Commit SHA: ${result.commit.sha.substring(0, 7)}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to push files");
    } finally {
      setIsPushing(false);
    }
  };

  const handleCreatePR = async () => {
    setIsCreatingPR(true);
    setError(null);
    setResult(null);

    try {
      const pr = await createPullRequest(repositoryFullName, {
        title: prTitle,
        body: prBody,
        head: branchName,
        base: "main",
      });

      setResult(
        `Pull request created successfully! PR #${pr.number}: ${pr.html_url}`,
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create pull request",
      );
    } finally {
      setIsCreatingPR(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Code2 className="w-5 h-5" />
            GitHub App Integration Demo
          </CardTitle>
          <CardDescription>
            Test the GitHub App functionality for repository:{" "}
            <strong>{repositoryName}</strong>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* GitHub App Link */}
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div>
              <h3 className="font-medium">Step 1: Connect Repository</h3>
              <p className="text-sm text-muted-foreground">
                Install the GitHub App to enable repository operations
              </p>
            </div>
            <GitHubAppLink
              repositoryFullName={repositoryFullName}
              repositoryName={repositoryName}
              onInstallationComplete={(installationId) => {
                setResult(
                  `GitHub App installed! Installation ID: ${installationId}`,
                );
              }}
            />
          </div>

          {/* Generate Token */}
          <div className="space-y-2">
            <Label>Step 2: Generate Access Token</Label>
            <Button
              onClick={handleGenerateToken}
              disabled={isGeneratingToken}
              variant="outline"
              className="w-full"
            >
              {isGeneratingToken ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating Token...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Generate Installation Token
                </>
              )}
            </Button>
            {tokenResponse && (
              <Badge variant="secondary" className="w-full justify-center">
                Token expires in {tokenResponse.expiresIn}s
              </Badge>
            )}
          </div>

          {/* File Operations */}
          <div className="space-y-4 p-4 border rounded-lg">
            <h3 className="font-medium">Step 3: Push Files</h3>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>File Name</Label>
                <Input
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  placeholder="filename.md"
                />
              </div>
              <div>
                <Label>Branch Name</Label>
                <Input
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  placeholder="feature-branch"
                />
              </div>
            </div>

            <div>
              <Label>File Content</Label>
              <Textarea
                value={fileContent}
                onChange={(e) => setFileContent(e.target.value)}
                rows={6}
                placeholder="File content..."
              />
            </div>

            <div>
              <Label>Commit Message</Label>
              <Input
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder="Commit message"
              />
            </div>

            <Button
              onClick={handlePushFiles}
              disabled={isPushing}
              className="w-full"
            >
              {isPushing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Pushing Files...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  Push Files to Repository
                </>
              )}
            </Button>
          </div>

          {/* Pull Request */}
          <div className="space-y-4 p-4 border rounded-lg">
            <h3 className="font-medium">Step 4: Create Pull Request</h3>

            <div>
              <Label>PR Title</Label>
              <Input
                value={prTitle}
                onChange={(e) => setPrTitle(e.target.value)}
                placeholder="Pull request title"
              />
            </div>

            <div>
              <Label>PR Description</Label>
              <Textarea
                value={prBody}
                onChange={(e) => setPrBody(e.target.value)}
                rows={3}
                placeholder="Pull request description..."
              />
            </div>

            <Button
              onClick={handleCreatePR}
              disabled={isCreatingPR}
              variant="secondary"
              className="w-full"
            >
              {isCreatingPR ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating PR...
                </>
              ) : (
                <>
                  <GitPullRequest className="w-4 h-4 mr-2" />
                  Create Pull Request
                </>
              )}
            </Button>
          </div>

          {/* Results */}
          {result && (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>{result}</AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
