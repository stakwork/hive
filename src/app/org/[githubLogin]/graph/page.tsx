import { redirect } from "next/navigation";

interface GraphPageProps {
  params: Promise<{ githubLogin: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** The graph is a view of the org page now (`?view=graph`); old links land there. */
export default async function GraphPage({ params, searchParams }: GraphPageProps) {
  const { githubLogin } = await params;
  const query = await searchParams;
  const next = new URLSearchParams({ view: "graph" });
  if (typeof query.workspace === "string") next.set("workspace", query.workspace);
  if (typeof query.node === "string") next.set("gnode", query.node);
  redirect(`/org/${githubLogin}?${next.toString()}`);
}
