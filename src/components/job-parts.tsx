"use client";

// The cards on a job's page beyond the basics: keywords, tailored CV, interview prep, emails, contacts and offer.
import { useEffect, useState } from "react";
import Link from "next/link";
import { BadgeDollarSign, CircleAlert, FileUser, Mail, MessagesSquare, Plus, Trash2, Users } from "lucide-react";
import {
  CopyButton,
  DownloadButton,
  Field,
  ToCheck,
  useAutosave,
  WriteButton,
  WriteError,
  type WriteKind,
} from "@/components/job-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { JobContact, JobEmailKind, JobOffer, JobRecord } from "@/lib/db.ts";
import { OFFER_LABELS } from "@/lib/job-status.ts";

export type PartProps = {
  job: JobRecord;
  writing: WriteKind[];
  errors: Partial<Record<WriteKind, string>>;
  onWrite: (kind: WriteKind, body?: Record<string, unknown>) => void;
  onPatch: (changes: Record<string, unknown>) => Promise<unknown>;
};

// --- Keywords ---

export function Keywords({ keywords }: { keywords: { found: string[]; missing: string[] } | null }) {
  if (!keywords || keywords.found.length + keywords.missing.length === 0) return null;
  return (
    <div className="grid gap-2 border-t pt-4">
      <h3 className="text-sm font-medium">Keywords from the job</h3>
      {keywords.found.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          In your profile:
          {keywords.found.map((term) => (
            <Badge key={term} variant="secondary">
              {term}
            </Badge>
          ))}
        </div>
      )}
      {keywords.missing.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          Not in your profile:
          {keywords.missing.map((term) => (
            <Badge key={term} variant="outline">
              {term}
            </Badge>
          ))}
        </div>
      )}
      {keywords.missing.length > 0 && (
        <p className="text-xs text-muted-foreground">
          If you do have some of these, add them to your{" "}
          <Link href="/profile" className="underline underline-offset-4">
            Profile or CV
          </Link>{" "}
          so the drafts can use them. Leave out the ones that aren&apos;t true.
        </p>
      )}
    </div>
  );
}

// --- Tailored CV ---

