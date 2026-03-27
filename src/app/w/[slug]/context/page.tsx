import { redirect } from "next/navigation";

interface ContextPageProps {
  params: Promise<{ slug: string }>;
}

export default async function ContextPage({ params }: ContextPageProps) {
  const { slug } = await params;
  redirect(`/w/${slug}/context/learn`);
}
