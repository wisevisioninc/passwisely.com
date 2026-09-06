import { adminCredentials } from "@/lib/admin-auth";

const PREFIX = "enc:v1:";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function encryptionKey(): Promise<CryptoKey> {
  const secret = adminCredentials().secret;
  if (!secret) throw new Error("Admin session secret is not configured.");
  const keyBytes = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`passwisely:admin-settings:${secret}`),
  );
  return crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptAdminSecret(value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(),
    encoder.encode(value),
  );
  return `${PREFIX}${encodeBase64Url(iv)}:${encodeBase64Url(
    new Uint8Array(encrypted),
  )}`;
}

export async function decryptAdminSecret(value: string): Promise<string> {
  // Compatibility for a manually seeded value. Saving it again in the admin
  // console upgrades it to authenticated AES-GCM ciphertext.
  if (!value.startsWith(PREFIX)) return value;
  const [ivValue, encryptedValue] = value.slice(PREFIX.length).split(":");
  if (!ivValue || !encryptedValue) throw new Error("Invalid encrypted setting.");
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decodeBase64Url(ivValue) },
    await encryptionKey(),
    decodeBase64Url(encryptedValue),
  );
  return decoder.decode(decrypted);
}
