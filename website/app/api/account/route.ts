import { getApiUser, jsonError } from "@/lib/auth";
import { adminRest } from "@/lib/supabase";

export async function GET(request: Request) {
  const user = await getApiUser(request);
  if (!user) return jsonError("Authentication required.", 401);
  const transactions = await adminRest<
    Array<{
      id: string;
      amount: number;
      balance_after: number;
      type: string;
      reference: string;
      created_at: string;
    }>
  >(
    `credit_transactions?user_id=eq.${encodeURIComponent(user.id)}&select=id,amount,balance_after,type,reference,created_at&order=created_at.desc&limit=30`,
  );
  return Response.json({
    user,
    transactions: transactions.map((transaction) => ({
      id: transaction.id,
      amount: transaction.amount,
      balanceAfter: transaction.balance_after,
      type: transaction.type,
      reference: transaction.reference,
      createdAt: Math.floor(new Date(transaction.created_at).getTime() / 1000),
    })),
  });
}
