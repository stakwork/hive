import { redirect } from "next/navigation";

interface CallsPageProps {
  params: Promise<{ slug: string }>;
}

export default async function CallsPage({ params }: CallsPageProps) {
  const { slug } = await params;
  redirect(`/w/${slug}/context/calls`);
}
