const encoder = new TextEncoder();

function pemBody(value: string): string {
  return value
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s/g, "");
}

export function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

export function encodeBase64(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    asArrayBuffer(decodeBase64(pemBody(pem))),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function importPublicKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    asArrayBuffer(decodeBase64(pemBody(pem))),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

export async function rsaSha256Sign(
  message: string,
  privateKeyPem: string,
): Promise<string> {
  const key = await importPrivateKey(privateKeyPem);
  return encodeBase64(
    await crypto.subtle.sign(
      { name: "RSASSA-PKCS1-v1_5" },
      key,
      encoder.encode(message),
    ),
  );
}

export async function rsaSha256Verify(
  message: string,
  signature: string,
  publicKeyPem: string,
): Promise<boolean> {
  try {
    const key = await importPublicKey(publicKeyPem);
    return crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      key,
      asArrayBuffer(decodeBase64(signature)),
      encoder.encode(message),
    );
  } catch {
    return false;
  }
}

export async function decryptWechatResource(
  ciphertext: string,
  nonce: string,
  associatedData: string,
  apiV3Key: string,
): Promise<string> {
  const keyBytes = encoder.encode(apiV3Key);
  if (keyBytes.byteLength !== 32) {
    throw new Error("WECHAT_PAY_API_V3_KEY must contain exactly 32 bytes.");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: encoder.encode(nonce),
      additionalData: encoder.encode(associatedData),
      tagLength: 128,
    },
    key,
    asArrayBuffer(decodeBase64(ciphertext)),
  );
  return new TextDecoder().decode(decrypted);
}
