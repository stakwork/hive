import { OrgSettingsShell } from "../_components/OrgSettingsShell";

interface SettingsPageProps {
  params: Promise<{ githubLogin: string }>;
  searchParams: Promise<{ section?: string }>;
}

export default async function OrgSettingsPage({ params, searchParams }: SettingsPageProps) {
  const { githubLogin } = await params;
  const { section } = await searchParams;
  return <OrgSettingsShell githubLogin={githubLogin} section={section} />;
}
