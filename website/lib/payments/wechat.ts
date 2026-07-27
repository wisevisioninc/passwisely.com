import { getWechatPayConfig } from "./config";
import { decryptWechatResource, rsaSha256Sign, rsaSha256Verify } from "./crypto";

function randomNonce(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

export async function createWechatNativePayment(input: {
  origin: string;
  merchantOrderNo: string;
  description: string;
  amountFen: number;
}): Promise<{ codeUrl: string }> {
  const config = getWechatPayConfig();
  const pathname = "/v3/pay/transactions/native";
  const body = JSON.stringify({
    appid: config.appId,
    mchid: config.mchId,
    description: input.description,
    out_trade_no: input.merchantOrderNo,
    notify_url: `${input.origin}/api/payments/wechat/notify`,
    amount: { total: input.amountFen, currency: "CNY" },
  });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomNonce();
  const signature = await rsaSha256Sign(
    `POST\n${pathname}\n${timestamp}\n${nonce}\n${body}\n`,
    config.merchantPrivateKey,
  );
  const authorization =
    `WECHATPAY2-SHA256-RSA2048 mchid="${config.mchId}",` +
    `nonce_str="${nonce}",signature="${signature}",` +
    `timestamp="${timestamp}",serial_no="${config.merchantSerialNo}"`;
  const response = await fetch(`https://api.mch.weixin.qq.com${pathname}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization,
      "content-type": "application/json",
      "user-agent": "PassWisely/1.0",
    },
    body,
  });
  const payload = (await response.json()) as {
    code_url?: string;
    message?: string;
  };
  if (!response.ok || !payload.code_url) {
    throw new Error(payload.message || "Could not create WeChat Pay order.");
  }
  return { codeUrl: payload.code_url };
}

export async function verifyAndDecryptWechatNotification(
  body: string,
  headers: Headers,
): Promise<Record<string, unknown>> {
  const config = getWechatPayConfig();
  const timestamp = headers.get("wechatpay-timestamp") || "";
  const nonce = headers.get("wechatpay-nonce") || "";
  const serial = headers.get("wechatpay-serial") || "";
  const signature = headers.get("wechatpay-signature") || "";
  if (!timestamp || !nonce || !signature || serial !== config.platformSerialNo) {
    throw new Error("Invalid WeChat Pay callback headers.");
  }
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
    throw new Error("Expired WeChat Pay callback.");
  }
  const valid = await rsaSha256Verify(
    `${timestamp}\n${nonce}\n${body}\n`,
    signature,
    config.platformPublicKey,
  );
  if (!valid) throw new Error("Invalid WeChat Pay callback signature.");
  const event = JSON.parse(body) as {
    resource?: {
      ciphertext?: string;
      nonce?: string;
      associated_data?: string;
    };
  };
  const resource = event.resource;
  if (!resource?.ciphertext || !resource.nonce) {
    throw new Error("Missing WeChat Pay callback resource.");
  }
  const plaintext = await decryptWechatResource(
    resource.ciphertext,
    resource.nonce,
    resource.associated_data || "",
    config.apiV3Key,
  );
  return JSON.parse(plaintext) as Record<string, unknown>;
}
