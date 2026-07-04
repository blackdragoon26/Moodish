export const DEFAULT_USER_HASH = "sha256:fixture-user";

export const dietaryTags = [
  "veg",
  "non-veg",
  "vegan",
  "jain",
  "high-protein",
  "low-carb",
  "no-onion-garlic"
];

export function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function normalizeList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).map((v) => v.trim()).filter(Boolean);
  return String(value)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export function nowIso() {
  return new Date().toISOString();
}

export function makeRecommendationId(prefix = "rec") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
