import { getSha256 } from "./sha256.js";

const gravatarCache = new Map();

export function gravatarUrl(item) {
  const email = item.author?.email ?? item.author?.name ?? crypto.randomUUID();
  const normalized = email.trim().toLowerCase();
  if (!gravatarCache.has(normalized)) {
    const sha = getSha256(normalized);
    gravatarCache.set(normalized, `https://gravatar.com/avatar/${sha}?d=identicon`);
  }
  return gravatarCache.get(normalized);
}
