export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
}: {
  title: string;
  // The section of the app this page belongs to, shown small above the title.
  eyebrow?: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="grid max-w-2xl gap-1.5">
        {eyebrow && (
          <p className="text-xs font-semibold tracking-[0.08em] text-brand-strong uppercase">{eyebrow}</p>
        )}
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem] sm:leading-tight">{title}</h1>
        {description && <p className="text-sm leading-relaxed text-pretty text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
