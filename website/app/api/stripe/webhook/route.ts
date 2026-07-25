import { getD1 } from "@/db";
import { verifyStripeSignature } from "@/lib/stripe";

interface StripeEvent {
  id: string;
  type: string;
  data?: {
    object?: {
      payment_intent?: string;
      metadata?: { purchaseId?: string };
    };
  };
}

export async function POST(request: Request) {
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature") || "";
  if (!(await verifyStripeSignature(payload, signature))) {
    return Response.json({ error: "Invalid signature." }, { status: 400 });
  }
  const event = JSON.parse(payload) as StripeEvent;
  if (event.type !== "checkout.session.completed") {
    return Response.json({ received: true });
  }
  const purchaseId = event.data?.object?.metadata?.purchaseId;
  if (!purchaseId) {
    return Response.json({ error: "Missing purchase metadata." }, { status: 400 });
  }
  const now = Math.floor(Date.now() / 1000);
  const db = getD1();
  await db.batch([
    db
      .prepare(
        `UPDATE users
         SET credits = credits + (
           SELECT credits FROM purchases WHERE id = ? AND status = 'pending'
         ), updated_at = ?
         WHERE id = (
           SELECT user_id FROM purchases WHERE id = ? AND status = 'pending'
         )`,
      )
      .bind(purchaseId, now, purchaseId),
    db
      .prepare(
        `INSERT OR IGNORE INTO credit_transactions
         (id, user_id, amount, balance_after, type, reference, created_at)
         SELECT ?, p.user_id, p.credits, u.credits, 'purchase', ?, ?
         FROM purchases p JOIN users u ON u.id = p.user_id
         WHERE p.id = ? AND p.status = 'pending'`,
      )
      .bind(crypto.randomUUID(), `purchase:${purchaseId}`, now, purchaseId),
    db
      .prepare(
        `UPDATE purchases
         SET status = 'completed', stripe_payment_intent = ?, completed_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .bind(event.data?.object?.payment_intent || null, now, purchaseId),
    db
      .prepare(
        "INSERT OR IGNORE INTO webhook_events (id, event_type, created_at) VALUES (?, ?, ?)",
      )
      .bind(event.id, event.type, now),
  ]);
  return Response.json({ received: true });
}
