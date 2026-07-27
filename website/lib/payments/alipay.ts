import { getAlipayConfig } from "./config";
import { formatCny } from "./catalog";
import { rsaSha256Sign, rsaSha256Verify } from "./crypto";

function chinaTimestamp(): string {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
}

function canonicalize(params: URLSearchParams): string {
  return [...params.entries()]
    .filter(([key, value]) => key !== "sign" && value !== "")
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

export async function createAlipayPagePayment(input: {
  origin: string;
  merchantOrderNo: string;
  subject: string;
  amountFen: number;
}): Promise<{ redirectUrl: string }> {
  const config = getAlipayConfig();
  const params = new URLSearchParams({
    app_id: config.appId,
    method: "alipay.trade.page.pay",
    format: "JSON",
    charset: "utf-8",
    sign_type: "RSA2",
    timestamp: chinaTimestamp(),
    version: "1.0",
    notify_url: `${input.origin}/api/payments/alipay/notify`,
    return_url: `${input.origin}/?payment=return#account`,
    biz_content: JSON.stringify({
      out_trade_no: input.merchantOrderNo,
      product_code: "FAST_INSTANT_TRADE_PAY",
      total_amount: formatCny(input.amountFen),
      subject: input.subject,
    }),
  });
  params.set("sign", await rsaSha256Sign(canonicalize(params), config.privateKey));
  return { redirectUrl: `${config.gateway}?${params.toString()}` };
}

export async function verifyAlipayNotification(
  params: URLSearchParams,
): Promise<boolean> {
  const signature = params.get("sign");
  if (!signature) return false;
  return rsaSha256Verify(
    canonicalize(params),
    signature.replaceAll(" ", "+"),
    getAlipayConfig().publicKey,
  );
}
