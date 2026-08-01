import { X509Certificate } from "node:crypto";
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const source = new URL("../.env.production", import.meta.url);
const destinationDirectory = new URL("../dist/server/", import.meta.url);
const destination = new URL(".dev.vars", destinationDirectory);

try {
  await access(source);
} catch {
  process.exit(0);
}

await mkdir(destinationDirectory, { recursive: true });
const sourcePath = fileURLToPath(source);
const sourceDirectory = dirname(sourcePath);
const values = new Map();
for (const line of (await readFile(source, "utf8")).split(/\r?\n/)) {
  const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!match) continue;
  values.set(
    match[1],
    match[2].trim().replace(/^(['"])(.*)\1$/, "$2"),
  );
}

function credentialPath(name, fallbackName) {
  const configured = values.get(name);
  if (configured) {
    return isAbsolute(configured)
      ? configured
      : resolve(sourceDirectory, configured);
  }
  const directory = values.get("WECHAT_V3_CERT");
  if (!directory) return "";
  const resolvedDirectory = isAbsolute(directory)
    ? directory
    : resolve(sourceDirectory, directory);
  return resolve(resolvedDirectory, fallbackName);
}

async function setPemFromPath(targetName, pathName, fallbackName) {
  if (values.get(targetName)) return;
  const path = credentialPath(pathName, fallbackName);
  if (!path) return;
  try {
    values.set(targetName, await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(
        `${targetName} credential file was not found at ${path}.`,
        { cause: error },
      );
    }
    throw error;
  }
}

await setPemFromPath(
  "WECHAT_PAY_PRIVATE_KEY",
  "WECHAT_V3_CERT_PE",
  "apiclient_key.pem",
);
await setPemFromPath(
  "WECHAT_PAY_PUBLIC_KEY",
  "WECHAT_PUB_KEY",
  "wechatpay_public_key.pem",
);

if (!values.get("WECHAT_PAY_MCH_SERIAL_NO")) {
  const certificatePath = credentialPath(
    "WECHAT_V3_CERT_PEM",
    "apiclient_cert.pem",
  );
  if (certificatePath) {
    const certificate = new X509Certificate(await readFile(certificatePath));
    values.set(
      "WECHAT_PAY_MCH_SERIAL_NO",
      certificate.serialNumber.replaceAll(":", ""),
    );
  }
}

values.set(
  "WECHAT_PAY_MCH_ID",
  values.get("WECHAT_PAY_MCH_ID") || "1748736064",
);
if (values.get("WECHAT_APIV3_KEY") && !values.get("WECHAT_PAY_API_V3_KEY")) {
  values.set("WECHAT_PAY_API_V3_KEY", values.get("WECHAT_APIV3_KEY"));
}
if (values.get("WECHAT_PUB_KEY_ID") && !values.get("WECHAT_PAY_PUBLIC_KEY_ID")) {
  values.set("WECHAT_PAY_PUBLIC_KEY_ID", values.get("WECHAT_PUB_KEY_ID"));
}

const serialized = [...values]
  .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
  .join("\n");
await writeFile(destination, `${serialized}\n`, { mode: 0o600 });
await chmod(destination, 0o600);
console.log("Staged protected runtime configuration.");
