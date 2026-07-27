import { getD1 } from "@/db";
import {
  CREDIT_PACKS,
  type CreditPackId,
  type PaymentProvider,
} from "./catalog";

export interface PurchaseRow {
  id: string;
  userId: string;
  merchantOrderNo: string;
  provider: PaymentProvider;
  credits: number;
  amountMinor: number;
  currency: string;
  status: string;
  providerTransactionId: string | null;
}

function merchantOrderNo(): string {
  const random = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  return `PW${Date.now().toString(36)}${random}`.toUpperCase();
}

export async function createPurchase(input: {
  userId: string;
  packId: CreditPackId;
  provider: PaymentProvider;
}): Promise<PurchaseRow> {
  const pack = CREDIT_PACKS[input.packId];
  const purchase: PurchaseRow = {
    id: crypto.randomUUID(),
    userId: input.userId,
    merchantOrderNo: merchantOrderNo(),
    provider: input.provider,
    credits: pack.credits,
    amountMinor: pack.amountFen,
    currency: "CNY",
    status: "pending",
    providerTransactionId: null,
  };
  await getD1()
    .prepare(
      `INSERT INTO purchases
       (id, user_id, pack_id, credits, amount_cents, currency, status,
        provider, merchant_order_no, amount_minor, created_at)
       VALUES (?, ?, ?, ?, ?, 'CNY', 'pending', ?, ?, ?, ?)`,
    )
    .bind(
      purchase.id,
      purchase.userId,
      input.packId,
      purchase.credits,
      purchase.amountMinor,
      purchase.provider,
      purchase.merchantOrderNo,
      purchase.amountMinor,
      Math.floor(Date.now() / 1000),
    )
    .run();
  return purchase;
}

export async function findPurchaseByMerchantOrder(
  merchantOrderNo: string,
): Promise<PurchaseRow | null> {
  const row = await getD1()
    .prepare(
      `SELECT id, user_id AS userId, merchant_order_no AS merchantOrderNo,
              provider, credits, amount_minor AS amountMinor, currency, status,
              provider_transaction_id AS providerTransactionId
       FROM purchases WHERE merchant_order_no = ?`,
    )
    .bind(merchantOrderNo)
    .first<PurchaseRow>();
  return row || null;
}

export async function markPurchaseFailed(id: string): Promise<void> {
  await getD1()
    .prepare("UPDATE purchases SET status = 'failed' WHERE id = ? AND status = 'pending'")
    .bind(id)
    .run();
}

export async function completePurchase(input: {
  purchase: PurchaseRow;
  eventId: string;
  eventType: string;
  transactionId: string;
}): Promise<"completed" | "duplicate"> {
  const db = getD1();
  if (
    input.purchase.status === "completed" &&
    input.purchase.providerTransactionId === input.transactionId
  ) {
    return "duplicate";
  }
  if (input.purchase.status !== "pending") {
    throw new Error(`Purchase is not payable: ${input.purchase.status}`);
  }
  const claimed = await db
    .prepare(
      "UPDATE purchases SET status = 'processing' WHERE id = ? AND status = 'pending'",
    )
    .bind(input.purchase.id)
    .run();
  if ((claimed.meta?.changes || 0) !== 1) return "duplicate";

  const now = Math.floor(Date.now() / 1000);
  try {
    await db.batch([
      db
        .prepare("UPDATE users SET credits = credits + ?, updated_at = ? WHERE id = ?")
        .bind(input.purchase.credits, now, input.purchase.userId),
      db
        .prepare(
          `INSERT INTO credit_transactions
           (id, user_id, amount, balance_after, type, reference, created_at)
           SELECT ?, ?, ?, credits, 'purchase', ?, ? FROM users WHERE id = ?`,
        )
        .bind(
          crypto.randomUUID(),
          input.purchase.userId,
          input.purchase.credits,
          `purchase:${input.purchase.id}`,
          now,
          input.purchase.userId,
        ),
      db
        .prepare(
          `UPDATE purchases SET status = 'completed',
           provider_transaction_id = ?, completed_at = ?
           WHERE id = ? AND status = 'processing'`,
        )
        .bind(input.transactionId, now, input.purchase.id),
      db
        .prepare(
          `INSERT OR IGNORE INTO webhook_events
           (id, event_type, created_at) VALUES (?, ?, ?)`,
        )
        .bind(input.eventId, input.eventType, now),
    ]);
  } catch (error) {
    await db
      .prepare("UPDATE purchases SET status = 'pending' WHERE id = ? AND status = 'processing'")
      .bind(input.purchase.id)
      .run();
    throw error;
  }
  return "completed";
}
