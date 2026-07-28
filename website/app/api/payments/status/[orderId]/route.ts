import { getCurrentUser, jsonError } from "@/lib/auth";
import { adminRest } from "@/lib/supabase";

export async function GET(
  _request: Request,
  context: { params: Promise<{ orderId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return jsonError("Authentication required.", 401);
  const { orderId } = await context.params;
  const purchases = await adminRest<
    Array<{
      id: string;
      status: string;
      provider: string;
      completed_at: string | null;
    }>
  >(
    `purchases?id=eq.${encodeURIComponent(orderId)}&user_id=eq.${encodeURIComponent(user.id)}&select=id,status,provider,completed_at&limit=1`,
  );
  const row = purchases[0];
  const purchase = row
    ? {
        id: row.id,
        status: row.status,
        provider: row.provider,
        completedAt: row.completed_at
          ? Math.floor(new Date(row.completed_at).getTime() / 1000)
          : null,
      }
    : null;
  if (!purchase) return jsonError("Order not found.", 404);
  return Response.json({ order: purchase });
}
