import { FormEvent, useState } from "react";

export interface DesktopAccountUser {
  id: string;
  email: string;
  locale: "zh" | "en";
  credits: number;
}

interface AuthPageProps {
  initialError?: string;
  onAuthenticated: (user: DesktopAccountUser) => void;
}

export default function AuthPage({
  initialError,
  onAuthenticated,
}: AuthPageProps) {
  const [mode, setMode] = useState<"login" | "register" | "forgot">("login");
  const [locale, setLocale] = useState<"zh" | "en">("zh");
  const [error, setError] = useState(initialError || "");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const isZh = locale === "zh";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    const form = new FormData(event.currentTarget);
    if (mode === "forgot") {
      const result = await window.electronAPI.accountForgotPassword(
        String(form.get("email") || ""),
      );
      setBusy(false);
      if (result.success) {
        setSuccess(
          isZh
            ? "如果该邮箱已注册，重置链接已发送，请检查收件箱和垃圾邮件。"
            : "If that email is registered, a reset link has been sent. Check your inbox and spam folder.",
        );
        setMode("login");
      } else {
        setError(result.error || (isZh ? "发送失败，请稍后重试。" : "Could not send the reset email."));
      }
      return;
    }
    const input = {
      email: String(form.get("email") || ""),
      password: String(form.get("password") || ""),
      locale,
    };
    const result =
      mode === "login"
        ? await window.electronAPI.accountLogin(input)
        : await window.electronAPI.accountRegister(input);
    setBusy(false);
    if (!result.success || !result.user) {
      setError(result.error || (isZh ? "操作失败，请重试。" : "Something went wrong."));
      return;
    }
    onAuthenticated(result.user);
  }

  return (
    <div className="min-h-[520px] w-full bg-[#111018] text-white rounded-2xl overflow-hidden shadow-2xl border border-white/10">
      <div className="px-7 py-6 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-2.5 font-semibold tracking-tight">
          <span className="grid place-items-center w-8 h-8 rounded-xl rounded-bl-sm bg-violet-500 font-serif italic">
            P
          </span>
          PassWisely
        </div>
        <div className="flex rounded-lg bg-white/5 p-1 text-[10px]">
          <button
            className={`px-2 py-1 rounded-md ${isZh ? "bg-white text-black" : "text-white/50"}`}
            onClick={() => setLocale("zh")}
          >
            中
          </button>
          <button
            className={`px-2 py-1 rounded-md ${!isZh ? "bg-white text-black" : "text-white/50"}`}
            onClick={() => setLocale("en")}
          >
            EN
          </button>
        </div>
      </div>

      <div className="px-8 py-9">
        <p className="text-[10px] uppercase tracking-[0.18em] text-violet-300 mb-3">
          AI Interview Copilot
        </p>
        <h1 className="text-3xl font-semibold tracking-[-0.04em]">
          {mode === "login"
            ? isZh
              ? "欢迎回来"
              : "Welcome back"
            : mode === "register" && isZh
              ? "创建你的账户"
              : mode === "register"
                ? "Create your account"
                : isZh
                  ? "找回密码"
                  : "Reset your password"}
        </h1>
        <p className="text-sm text-white/45 mt-2 leading-6">
          {mode === "login"
            ? isZh
              ? "登录后同步积分并继续使用。"
              : "Sign in to sync your credits and continue."
            : mode === "register" && isZh
              ? "新账户立即获得 10 个体验积分。"
              : mode === "register"
                ? "New accounts receive 10 trial credits."
                : isZh
                  ? "输入注册邮箱，我们会发送安全的重置链接。"
                  : "Enter your account email and we’ll send a secure reset link."}
        </p>

        <form className="grid gap-4 mt-7" onSubmit={submit}>
          <label className="grid gap-1.5 text-xs text-white/65">
            {isZh ? "邮箱" : "Email"}
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              className="h-11 px-3 rounded-xl bg-white/[0.06] border border-white/10 outline-none focus:border-violet-400 text-white"
            />
          </label>
          {mode !== "forgot" && (
            <label className="grid gap-1.5 text-xs text-white/65">
              {isZh ? "密码" : "Password"}
              <input
                name="password"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                minLength={10}
                required
                className="h-11 px-3 rounded-xl bg-white/[0.06] border border-white/10 outline-none focus:border-violet-400 text-white"
              />
              {mode === "register" && (
                <span className="text-[10px] text-white/30">
                  {isZh ? "至少 10 位，包含字母和数字" : "10+ characters with a letter and a number"}
                </span>
              )}
            </label>
          )}

          {error && (
            <p className="rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}
          {success && (
            <p className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
              {success}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="h-12 rounded-xl bg-violet-500 hover:bg-violet-400 disabled:opacity-50 font-semibold text-sm transition-colors"
          >
            {busy
              ? isZh
                ? "请稍候…"
                : "Please wait…"
              : mode === "forgot"
                ? isZh
                  ? "发送重置邮件"
                  : "Send reset email"
                : mode === "login"
                ? isZh
                  ? "登录"
                  : "Sign in"
                : isZh
                  ? "注册并领取 10 积分"
                  : "Create account + 10 credits"}
          </button>
        </form>

        {mode === "login" && (
          <button
            className="w-full mt-4 text-xs text-white/45 hover:text-violet-200"
            onClick={() => { setMode("forgot"); setError(""); setSuccess(""); }}
          >
            {isZh ? "忘记密码？" : "Forgot password?"}
          </button>
        )}

        <button
          className="w-full mt-5 text-xs text-violet-300 hover:text-violet-200"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError("");
            setSuccess("");
          }}
        >
          {mode === "login"
            ? isZh
              ? "没有账户？立即注册"
              : "New here? Create an account"
            : isZh
              ? "已有账户？直接登录"
              : "Already registered? Sign in"}
        </button>
      </div>
    </div>
  );
}
