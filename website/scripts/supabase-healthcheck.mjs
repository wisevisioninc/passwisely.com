import { pathToFileURL } from "node:url";

const TABLES = ["profiles", "credit_transactions", "purchases"];

export function configFromEnvironment(environment = process.env) {
  const url = environment.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const key =
    environment.SUPABASE_SECRET_KEY?.trim() ||
    environment.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url) {
    throw new Error("SUPABASE_URL is not configured.");
  }
  if (!key) {
    throw new Error(
      "SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is not configured.",
    );
  }

  return { url, key };
}

export async function checkSupabase(
  { url, key },
  fetchImplementation = globalThis.fetch,
) {
  const startedAt = Date.now();
  const checks = [];

  for (const table of TABLES) {
    const response = await fetchImplementation(
      `${url}/rest/v1/${table}?select=id&limit=1`,
      {
        method: "GET",
        headers: {
          accept: "application/json",
          apikey: key,
          authorization: `Bearer ${key}`,
          "x-client-info": "passwisely-wise-healthcheck/1.0",
        },
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (!response.ok) {
      const details = (await response.text()).slice(0, 300);
      throw new Error(
        `Supabase ${table} check failed (${response.status}): ${details}`,
      );
    }

    await response.arrayBuffer();
    checks.push(table);
  }

  return {
    success: true,
    checks,
    latencyMs: Date.now() - startedAt,
  };
}

async function main() {
  const result = await checkSupabase(configFromEnvironment());
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      ...result,
    }),
  );
}

const entryPoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";

if (entryPoint === import.meta.url) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exitCode = 1;
  });
}
