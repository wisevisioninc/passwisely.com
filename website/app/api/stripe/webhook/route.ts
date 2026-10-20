import { verifyStripeSignature } from "@/lib/stripe";
import { completePurchase } from "@/lib/payments/orders";
import { adminRest } from "@/lib/supabase";

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
  // The transactional completion owner reads the historical order snapshot.
  const rows = await adminRest<Array<{ id: string }>>(
    `purchases?id=eq.${encodeURIComponent(purchaseId)}&select=id&limit=1`,
  );
  const row = rows[0];
  if (!row) return Response.json({ error: "Order not found." }, { status: 404 });
  await completePurchase({
    purchase: { id: row.id },
    transactionId: event.data?.object?.payment_intent || event.id,
    eventId: event.id,
    eventType: event.type,
  });
  return Response.json({ received: true });
}
