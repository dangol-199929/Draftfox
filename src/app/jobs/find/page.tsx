import { redirect } from "next/navigation";

// Find jobs is now a tab on the Jobs page; this keeps old links working.
export default function FindJobsPage() {
  redirect("/jobs?tab=find");
}
