"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { LandingPage } from "./LandingPage";

type Locale = "zh" | "en";
type AuthMode = "login" | "register" | "forgot" | "reset" | "change";
type PackId = "starter" | "pro" | "max";
type PaymentProvider = "alipay" | "wechat";

interface User {
  id: string;
  email: string;
  locale: Locale;
  credits: number;
}

interface Transaction {
  id: string;
  amount: number;
  balanceAfter: number;
  type: string;
  createdAt: number;
}

const copy = {
  zh: {
    signIn: "登录",
    account: "我的账户",
    authLogin: "登录 PassWisely",
    authRegister: "创建账户",
    email: "邮箱",
    password: "密码",
    passwordHint: "至少 10 位，包含字母和数字",
    submitLogin: "登录",
    submitRegister: "注册并领取 10 积分",
    switchRegister: "还没有账户？立即注册",
    switchLogin: "已有账户？直接登录",
    forgotPassword: "忘记密码？",
    forgotTitle: "找回密码",
    forgotLead: "输入注册邮箱，我们会发送安全的重置链接。",
    sendReset: "发送重置邮件",
    resetSent: "如果该邮箱已注册，重置链接已发送，请检查收件箱和垃圾邮件。",
    resetTitle: "设置新密码",
    currentPassword: "当前密码",
    newPassword: "新密码",
    confirmPassword: "确认新密码",
    changePassword: "修改密码",
    passwordChanged: "密码已更新。",
    passwordMismatch: "两次输入的新密码不一致。",
    close: "关闭",
    balance: "当前积分",
    history: "积分明细",
    logout: "退出登录",
    emptyHistory: "暂无积分变动记录",
    paymentSuccess: "支付成功，积分到账可能需要几秒。",
  },
  en: {
    signIn: "Sign in",
    account: "Account",
    authLogin: "Sign in to PassWisely",
    authRegister: "Create your account",
    email: "Email",
    password: "Password",
    passwordHint: "10+ characters with a letter and a number",
    submitLogin: "Sign in",
    submitRegister: "Create account + get 10 credits",
    switchRegister: "New to PassWisely? Create an account",
    switchLogin: "Already registered? Sign in",
    forgotPassword: "Forgot password?",
    forgotTitle: "Reset your password",
    forgotLead: "Enter your account email and we’ll send a secure reset link.",
    sendReset: "Send reset email",
    resetSent:
      "If that email is registered, a reset link has been sent. Check your inbox and spam folder.",
    resetTitle: "Choose a new password",
    currentPassword: "Current password",
    newPassword: "New password",
    confirmPassword: "Confirm new password",
    changePassword: "Change password",
    passwordChanged: "Your password has been updated.",
    passwordMismatch: "The new passwords do not match.",
    close: "Close",
    balance: "Credit balance",
    history: "Credit activity",
    logout: "Sign out",
    emptyHistory: "No credit activity yet",
    paymentSuccess:
      "Payment received. New credits may take a few seconds to appear.",
  },
} as const;

function Logo() {
  return (
    <a className="brand" href="#top" aria-label="PassWisely home">
      <img
        className="brand-mark"
        src="/passwisely-logo.png"
        alt=""
        width="512"
        height="512"
      />
      <span>PassWisely</span>
    </a>
  );
}

