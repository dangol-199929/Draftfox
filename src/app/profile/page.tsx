import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { ProfileEditor } from "@/components/profile-editor";

export const metadata: Metadata = { title: "Profile" };

export default function ProfilePage() {
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Profile"
        description="Optional facts about you and examples of your writing, so posts sound like you without inventing anything."
      />
      <ProfileEditor />
    </div>
  );
}
