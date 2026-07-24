import type { Entity } from "@/lib/types";

/** Same (label + lowercased text) key used everywhere a value needs to resolve to the same placeholder. */
export function placeholderKeyFor(entity: Entity): string {
  return `${entity.label}::${entity.text.trim().toLowerCase()}`;
}

/**
 * Assigns one placeholder per unique (label, value) pair, in first-seen
 * document order (by page, then position) — used identically by both the
 * redacted-text export and the visually-redacted PDF's on-page labels, so
 * "PATIENT_NAME_1" always means the same real value in both artifacts.
 */
export function buildPlaceholderMap(entities: Entity[]): Map<string, string> {
  const ordered = [...entities]
    .filter((e) => e.accepted)
    .sort((a, b) => a.page - b.page || a.start - b.start);

  const map = new Map<string, string>();
  const counterByLabel = new Map<string, number>();

  for (const entity of ordered) {
    const key = placeholderKeyFor(entity);
    if (map.has(key)) continue;
    const next = (counterByLabel.get(entity.label) ?? 0) + 1;
    counterByLabel.set(entity.label, next);
    map.set(key, `[${entity.label}_${next}]`);
  }

  return map;
}
