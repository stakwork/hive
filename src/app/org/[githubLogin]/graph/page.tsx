import { redirect } from "next/navigation";
import { orgGraphHref } from "../_components/graphHref";

interface GraphPageProps {
  params: Promise<{ githubLogin: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** The graph is a view of the org page now (`?view=graph`); old links land there. */
export default async function GraphPage({ params, searchParams }: GraphPageProps) {
  const { githubLogin } = await params;
  const { workspace, node } = await searchParams;
  redirect(
    orgGraphHref(githubLogin, {
      workspace: typeof workspace === "string" ? workspace : null,
      refId: typeof node === "string" ? node : null,
    }),
  );
}