export function PassWiselySite() {
  const [locale, setLocale] = useState<Locale>("zh");
  const [authOpen, setAuthOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [paymentPack, setPaymentPack] = useState<PackId | null>(null);
  const [wechatPayment, setWechatPayment] = useState<{
    orderId: string;
    url: string;
  } | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [recoveryToken, setRecoveryToken] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const activeModal = authOpen
    ? `auth-${authMode}`
    : accountOpen
      ? "account"
      : paymentPack
        ? "payment"
        : wechatPayment
          ? "wechat"
          : "";
  const t = copy[locale];

  useEffect(() => {
    if (!activeModal) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>(
      ".passwisely-site [role=dialog]",
    );
    const landing = document.querySelector<HTMLElement>(".pw-landing");
    const previousOverflow = document.body.style.overflow;
    if (landing) landing.inert = true;
    document.body.style.overflow = "hidden";
    (
      dialog?.querySelector<HTMLElement>("input") ??
      dialog?.querySelector<HTMLElement>("button")
    )?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAuthOpen(false);
        setAccountOpen(false);
        setPaymentPack(null);
        setWechatPayment(null);
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          "button:not([disabled]), a[href], input:not([disabled])",
        ),
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
      if (landing) landing.inert = false;
      previousFocus?.focus();
    };
  }, [activeModal]);
  const authTitle =
    authMode === "login"
      ? t.authLogin
      : authMode === "register"
        ? t.authRegister
        : authMode === "forgot"
          ? t.forgotTitle
          : authMode === "change"
            ? t.changePassword
            : t.resetTitle;

  useEffect(() => {
    const preferred = localStorage.getItem("pw_locale");
    const nextLocale =
      preferred === "en" || preferred === "zh"
        ? preferred
        : navigator.language.toLowerCase().startsWith("zh")
          ? "zh"
          : "en";
    queueMicrotask(() => setLocale(nextLocale));
    document.documentElement.lang = nextLocale === "zh" ? "zh-CN" : "en";
    void refreshAccount();
    const params = new URLSearchParams(window.location.search);
    if (params.get("payment") === "success") {
      queueMicrotask(() => setNotice(copy[nextLocale].paymentSuccess));
    }
    const fragment = new URLSearchParams(
      window.location.hash.replace(/^#/, ""),
    );
    const resetToken = fragment.get("access_token") || "";
    if (fragment.get("type") === "recovery" && resetToken) {
      queueMicrotask(() => {
        setRecoveryToken(resetToken);
        setAuthMode("reset");
        setAuthOpen(true);
      });
    } else if (params.get("reset") === "password") {
      queueMicrotask(() =>
        setNotice(
          nextLocale === "zh"
            ? "重置链接无效或已过期，请重新申请。"
            : "The reset link is invalid or expired. Request a new one.",
        ),
      );
    }
  }, []);

  useEffect(() => {
    if (!wechatPayment) return;
    const poll = window.setInterval(async () => {
      const response = await fetch(
        `/api/payments/status/${encodeURIComponent(wechatPayment.orderId)}`,
        { credentials: "include" },
      );
      if (!response.ok) return;
      const payload = (await response.json()) as {
        order?: { status?: string };
      };
      if (payload.order?.status === "completed") {
        window.clearInterval(poll);
        setWechatPayment(null);
        setNotice(copy[locale].paymentSuccess);
        await refreshAccount();
      }
    }, 2000);
    return () => window.clearInterval(poll);
  }, [wechatPayment, locale]);

  async function refreshAccount() {
    const response = await fetch("/api/account", { credentials: "include" });
    if (!response.ok) return;
    const payload = (await response.json()) as {
      user: User;
      transactions: Transaction[];
    };
    setUser(payload.user);
    setTransactions(payload.transactions);
  }

  function chooseLocale(next: Locale) {
    setLocale(next);
    localStorage.setItem("pw_locale", next);
    document.documentElement.lang = next === "zh" ? "zh-CN" : "en";
  }

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/auth/${authMode}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: form.get("email"),
        password: form.get("password"),
        locale,
      }),
    });
    const payload = (await response.json()) as { user?: User; error?: string };
    setBusy(false);
    if (!response.ok || !payload.user) {
      setNotice(payload.error || "Something went wrong.");
      return;
    }
    setUser(payload.user);
    setAuthOpen(false);
    setAccountOpen(true);
    await refreshAccount();
  }

  async function requestPasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: form.get("email") }),
    });
    const payload = (await response.json()) as { error?: string };
    setBusy(false);
    if (!response.ok) {
      setNotice(payload.error || "Something went wrong.");
      return;
    }
    setNotice(t.resetSent);
    setAuthMode("login");
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("newPassword") || "");
    if (newPassword !== String(form.get("confirmPassword") || "")) {
      setBusy(false);
      setNotice(t.passwordMismatch);
      return;
    }
    const isRecovery = authMode === "reset";
    const response = await fetch(
      isRecovery ? "/api/auth/reset-password" : "/api/auth/change-password",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(isRecovery && recoveryToken
            ? { authorization: `Bearer ${recoveryToken}` }
            : {}),
        },
        credentials: "include",
        body: JSON.stringify({
          currentPassword: form.get("currentPassword"),
          password: newPassword,
          newPassword,
        }),
      },
    );
    const payload = (await response.json()) as { error?: string };
    setBusy(false);
    if (!response.ok) {
      setNotice(payload.error || "Something went wrong.");
      return;
    }
    setRecoveryToken("");
    window.history.replaceState({}, "", window.location.pathname);
    setAuthOpen(false);
    setNotice(t.passwordChanged);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
    setTransactions([]);
    setAccountOpen(false);
  }

  async function buy(packId: PackId) {
    if (!user) {
      setAuthMode("register");
      setAuthOpen(true);
      return;
    }
    setPaymentPack(packId);
  }

  async function pay(provider: PaymentProvider) {
    if (!paymentPack) return;
    setBusy(true);
    setNotice("");
    const response = await fetch("/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ packId: paymentPack, provider }),
    });
    const payload = (await response.json()) as {
      url?: string;
      orderId?: string;
      error?: string;
    };
    setBusy(false);
    if (payload.url) {
      setPaymentPack(null);
      if (provider === "wechat" && payload.orderId) {
        setWechatPayment({ orderId: payload.orderId, url: payload.url });
      } else {
        window.location.assign(payload.url);
      }
    } else setNotice(payload.error || "Checkout is unavailable.");
  }

  const displayTransactions = useMemo(
    () =>
      transactions.map((transaction) => ({
        ...transaction,
        date: new Date(transaction.createdAt * 1000).toLocaleDateString(
          locale === "zh" ? "zh-CN" : "en-US",
        ),
      })),
    [transactions, locale],
  );

  return (
    <main id="top" className="passwisely-site">
      <LandingPage
        locale={locale}
        onLocale={chooseLocale}
        accountLabel={user ? `${user.credits} · ${t.account}` : t.signIn}
        onAccount={() => {
          if (user) setAccountOpen(true);
          else {
            setAuthMode("login");
            setAuthOpen(true);
          }
        }}
        onBuy={(id) => void buy(id)}
        busy={busy}
      />

      {notice && (
        <div className="notice" role="status" onClick={() => setNotice("")}>
          {notice}
        </div>
      )}

      {authOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setAuthOpen(false)}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={authTitle}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              className="modal-close"
              aria-label={t.close}
              onClick={() => setAuthOpen(false)}
            >
              ×
            </button>
            <Logo />
            <h2>{authTitle}</h2>
            {(authMode === "login" || authMode === "register") && (
              <>
                <form onSubmit={authenticate}>
                  <label>
                    {t.email}
                    <input
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                    />
                  </label>
                  <label>
                    {t.password}
                    <input
                      name="password"
                      type="password"
                      autoComplete={
                        authMode === "login"
                          ? "current-password"
                          : "new-password"
                      }
                      minLength={10}
                      required
                    />
                    <small>{t.passwordHint}</small>
                  </label>
                  <button
                    className="button button-primary"
                    disabled={busy}
                    type="submit"
                  >
                    {authMode === "login" ? t.submitLogin : t.submitRegister}
                  </button>
                </form>
                {authMode === "login" && (
                  <button
                    className="switch-auth"
                    onClick={() => setAuthMode("forgot")}
                  >
                    {t.forgotPassword}
                  </button>
                )}
                <button
                  className="switch-auth"
                  onClick={() =>
                    setAuthMode(authMode === "login" ? "register" : "login")
                  }
                >
                  {authMode === "login" ? t.switchRegister : t.switchLogin}
                </button>
              </>
            )}
            {authMode === "forgot" && (
              <>
                <p>{t.forgotLead}</p>
                <form onSubmit={requestPasswordReset}>
                  <label>
                    {t.email}
                    <input
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                    />
                  </label>
                  <button
                    className="button button-primary"
                    disabled={busy}
                    type="submit"
                  >
                    {t.sendReset}
                  </button>
                </form>
                <button
                  className="switch-auth"
                  onClick={() => setAuthMode("login")}
                >
                  {t.switchLogin}
                </button>
              </>
            )}
            {(authMode === "reset" || authMode === "change") && (
              <form onSubmit={submitPassword}>
                {authMode === "change" && (
                  <label>
                    {t.currentPassword}
                    <input
                      name="currentPassword"
                      type="password"
                      autoComplete="current-password"
                      required
                    />
                  </label>
                )}
                <label>
                  {t.newPassword}
                  <input
                    name="newPassword"
                    type="password"
                    autoComplete="new-password"
                    minLength={10}
                    required
                  />
                  <small>{t.passwordHint}</small>
                </label>
                <label>
                  {t.confirmPassword}
                  <input
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    minLength={10}
                    required
                  />
                </label>
                <button
                  className="button button-primary"
                  disabled={busy}
                  type="submit"
                >
                  {authMode === "change" ? t.changePassword : t.resetTitle}
                </button>
              </form>
            )}
          </section>
        </div>
      )}

      {paymentPack && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setPaymentPack(null)}
        >
          <section
            className="modal payment-modal"
            role="dialog"
            aria-modal="true"
            aria-label={
              locale === "zh" ? "选择支付方式" : "Choose payment method"
            }
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              className="modal-close"
              aria-label={t.close}
              onClick={() => setPaymentPack(null)}
            >
              ×
            </button>
            <Logo />
            <h2>
              {locale === "zh" ? "选择支付方式" : "Choose payment method"}
            </h2>
            <p>
              {locale === "zh"
                ? "人民币支付，由福建智感灵眸科技有限公司收款。"
                : "Payment is collected in CNY by Fujian Zhigan Lingmou Technology Co., Ltd."}
            </p>
            <div className="payment-options">
              <button
                className="payment-option alipay"
                disabled={busy}
                onClick={() => void pay("alipay")}
              >
                <b>支</b>
                <span>
                  <strong>支付宝</strong>
                  <small>Alipay</small>
                </span>
                <i>→</i>
              </button>
              <button
                className="payment-option wechat"
                disabled={busy}
                onClick={() => void pay("wechat")}
              >
                <b>微</b>
                <span>
                  <strong>微信支付</strong>
                  <small>WeChat Pay</small>
                </span>
                <i>→</i>
              </button>
            </div>
            <small className="payment-note">
              {locale === "zh"
                ? "支付成功后由官方异步通知自动入账，请勿重复支付。"
                : "Credits are added after the signed provider callback is verified."}
            </small>
          </section>
        </div>
      )}

      {wechatPayment && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setWechatPayment(null)}
        >
          <section
            className="modal wechat-qr-modal"
            role="dialog"
            aria-modal="true"
            aria-label={locale === "zh" ? "微信支付" : "WeChat Pay"}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              className="modal-close"
              aria-label={t.close}
              onClick={() => setWechatPayment(null)}
            >
              ×
            </button>
            <h2>{locale === "zh" ? "微信扫码支付" : "Scan with WeChat"}</h2>
            <div className="wechat-qr">
              <QRCodeSVG value={wechatPayment.url} size={224} level="M" />
            </div>
            <p>
              {locale === "zh"
                ? "请使用微信扫一扫完成支付，本页面会自动确认到账。"
                : "Use WeChat to scan. This page will confirm the payment automatically."}
            </p>
            <div className="payment-waiting">
              <i />
              {locale === "zh" ? "等待支付结果" : "Waiting for payment"}
            </div>
          </section>
        </div>
      )}

      {accountOpen && user && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setAccountOpen(false)}
        >
          <section
            className="modal account-modal"
            role="dialog"
            aria-modal="true"
            aria-label={t.account}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              className="modal-close"
              aria-label={t.close}
              onClick={() => setAccountOpen(false)}
            >
              ×
            </button>
            <p className="account-email">{user.email}</p>
            <div className="balance-card">
              <span>{t.balance}</span>
              <strong>{user.credits}</strong>
              <small>credits</small>
            </div>
            <h3>{t.history}</h3>
            <div className="history-list">
              {displayTransactions.length === 0 ? (
                <p>{t.emptyHistory}</p>
              ) : (
                displayTransactions.map((item) => (
                  <div key={item.id}>
                    <span>
                      <b>{item.type.replaceAll("_", " ")}</b>
                      <small>{item.date}</small>
                    </span>
                    <strong className={item.amount > 0 ? "positive" : ""}>
                      {item.amount > 0 ? "+" : ""}
                      {item.amount}
                    </strong>
                  </div>
                ))
              )}
            </div>
            <button
              className="button button-secondary"
              onClick={() => {
                setAccountOpen(false);
                setAuthMode("change");
                setAuthOpen(true);
              }}
            >
              {t.changePassword}
            </button>
            <button
              className="button button-secondary logout"
              onClick={() => void logout()}
            >
              {t.logout}
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
