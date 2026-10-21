import { getApiUser } from "@/lib/auth";
import { getAccountUsage, parseUsageQuery } from "@/lib/account-usage";

const headers = { "cache-control": "no-store, private", vary: "Cookie, Authorization" };
export async function GET(request: Request): Promise<Response> {
  try {
    const user = await getApiUser(request);
    if (!user) return Response.json({ error: "Authentication required." }, { status: 401, headers });
    const query = parseUsageQuery(new URL(request.url));
    if (!query) return Response.json({ error: "Invalid usage period or cursor.", code: "INVALID_USAGE_QUERY" }, { status: 400, headers });
    // The authenticated identity owns this lookup. Client-supplied user IDs are never read.
    return Response.json({ user, ...await getAccountUsage(user.id, query) }, { headers });
  } catch {
    return Response.json({ error: "Usage statistics are temporarily unavailable.", code: "USAGE_UNAVAILABLE" }, { status: 503, headers });
  }
}
