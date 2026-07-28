import assert from "node:assert/strict";

const apiBase = (
  process.env.PASSWISELY_TEST_API_URL || "https://passwisely.com/api"
).replace(/\/+$/, "");
const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const email = `supabase-e2e-${suffix}@example.com`;
const password = `Pw${crypto.randomUUID()}A1`;
let userId = "";

async function request(path, init = {}, token = "") {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body) headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`${apiBase}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function cleanup() {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!userId || !url || !key) return false;
  const response = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  return response.ok;
}

try {
  const registration = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, locale: "zh", client: "desktop" }),
  });
  assert.equal(
    registration.response.status,
    200,
    `registration failed: ${registration.payload.error || registration.response.status}`,
  );
  const token = registration.payload.token;
  userId = registration.payload.user?.id || "";
  assert.ok(token);
  assert.ok(userId);
  assert.equal(registration.payload.user.credits, 10);

  const initialAccount = await request("/account", {}, token);
  assert.equal(initialAccount.response.status, 200);
  assert.equal(initialAccount.payload.user.credits, 10);
  assert.equal(initialAccount.payload.transactions.length, 1);
  assert.equal(initialAccount.payload.transactions[0].type, "welcome");

  const requestId = `e2e_${crypto.randomUUID().replaceAll("-", "")}`;
  const firstDebit = await request(
    "/credits/consume",
    {
      method: "POST",
      body: JSON.stringify({ action: "solve", requestId }),
    },
    token,
  );
  assert.equal(firstDebit.response.status, 200);
  assert.equal(firstDebit.payload.credits, 9);
  assert.equal(firstDebit.payload.duplicate, false);

  const duplicateDebit = await request(
    "/credits/consume",
    {
      method: "POST",
      body: JSON.stringify({ action: "solve", requestId }),
    },
    token,
  );
  assert.equal(duplicateDebit.response.status, 200);
  assert.equal(duplicateDebit.payload.credits, 9);
  assert.equal(duplicateDebit.payload.duplicate, true);

  for (let index = 0; index < 9; index += 1) {
    const debit = await request(
      "/credits/consume",
      {
        method: "POST",
        body: JSON.stringify({
          action: "solve",
          requestId: `e2e_${index}_${crypto.randomUUID().replaceAll("-", "")}`,
        }),
      },
      token,
    );
    assert.equal(debit.response.status, 200);
    assert.equal(debit.payload.credits, 8 - index);
  }

  const insufficient = await request(
    "/credits/consume",
    {
      method: "POST",
      body: JSON.stringify({
        action: "solve",
        requestId: `e2e_empty_${crypto.randomUUID().replaceAll("-", "")}`,
      }),
    },
    token,
  );
  assert.equal(insufficient.response.status, 402);

  const login = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password, client: "desktop" }),
  });
  assert.equal(login.response.status, 200);
  assert.ok(login.payload.token);
  assert.equal(login.payload.user.credits, 0);

  const finalAccount = await request("/account", {}, login.payload.token);
  assert.equal(finalAccount.response.status, 200);
  assert.equal(finalAccount.payload.user.credits, 0);
  assert.equal(finalAccount.payload.transactions.length, 11);

  console.log(
    JSON.stringify({
      success: true,
      registered: true,
      login: true,
      welcomeCredits: 10,
      finalCredits: 0,
      duplicateDebitPrevented: true,
      insufficientCreditsBlocked: true,
      transactionCount: finalAccount.payload.transactions.length,
    }),
  );
} finally {
  const cleaned = await cleanup();
  if (userId) console.log(JSON.stringify({ testUserCleaned: cleaned }));
}
