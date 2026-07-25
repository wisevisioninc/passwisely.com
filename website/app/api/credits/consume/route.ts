import { getApiUser, jsonError } from "@/lib/auth";
import { getD1 } from "@/db";

const ALLOWED_ACTIONS: Record<string, number> = {
  solve: 1,
  debug: 1,
  followup: 1,
  resume_review: 2,
  resume_optimize: 3,
  interview_plan: 3,
};

export async function POST(request: Request) {
  const user = await getApiUser(request);
  if (!user) return jsonError("Authentication required.", 401);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";
  const cost = ALLOWED_ACTIONS[action];
  const requestId =
    typeof body.requestId === "string" && /^[A-Za-z0-9_-]{8,100}$/.test(body.requestId)
      ? body.requestId
      : "";
  if (!cost || !requestId) return jsonError("Invalid credit request.", 400);

  const reference = `usage:${user.id}:${requestId}`;
  const existing = await getD1()
    .prepare(
      "SELECT balance_after AS balanceAfter FROM credit_transactions WHERE reference = ?",
    )
    .bind(reference)
    .first<{ balanceAfter: number }>();
  if (existing) {
    return Response.json({ success: true, credits: existing.balanceAfter, cost });
  }

  const now = Math.floor(Date.now() / 1000);
  const transactionId = crypto.randomUUID();
  const reservation = await getD1()
    .prepare(
      `INSERT OR IGNORE INTO credit_transactions
       (id, user_id, amount, balance_after, type, reference, created_at)
       VALUES (?, ?, 0, ?, ?, ?, ?)`,
    )
    .bind(transactionId, user.id, user.credits, action, reference, now)
    .run();
  if (reservation.meta.changes === 0) {
    const duplicate = await getD1()
      .prepare(
        "SELECT balance_after AS balanceAfter FROM credit_transactions WHERE reference = ?",
      )
      .bind(reference)
      .first<{ balanceAfter: number }>();
    return Response.json({
      success: true,
      credits: duplicate?.balanceAfter ?? user.credits,
      cost,
    });
  }

  const update = await getD1()
    .prepare(
      "UPDATE users SET credits = credits - ?, updated_at = ? WHERE id = ? AND credits >= ? RETURNING credits",
    )
    .bind(cost, now, user.id, cost)
    .first<{ credits: number }>();
  if (!update) {
    await getD1()
      .prepare("DELETE FROM credit_transactions WHERE id = ?")
      .bind(transactionId)
      .run();
    return jsonError("Not enough credits.", 402);
  }

  await getD1()
    .prepare(
      `UPDATE credit_transactions
       SET amount = ?, balance_after = ?
       WHERE id = ?`,
    )
    .bind(-cost, update.credits, transactionId)
    .run();
  return Response.json({ success: true, credits: update.credits, cost });
}
