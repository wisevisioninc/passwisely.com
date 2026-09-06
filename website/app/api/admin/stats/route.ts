import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getAdminStats } from "@/lib/admin-data";
import { getAdminHealth } from "@/lib/admin-health";

export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }
  const startedAt = Date.now();
  const stats = await getAdminStats();
  const health = await getAdminHealth(Date.now() - startedAt);
  return Response.json({
    ...stats,
    ...health,
    generatedAt: new Date().toISOString(),
  }, {
    headers: { "cache-control": "no-store" },
  });
}
