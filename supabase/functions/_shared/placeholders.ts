// The model may only cite figures as placeholders like {weekly_remaining}.
// Code fills them from the database after the write commits. A literal digit
// outside a placeholder fails validation and the model's line is dropped.

export const PLACEHOLDERS = [
  "weekly_total",
  "weekly_remaining",
  "weekly_limit",
  "today_total",
  "logged_count",
  "logged_beverage",
  "logged_date",
  "pace_label",
  "event_title",
  "event_when",
  "standard_drink",
] as const;

export type PlaceholderKey = typeof PLACEHOLDERS[number];
export type PlaceholderValues = Partial<Record<PlaceholderKey, string>>;

const TOKEN = /\{([a-z_]+)\}/g;

export interface ReplyValidation {
  ok: boolean;
  reason?: "literal_digit" | "unknown_placeholder" | "too_long" | "empty";
}

export const MAX_REPLY_CHARS = 420;

export function validateReplyTemplate(reply: string): ReplyValidation {
  const trimmed = reply.trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  if (trimmed.length > MAX_REPLY_CHARS) return { ok: false, reason: "too_long" };
  const stripped = trimmed.replace(TOKEN, "");
  if (/\d/.test(stripped)) return { ok: false, reason: "literal_digit" };
  for (const m of trimmed.matchAll(TOKEN)) {
    if (!(PLACEHOLDERS as ReadonlyArray<string>).includes(m[1])) {
      return { ok: false, reason: "unknown_placeholder" };
    }
  }
  return { ok: true };
}

/** Fill placeholders; any still-unknown key becomes an empty string. */
export function fillPlaceholders(template: string, values: PlaceholderValues): string {
  return template
    .replace(TOKEN, (_, key: string) => values[key as PlaceholderKey] ?? "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,!?])/g, "$1")
    .trim();
}

/** Fixed fallback lines when the model's reply is dropped. */
export function fallbackReply(kind: "logged" | "corrected" | "undone" | "event" | "goal" | "pref" | "generic"): string {
  switch (kind) {
    case "logged": return "Logged. {pace_label}";
    case "corrected": return "Updated. {pace_label}";
    case "undone": return "Undone. {pace_label}";
    case "event": return "Saved {event_title} for {event_when}. I'll check in a few hours before.";
    case "goal": return "Goal set: {weekly_limit} standard drinks a week.";
    case "pref": return "Done. You can change reminders any time in Settings.";
    default: return ""; // when there is nothing to say, say nothing
  }
}
