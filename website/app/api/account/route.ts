import { getApiUser, jsonError } from "@/lib/auth";
import { getD1 } from "@/db";

export async function GET(request: Request) {
  const user = await getApiUser(request);
  if (!user) return jsonError("Authentication required.", 401);
  const transactions = await getD1()
    .prepare(
      `SELECT id, amount, balance_after AS balanceAfter, type, reference, created_at AS createdAt
       FROM credit_transactions WHERE user_id = ?
       ORDER BY created_at DESC LIMIT 30`,
    )
    .bind(user.id)
    .all();
  return Response.json({ user, transactions: transactions.results });
}
