import type { Metadata } from "next";
import { Briefcase, FileText, MapPin, PenLine, Search, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const metadata: Metadata = { title: "Job search" };

// Made-up examples for the preview. Nothing here is real or fetched.
const SAMPLE_JOBS = [
  { title: "Frontend Developer", company: "Example Studio", place: "Remote", match: 92, posted: "2 days ago" },
  { title: "Full-stack Engineer (Next.js)", company: "Sample Labs", place: "Hybrid", match: 87, posted: "5 days ago" },
  { title: "Junior Software Engineer", company: "Placeholder Co.", place: "On-site", match: 78, posted: "1 week ago" },
];

const PLANNED = [
  { icon: Search, text: "Find roles that match your profile and skills" },
  { icon: FileText, text: "Tailor your resume to each job, using only your real experience" },
  { icon: PenLine, text: "Draft a cover letter in your own voice" },
  { icon: Briefcase, text: "Track where you applied. You always click Apply yourself." },
];

// A preview of a feature that isn't built yet: the page behind the notice is a non-working mock-up.
export default function JobsPage() {
  return (
    <div className="grid gap-6">
      <PageHeader title="Job search helper" description="Find jobs, tailor your resume and draft cover letters. Coming soon." />

      <div className="relative">
        <div aria-hidden className="pointer-events-none grid gap-4 opacity-40 blur-[1px] select-none">
          <Card>
            <CardContent className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <div className="grid gap-2">
                <Label>Role</Label>
                <Input tabIndex={-1} readOnly value="Frontend developer" />
              </div>
              <div className="grid gap-2">
                <Label>Location</Label>
                <Input tabIndex={-1} readOnly value="Remote" />
              </div>
              <Button tabIndex={-1}>
                <Search />
                Search
              </Button>
            </CardContent>
          </Card>
          {SAMPLE_JOBS.map((job) => (
            <Card key={job.title}>
              <CardHeader>
                <CardTitle>{job.title}</CardTitle>
                <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>{job.company}</span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3.5" /> {job.place}
                  </span>
                  <span>{job.posted}</span>
                  <Badge variant="outline">{job.match}% match</Badge>
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" tabIndex={-1}>
                  <FileText />
                  Tailor resume
                </Button>
                <Button size="sm" variant="outline" tabIndex={-1}>
                  <PenLine />
                  Draft cover letter
                </Button>
                <Button size="sm" variant="ghost" tabIndex={-1}>
                  Open job posting
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="absolute inset-0 flex items-start justify-center pt-10 sm:pt-16">
          <Card className="w-full max-w-md shadow-lg">
            <CardHeader>
              <Badge className="w-fit">
                <Sparkles />
                Coming soon
              </Badge>
              <CardTitle className="pt-1 text-lg">A helper for your job search</CardTitle>
              <CardDescription>This is a preview; nothing on this page works yet.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-2.5">
                {PLANNED.map(({ icon: Icon, text }) => (
                  <li key={text} className="flex gap-2.5 text-sm">
                    <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                    {text}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