export function TailoredCvCard({ job, writing, errors, onWrite, onPatch }: PartProps) {
  const saved = job.tailoredCv?.text ?? "";
  const [text, setText] = useState(saved);
  // A new draft replaces what's in the box.
  useEffect(() => setText(job.tailoredCv?.text ?? ""), [job.tailoredCv?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  useAutosave(text, saved, (value) => onPatch({ tailoredCv: value }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileUser className="size-4" /> CV for this job
        </CardTitle>
        <CardDescription>
          Your CV reordered and reworded for this job, from your profile only. Nothing new is added.
        </CardDescription>
        {text && (
          <CardAction className="flex gap-2">
            <CopyButton text={text} />
            <DownloadButton href={`/api/jobs/${job.id}/docx?doc=cv`} />
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="grid gap-4">
        {(text || job.tailoredCv) && (
          <>
            <Textarea
              aria-label="CV for this job"
              rows={18}
              maxLength={10_000}
              value={text}
              onChange={(event) => setText(event.target.value)}
              className="max-h-[40rem] font-mono text-xs leading-relaxed"
            />
            <p className="text-xs text-muted-foreground">
              Fill in your email, phone and LinkedIn on the second line. Lines starting with # become headings in the
              .docx, and lines starting with - become bullets.
            </p>
          </>
        )}
        {job.tailoredCv && text === saved && <ToCheck items={job.tailoredCv.unverified} />}
        <WriteButton
          kind="cv"
          done={Boolean(job.tailoredCv)}
          writing={writing.includes("cv")}
          disabled={!job.description.trim()}
          label={job.tailoredCv ? "Write a new version" : "Tailor my CV"}
          confirm={job.tailoredCv ? "This replaces the CV above, including your edits." : undefined}
          onClick={() => onWrite("cv")}
        />
        <WriteError message={errors.cv} />
      </CardContent>
    </Card>
  );
}

// --- Interview prep ---

export function InterviewCard({ job, writing, errors, onWrite }: PartProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessagesSquare className="size-4" /> Interview prep
        </CardTitle>
        <CardDescription>
          Questions this job is likely to bring up, with answers from your experience and what to prepare yourself.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {job.interview && (
          <ol className="grid gap-5">
            {job.interview.questions.map((item, i) => (
              <li key={`${i}-${item.question}`} className="grid gap-1.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium">
                    {i + 1}. {item.question}
                  </p>
                  {item.answer && <CopyButton text={item.answer} small />}
                </div>
                {item.why && <p className="text-xs text-muted-foreground">{item.why}</p>}
                {item.answer ? (
                  <p className="rounded-md bg-muted/50 p-3 text-sm">{item.answer}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">Your profile can&apos;t answer this one yet.</p>
                )}
                {item.gap && (
                  <p className="flex gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                    <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
                    Prepare: {item.gap}
                  </p>
                )}
                <ToCheck items={item.unverified} />
              </li>
            ))}
          </ol>
        )}
        <WriteButton
          kind="interview"
          done={Boolean(job.interview)}
          writing={writing.includes("interview")}
          disabled={!job.description.trim()}
          label={job.interview ? "New questions" : "Prepare for the interview"}
          confirm={job.interview ? "This replaces the questions above." : undefined}
          onClick={() => onWrite("interview")}
        />
        <WriteError message={errors.interview} />
      </CardContent>
    </Card>
  );
}

// --- Follow-up and thank-you emails ---

export function EmailCard({ job, writing, errors, onWrite, onPatch }: PartProps) {
  const saved = job.email?.text ?? "";
  const [text, setText] = useState(saved);
  const [kind, setKind] = useState<JobEmailKind>(job.email?.kind ?? (job.status === "interview" ? "thank-you" : "follow-up"));
  useEffect(() => setText(job.email?.text ?? ""), [job.email?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  useAutosave(text, saved, (value) => onPatch({ email: value }));

  // "Subject: ..." on the first line goes into the email app's subject field.
  const [first, ...rest] = text.split("\n");
  const subject = /^subject:/i.test(first ?? "") ? first.replace(/^subject:\s*/i, "") : "";
  const body = (subject ? rest.join("\n") : text).trim();
  const to = job.contacts.find((contact) => contact.email.trim())?.email.trim() ?? "";
  const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="size-4" /> Follow-up email
        </CardTitle>
        <CardDescription>A short email you send yourself: a follow-up after applying, or a thank-you after an interview.</CardDescription>
        {text && (
          <CardAction className="flex gap-2">
            <CopyButton text={text} />
            <Button asChild size="sm" variant="outline">
              <a href={mailto}>
                <Mail />
                Open in email app
              </a>
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="grid gap-4">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          aria-label="Kind of email"
          className="justify-self-start"
          value={kind}
          onValueChange={(value) => value && setKind(value as JobEmailKind)}
        >
          <ToggleGroupItem value="follow-up">Follow-up</ToggleGroupItem>
          <ToggleGroupItem value="thank-you">Thank-you</ToggleGroupItem>
        </ToggleGroup>
        {(text || job.email) && (
          <Textarea
            aria-label="Email"
            rows={10}
            maxLength={5000}
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="max-h-96 leading-relaxed"
          />
        )}
        {job.email && text === saved && <ToCheck items={job.email.unverified} />}
        <p className="text-xs text-muted-foreground">
          {job.contacts.some((contact) => contact.name.trim())
            ? "It greets your first contact and uses your notes. Nothing is sent from Draftfox."
            : "Add a contact above to greet them by name. Your notes are used too. Nothing is sent from Draftfox."}
        </p>
        <WriteButton
          kind="email"
          done={Boolean(job.email)}
          writing={writing.includes("email")}
          disabled={false}
          label={kind === "thank-you" ? "Write a thank-you email" : "Write a follow-up email"}
          confirm={job.email ? "This replaces the email above, including your edits." : undefined}
          onClick={() => onWrite("email", { emailKind: kind })}
        />
        <WriteError message={errors.email} />
      </CardContent>
    </Card>
  );
}

// --- Contacts ---

const EMPTY_CONTACT: JobContact = { name: "", role: "", email: "", linkedin: "", notes: "" };

export function ContactsCard({ job, onPatch }: PartProps) {
  const [contacts, setContacts] = useState<JobContact[]>(job.contacts);
  useAutosave(contacts, job.contacts, (value) => onPatch({ contacts: value }));
  const set = (i: number, field: keyof JobContact, value: string) =>
    setContacts((current) => current.map((contact, j) => (j === i ? { ...contact, [field]: value } : contact)));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="size-4" /> Contacts
        </CardTitle>
        <CardDescription>Recruiters, hiring managers or people you know at the company.</CardDescription>
        <CardAction>
          <Button size="sm" variant="outline" disabled={contacts.length >= 10} onClick={() => setContacts((current) => [...current, EMPTY_CONTACT])}>
            <Plus />
            Add contact
          </Button>
        </CardAction>
      </CardHeader>
      {contacts.length > 0 && (
        <CardContent className="grid gap-4">
          {contacts.map((contact, i) => (
            <div key={i} className="grid gap-3 rounded-lg border p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id={`contact-name-${i}`} label="Name">
                  <Input id={`contact-name-${i}`} maxLength={200} value={contact.name} onChange={(event) => set(i, "name", event.target.value)} />
                </Field>
                <Field id={`contact-role-${i}`} label="Role">
                  <Input
                    id={`contact-role-${i}`}
                    maxLength={200}
                    value={contact.role}
                    placeholder="Recruiter, hiring manager…"
                    onChange={(event) => set(i, "role", event.target.value)}
                  />
                </Field>
                <Field id={`contact-email-${i}`} label="Email">
                  <Input id={`contact-email-${i}`} type="email" maxLength={200} value={contact.email} onChange={(event) => set(i, "email", event.target.value)} />
                </Field>
                <Field id={`contact-linkedin-${i}`} label="LinkedIn profile link">
                  <div className="flex gap-1">
                    <Input
                      id={`contact-linkedin-${i}`}
                      type="url"
                      maxLength={200}
                      value={contact.linkedin}
                      placeholder="https://www.linkedin.com/in/…"
                      onChange={(event) => set(i, "linkedin", event.target.value)}
                    />
                    {/^https?:\/\//.test(contact.linkedin) && (
                      <Button asChild size="icon" variant="ghost" aria-label="Open LinkedIn profile">
                        <a href={contact.linkedin} target="_blank" rel="noopener noreferrer">
                          <Users />
                        </a>
                      </Button>
                    )}
                  </div>
                </Field>
              </div>
              <div className="flex items-end gap-2">
                <div className="grid flex-1 gap-2">
                  <Field id={`contact-notes-${i}`} label="Notes">
                    <Input id={`contact-notes-${i}`} maxLength={2000} value={contact.notes} onChange={(event) => set(i, "notes", event.target.value)} />
                  </Field>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remove contact"
                  onClick={() => setContacts((current) => current.filter((_, j) => j !== i))}
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  );
}

// --- Offer ---

export const EMPTY_OFFER: JobOffer = { salary: "", bonus: "", equity: "", leave: "", benefits: "", workMode: "", startDate: "", deadline: "", notes: "" };

export function OfferCard({ job, onPatch }: PartProps) {
  const [offer, setOffer] = useState<JobOffer | null>(job.offer);
  useAutosave(offer, job.offer, (value) => onPatch({ offer: value }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BadgeDollarSign className="size-4" /> Offer details
        </CardTitle>
        <CardDescription>
          What the offer includes, in your words, to{" "}
          <Link href="/jobs/offers" className="underline underline-offset-4">
            compare offers side by side
          </Link>
          .
        </CardDescription>
        {!offer && (
          <CardAction>
            <Button size="sm" variant="outline" onClick={() => setOffer(EMPTY_OFFER)}>
              <Plus />
              Add offer details
            </Button>
          </CardAction>
        )}
      </CardHeader>
      {offer && (
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {(Object.keys(OFFER_LABELS) as (keyof JobOffer)[]).map((field) => (
            <Field key={field} id={`offer-${field}`} label={OFFER_LABELS[field].label}>
              <Input
                id={`offer-${field}`}
                maxLength={field === "notes" || field === "benefits" ? 2000 : 200}
                value={offer[field]}
                placeholder={OFFER_LABELS[field].placeholder}
                onChange={(event) => setOffer((current) => current && { ...current, [field]: event.target.value })}
              />
            </Field>
          ))}
          <Button size="sm" variant="ghost" className="justify-self-start text-destructive hover:text-destructive" onClick={() => setOffer(null)}>
            <Trash2 />
            Remove offer details
          </Button>
        </CardContent>
      )}
    </Card>
  );
}
