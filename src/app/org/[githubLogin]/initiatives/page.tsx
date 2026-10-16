import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ githubLogin: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Initiatives is a tab of the canvas view. */
export default async function Page({ params, searchParams }: PageProps) {
  const { githubLogin } = await params;
  const query = await searchParams;
  const next = new URLSearchParams({ view: "canvas", tab: "initiatives" });
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string" && !next.has(key)) next.set(key, value);
  }
  redirect(`/org/${githubLogin}?${next.toString()}`);
}
