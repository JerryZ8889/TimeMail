export function getOptionalEnv(name: string): string | undefined {
  const v = process.env[name];
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  return trimmed.length ? trimmed : undefined;
}

export function getRequiredEnv(name: string): string {
  const v = getOptionalEnv(name);
  if (!v) {
    throw new Error(`Missing env: ${name}`);
  }
  return v;
}

