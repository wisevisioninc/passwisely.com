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
    appId: requiredEnv("WECHAT_PAY_APP_ID"),
    mchId: requiredEnv("WECHAT_PAY_MCH_ID"),
    merchantSerialNo: requiredEnv("WECHAT_PAY_MCH_SERIAL_NO"),
    merchantPrivateKey: requiredEnv("WECHAT_PAY_PRIVATE_KEY"),
    apiV3Key: requiredEnv("WECHAT_PAY_API_V3_KEY"),
    platformSerialNo: requiredEnv("WECHAT_PAY_PLATFORM_SERIAL_NO"),
    platformPublicKey: requiredEnv("WECHAT_PAY_PLATFORM_PUBLIC_KEY"),
  };
}
