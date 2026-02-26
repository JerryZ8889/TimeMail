import { createHash } from "crypto";

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function canonicalizeUrl(input: string): string {
  try {
    const u = new URL(input);
    const drop = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "utm_id",
      "utm_name",
      "gclid",
      "fbclid",
      "igshid",
    ];
    for (const k of drop) u.searchParams.delete(k);
    u.hash = "";
    return u.toString();
  } catch {
    return input;
  }
}

export function normalizeTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim();
}

