import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ githubLogin: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Now a section of settings. */
export default async function Page({ params, searchParams }: PageProps) {
  const { githubLogin } = await params;
  const query = await searchParams;
  const next = new URLSearchParams({ section: "members" });
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string" && !next.has(key)) next.set(key, value);
  }
  redirect(`/org/${githubLogin}/settings?${next.toString()}`);
}
