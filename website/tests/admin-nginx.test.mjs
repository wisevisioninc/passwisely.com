import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("admin host proxies the client bundles needed to hydrate the dashboard", async () => {
  const nginx = await readFile(new URL("../nginx/passwisely.conf", import.meta.url), "utf8");
  const adminServer = nginx.slice(nginx.indexOf("server_name admin.passwisely.com"));

  assert.match(adminServer, /location \/assets\/ \{[\s\S]*?proxy_pass http:\/\/127\.0\.0\.1:3011;/);
  assert.match(adminServer, /location = \/passwisely-logo-192\.png \{[\s\S]*?proxy_pass http:\/\/127\.0\.0\.1:3011;/);
});
