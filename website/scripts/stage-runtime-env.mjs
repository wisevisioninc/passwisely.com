import { access, chmod, copyFile, mkdir } from "node:fs/promises";

const source = new URL("../.env.production", import.meta.url);
const destinationDirectory = new URL("../dist/server/", import.meta.url);
const destination = new URL(".dev.vars", destinationDirectory);

try {
  await access(source);
} catch {
  process.exit(0);
}

await mkdir(destinationDirectory, { recursive: true });
await copyFile(source, destination);
await chmod(destination, 0o600);
console.log("Staged protected runtime configuration.");
