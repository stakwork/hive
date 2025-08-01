import { GitHubAppDemo } from "@/components/GitHubAppDemo";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/nextauth";
import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function GitHubAppTestPage({ searchParams }: PageProps) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/auth/signin");
  }

  const search = await searchParams;

  // Get repository from search params for testing
  const repository = Array.isArray(search.repository)
    ? search.repository[0]
    : search.repository || "stakwork/hive";

  const repositoryName = repository.split("/").pop() || repository;

  return (
    <div className="container mx-auto py-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">GitHub App Integration Test</h1>
        <p className="text-muted-foreground">
          Test the GitHub App functionality for automated repository operations.
          This demo shows how to generate tokens, push files, and create pull
          requests.
        </p>
      </div>

      <GitHubAppDemo
        repositoryFullName={repository}
        repositoryName={repositoryName}
      />
    </div>
  );
}
