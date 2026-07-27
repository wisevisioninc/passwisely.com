import { getD1 } from "@/db";
import { getCurrentUser, jsonError } from "@/lib/auth";

export async function GET(
  _request: Request,
  context: { params: Promise<{ orderId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return jsonError("Authentication required.", 401);
  const { orderId } = await context.params;
  const purchase = await getD1()
    .prepare(
      `SELECT id, status, provider, completed_at AS completedAt
       FROM purchases WHERE id = ? AND user_id = ?`,
    )
    .bind(orderId, user.id)
    .first();
  if (!purchase) return jsonError("Order not found.", 404);
  return Response.json({ order: purchase });
}
