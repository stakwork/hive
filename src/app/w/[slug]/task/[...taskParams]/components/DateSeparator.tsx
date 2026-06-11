export function DateSeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 my-2">
      <div className="flex-1 h-px bg-border" />
      <span className="text-xs text-muted-foreground font-medium px-2">{label}</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}
