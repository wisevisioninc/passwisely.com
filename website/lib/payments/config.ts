import { env } from "cloudflare:workers";

type PaymentEnvironment = Record<string, string | undefined>;

function paymentEnv(): PaymentEnvironment {
  return env as unknown as PaymentEnvironment;
}

export function requiredEnv(name: string): string {
  const value = paymentEnv()[name]?.trim();
  if (!value) throw new Error(`Payment configuration is missing: ${name}`);
  return value.replaceAll("\\n", "\n");
}

function requiredOneOf(...names: string[]): string {
  for (const name of names) {
    const value = paymentEnv()[name]?.trim();
    if (value) return value.replaceAll("\\n", "\n");
  }
  throw new Error(`Payment configuration is missing: ${names.join(" or ")}`);
}

export function optionalEnv(name: string, fallback: string): string {
  return paymentEnv()[name]?.trim() || fallback;
}

export const MERCHANT_LEGAL_NAME = "福建智感灵眸科技有限公司";

export function getAlipayConfig() {
  return {
    appId: requiredEnv("ALIPAY_APP_ID"),
    privateKey: requiredEnv("ALIPAY_PRIVATE_KEY"),
    publicKey: requiredEnv("ALIPAY_PUBLIC_KEY"),
    gateway: optionalEnv(
      "ALIPAY_GATEWAY_URL",
      "https://openapi.alipay.com/gateway.do",
    ),
  };
}

export function getWechatPayConfig() {
  return {
    appId: requiredOneOf("WECHAT_PAY_APP_ID", "WECHAT_APP_ID"),
    mchId: requiredOneOf("WECHAT_PAY_MCH_ID", "WECHAT_MCH_ID"),
    merchantSerialNo: requiredOneOf(
      "WECHAT_PAY_MCH_SERIAL_NO",
      "WECHAT_MCH_SERIAL_NO",
    ),
    merchantPrivateKey: requiredOneOf(
      "WECHAT_PAY_PRIVATE_KEY",
      "WECHAT_MERCHANT_PRIVATE_KEY",
    ),
    apiV3Key: requiredOneOf("WECHAT_PAY_API_V3_KEY", "WECHAT_APIV3_KEY"),
    wechatPayPublicKeyId: requiredOneOf(
      "WECHAT_PAY_PUBLIC_KEY_ID",
      "WECHAT_PUB_KEY_ID",
    ),
    wechatPayPublicKey: requiredOneOf(
      "WECHAT_PAY_PUBLIC_KEY",
      "WECHAT_PUB_KEY",
    ),
  };
}
