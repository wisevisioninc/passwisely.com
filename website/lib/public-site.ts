import { env } from "cloudflare:workers";

const DEFAULT_PUBLIC_SITE_ORIGIN = "https://passwisely.cn";

/** Server-owned public origin for links that leave this application.
 * Request URLs/forwarding headers are neither canonical nor trusted: the local
 * Wrangler listener receives HTTP even when Nginx terminates public HTTPS.
 */
export function getPublicSiteOrigin(): string {
  const configured: unknown = (env as Record<string, unknown>).PUBLIC_SITE_URL;
  if (configured === undefined) return DEFAULT_PUBLIC_SITE_ORIGIN;
  if (typeof configured !== "string") throw new Error("Invalid PUBLIC_SITE_URL configuration.");
  const value = configured.trim();
  // Check origin-only syntax before URL parsing can normalize path traversal,
  // backslashes, empty query/fragment markers or embedded control characters.
  if (!/^[a-z][a-z0-9+.-]*:\/\/[^/?#\\@\s]+\/?$/i.test(value)) {
    throw new Error("Invalid PUBLIC_SITE_URL configuration.");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid PUBLIC_SITE_URL configuration.");
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Invalid PUBLIC_SITE_URL configuration.");
  }
  return url.origin;
}
