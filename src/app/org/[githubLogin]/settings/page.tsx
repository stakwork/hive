import { OrgSettingsView } from "../_components/OrgSettingsView";

interface SettingsPageProps {
  params: Promise<{ githubLogin: string }>;
}

export default async function OrgSettingsPage({ params }: SettingsPageProps) {
  const { githubLogin } = await params;
  return <OrgSettingsView githubLogin={githubLogin} />;
}
