import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const definition = protoLoader.loadSync(
  path.resolve(currentDir, "../proto/desktop_ai.proto"),
  { defaults: true },
);
const loaded = grpc.loadPackageDefinition(definition);
const Client = loaded.passwisely.desktop.v1.DesktopAI;
const address =
  process.env.PASSWISELY_GRPC_HEALTH_URL || "127.0.0.1:3012";
const credentials =
  process.env.PASSWISELY_GRPC_HEALTH_TLS === "1"
    ? grpc.credentials.createSsl()
    : grpc.credentials.createInsecure();
const client = new Client(address, credentials);

function finish(error, response) {
  client.close();
  if (error || response?.status !== "SERVING") {
    console.error(error?.details || error?.message || "Desktop API is not serving.");
    process.exit(1);
  }
  console.log(`${response.status} ${response.transport}`);
}

const deadline = Date.now() + 5_000;
// systemd starts ExecStartPost before a Type=simple service finishes binding.
client.waitForReady(deadline, (error) => {
  if (error) return finish(error);
  client.Health({}, { deadline }, finish);
});
