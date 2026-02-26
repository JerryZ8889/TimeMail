import { DateTime } from "luxon";

export function computeWindowEndShanghai(now = DateTime.now()): DateTime {
  const shNow = now.setZone("Asia/Shanghai");
  const today0800 = shNow.startOf("day").plus({ hours: 8 });
  if (shNow < today0800) return today0800.minus({ days: 1 });
  return today0800;
}

export function toIso(dt: DateTime): string {
  return dt.toUTC().toISO({ suppressMilliseconds: true }) ?? dt.toUTC().toISO() ?? "";
}

