import { getCurrentUser, jsonError } from "@/lib/auth";
import {
  CREDIT_PACKS,
  createStripeCheckout,
  isCreditPackId,
} from "@/lib/stripe";
import { getD1 } from "@/db";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return jsonError("Sign in before purchasing credits.", 401);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const packId = body.packId;
  if (!isCreditPackId(packId)) return jsonError("Unknown credit pack.", 400);
  const pack = CREDIT_PACKS[packId];
  const purchaseId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await getD1()
    .prepare(
      `INSERT INTO purchases
       (id, user_id, pack_id, credits, amount_cents, currency, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'usd', 'pending', ?)`,
    )
    .bind(purchaseId, user.id, packId, pack.credits, pack.amountCents, now)
    .run();

  try {
    const checkout = await createStripeCheckout({
      origin: new URL(request.url).origin,
      email: user.email,
      purchaseId,
      packId,
    });
    await getD1()
      .prepare("UPDATE purchases SET stripe_session_id = ? WHERE id = ?")
      .bind(checkout.id, purchaseId)
      .run();
    return Response.json({ url: checkout.url });
  } catch (error) {
    await getD1()
      .prepare("UPDATE purchases SET status = 'failed' WHERE id = ?")
      .bind(purchaseId)
      .run();
    return jsonError(
      error instanceof Error ? error.message : "Checkout is unavailable.",
      503,
    );
  }
}
