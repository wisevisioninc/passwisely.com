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
  const rows = await adminRest<
    Array<{
      id: string;
      user_id: string;
      merchant_order_no: string;
      provider: "stripe";
      credits: number;
      amount_minor: number;
      currency: string;
      status: string;
      provider_transaction_id: string | null;
    }>
  >(
    `purchases?id=eq.${encodeURIComponent(purchaseId)}&select=id,user_id,merchant_order_no,provider,credits,amount_minor,currency,status,provider_transaction_id&limit=1`,
  );
  const row = rows[0];
  if (!row) return Response.json({ error: "Order not found." }, { status: 404 });
  await completePurchase({
    purchase: {
      id: row.id,
      userId: row.user_id,
      merchantOrderNo: row.merchant_order_no,
      provider: row.provider,
      credits: row.credits,
      amountMinor: row.amount_minor,
      currency: row.currency,
      status: row.status,
      providerTransactionId: row.provider_transaction_id,
    },
    transactionId: event.data?.object?.payment_intent || event.id,
    eventId: event.id,
    eventType: event.type,
  });
  return Response.json({ received: true });
}
