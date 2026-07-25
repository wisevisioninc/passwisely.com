import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getD1(): D1Database {
  const bindings = env as unknown as { DB?: D1Database };
  if (!bindings.DB) {
    throw new Error("Database is temporarily unavailable.");
  }
  return bindings.DB;
}

export function getDb() {
  const database = getD1();

  return drizzle(database, { schema });
}
