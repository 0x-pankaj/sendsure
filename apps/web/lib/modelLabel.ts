/** A model id as people read it: "claude-opus-5-5" or "anthropic/claude-opus-5.5" -> "Claude Opus 5.5". */
export function modelLabel(id: string | undefined | null): string {
  if (!id) return "Claude";
  const m = /claude-([a-z]+)-(\d+)(?:[-.](\d+))?/i.exec(id);
  if (!m) return id;
  const name = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1);
  return `Claude ${name} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
}
