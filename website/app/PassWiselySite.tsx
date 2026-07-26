"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Locale = "zh" | "en";
type AuthMode = "login" | "register";
type PackId = "starter" | "pro" | "max";

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
    nav: ["功能", "工作方式", "积分", "下载"],
    signIn: "登录",
    account: "我的账户",
    eyebrow: "为关键时刻而生的 AI 桌面助手",
    titleA: "面试压力再大，",
    titleB: "思路依然清晰。",
    lead:
      "截取题目、补充问题，几秒内获得结构化解法。覆盖算法、系统设计、调试与简历准备，支持 macOS 和 Windows。",
    downloadMac: "下载 macOS 版",
    downloadWin: "下载 Windows 版",
    free: "注册即送 10 积分，无需信用卡",
    proof: ["截图识题", "多模型支持", "快捷键操控", "中英双语"],
    mockQuestion: "设计一个支持千万用户的实时消息系统",
    mockAnswer: "先澄清规模与一致性要求，再拆分连接层、消息路由、存储与重试机制。",
    mockStep: ["需求澄清", "容量估算", "架构设计", "权衡与扩展"],
    sectionEyebrow: "真正有用的面试工作流",
    sectionTitle: "从看到问题到讲清答案，一气呵成",
    sectionLead: "不是泛泛聊天，而是围绕面试节奏设计的桌面工作台。",
    features: [
      ["01", "截图理解", "捕获题目或代码，自动提取关键信息并保留多张截图上下文。"],
      ["02", "结构化解题", "输出思路、完整代码、复杂度分析，以及面试官可能追问的问题。"],
      ["03", "系统设计", "从需求、容量估算到组件拆分、数据模型和关键权衡逐步展开。"],
      ["04", "调试与优化", "定位错误、解释根因，并给出可运行的修复版本与优化建议。"],
      ["05", "简历与 JD", "解析简历和职位描述，生成匹配分析、改写建议与面试准备计划。"],
      ["06", "私密桌面体验", "在独立桌面窗口中使用，快捷键控制显示、截图、重置和移动。"],
    ],
    howEyebrow: "三步开始",
    howTitle: "安装之后，马上进入状态",
    steps: [
      ["下载并注册", "选择适合电脑的版本，创建账户即可领取 10 个体验积分。"],
      ["截取或输入问题", "使用快捷键捕获题目，也可以直接输入文字或导入简历。"],
      ["获得可讲述的答案", "每次操作透明扣除积分，余额与明细在账户中随时可查。"],
    ],
    pricingEyebrow: "按需购买，不设订阅陷阱",
    pricingTitle: "只为真正使用的 AI 能力付费",
    pricingLead: "积分永久有效。一次标准解题消耗 1 积分，复杂简历任务消耗 2–3 积分。",
    buy: "购买积分",
    popular: "最受欢迎",
    packs: [
      ["starter", "轻量包", "100", "$9", "适合短期面试准备"],
      ["pro", "进阶包", "400", "$29", "适合完整求职周期"],
      ["max", "冲刺包", "1,000", "$59", "适合高频训练与多轮面试"],
    ],
    downloadTitle: "准备好更从容地面对下一题了吗？",
    downloadLead: "下载桌面端，注册后立即获得 10 个体验积分。",
    macArm: "macOS · Apple 芯片",
    macIntel: "macOS · Intel 芯片",
    windows: "Windows · x64",
    faqTitle: "常见问题",
    faqs: [
      ["积分如何扣除？", "标准解题、调试和追问每次 1 积分；简历分析与针对性准备消耗 2–3 积分。服务端原子扣费，同一次请求不会重复计费。"],
      ["支持哪些模型？", "桌面端支持 OpenAI、DeepSeek、Kimi、豆包、通义千问、GLM、Gemini 和 Claude，也可配置兼容接口。"],
      ["积分会过期吗？", "购买和赠送的积分目前都不会过期，余额与每笔变动会保存在账户中。"],
      ["数据是否安全？", "账户会话使用安全 Cookie；API 密钥由操作系统凭据保护功能加密保存在本机，不会写入网站数据库。"],
    ],
    footer: "© 2026 PassWisely. 为准备与学习而设计，请遵守面试和考试规则。",
    authLogin: "登录 PassWisely",
    authRegister: "创建账户",
    email: "邮箱",
    password: "密码",
    passwordHint: "至少 10 位，包含字母和数字",
    submitLogin: "登录",
    submitRegister: "注册并领取 10 积分",
    switchRegister: "还没有账户？立即注册",
    switchLogin: "已有账户？直接登录",
    close: "关闭",
    balance: "当前积分",
    history: "积分明细",
    logout: "退出登录",
    emptyHistory: "暂无积分变动记录",
    paymentSuccess: "支付成功，积分到账可能需要几秒。",
  },
  en: {
    nav: ["Features", "How it works", "Credits", "Download"],
    signIn: "Sign in",
    account: "Account",
    eyebrow: "The desktop AI copilot for high-pressure moments",
    titleA: "Pressure is high.",
    titleB: "Your thinking stays clear.",
    lead:
      "Capture a question, add context, and get a structured answer in seconds. Built for algorithms, system design, debugging, and resume preparation on macOS and Windows.",
    downloadMac: "Download for macOS",
    downloadWin: "Download for Windows",
    free: "Create an account and get 10 credits. No card required.",
    proof: ["Screenshot capture", "Multi-model", "Keyboard-first", "Bilingual"],
    mockQuestion: "Design a real-time messaging system for 10M users",
    mockAnswer: "Clarify scale and consistency first, then separate connections, routing, storage, and retry behavior.",
    mockStep: ["Clarify", "Estimate", "Design", "Trade-offs"],
    sectionEyebrow: "A workflow built for interviews",
    sectionTitle: "From seeing the problem to explaining the answer",
    sectionLead: "A focused desktop workspace—not another generic chat window.",
    features: [
      ["01", "Understand screenshots", "Capture questions or code, extract the signal, and keep context across multiple screenshots."],
      ["02", "Structured solutions", "Get reasoning, complete code, complexity analysis, and likely follow-up questions."],
      ["03", "System design", "Move from requirements and estimates to components, data models, bottlenecks, and trade-offs."],
      ["04", "Debug and optimize", "Find defects, explain root causes, and produce a runnable fix with optimization ideas."],
      ["05", "Resume + job description", "Parse resumes and roles to create gap analysis, rewrites, and a targeted preparation plan."],
      ["06", "Private desktop flow", "Work in a dedicated desktop window with shortcuts for capture, visibility, reset, and movement."],
    ],
    howEyebrow: "Start in three steps",
    howTitle: "Install once. Get into flow immediately.",
    steps: [
      ["Download and register", "Choose the right build for your computer and get 10 free credits with a new account."],
      ["Capture or type", "Use a shortcut to capture the prompt, type it directly, or import a resume."],
      ["Get an answer you can explain", "Credits are deducted transparently and every balance change is visible in your account."],
    ],
    pricingEyebrow: "Pay as you go",
    pricingTitle: "Pay only for AI work you actually use",
    pricingLead: "Credits do not expire. A standard solve costs 1 credit; deeper resume tasks cost 2–3.",
    buy: "Buy credits",
    popular: "Most popular",
    packs: [
      ["starter", "Starter", "100", "$9", "For a focused interview sprint"],
      ["pro", "Pro", "400", "$29", "For a complete job-search cycle"],
      ["max", "Max", "1,000", "$59", "For high-volume practice and interview loops"],
    ],
    downloadTitle: "Ready to feel calmer on the next question?",
    downloadLead: "Download the desktop app and get 10 trial credits after registration.",
    macArm: "macOS · Apple silicon",
    macIntel: "macOS · Intel",
    windows: "Windows · x64",
    faqTitle: "Frequently asked questions",
    faqs: [
      ["How are credits used?", "A standard solve, debug, or follow-up costs 1 credit. Resume analysis and targeted preparation cost 2–3. Server-side atomic deduction prevents duplicate charges for the same request."],
      ["Which AI models are supported?", "The desktop app supports OpenAI, DeepSeek, Kimi, Doubao, Qwen, GLM, Gemini, Claude, and compatible custom endpoints."],
      ["Do credits expire?", "Purchased and welcome credits currently do not expire. Your account stores the balance and every change."],
      ["How is data protected?", "Account sessions use secure cookies. AI keys are encrypted by the operating system and stay on your device, not in the website database."],
    ],
    footer: "© 2026 PassWisely. Designed for preparation and learning. Follow your interview and assessment rules.",
    authLogin: "Sign in to PassWisely",
    authRegister: "Create your account",
    email: "Email",
    password: "Password",
    passwordHint: "10+ characters with a letter and a number",
    submitLogin: "Sign in",
    submitRegister: "Create account + get 10 credits",
    switchRegister: "New to PassWisely? Create an account",
    switchLogin: "Already registered? Sign in",
    close: "Close",
    balance: "Credit balance",
    history: "Credit activity",
    logout: "Sign out",
    emptyHistory: "No credit activity yet",
    paymentSuccess: "Payment received. New credits may take a few seconds to appear.",
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
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [user, setUser] = useState<User | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const t = copy[locale];

  useEffect(() => {
    const preferred = localStorage.getItem("pw_locale");
    const nextLocale =
      preferred === "en" || preferred === "zh"
        ? preferred
        : navigator.language.toLowerCase().startsWith("zh")
          ? "zh"
          : "en";
    queueMicrotask(() => setLocale(nextLocale));
    void refreshAccount();
    const params = new URLSearchParams(window.location.search);
    if (params.get("payment") === "success") {
      queueMicrotask(() => setNotice(copy[nextLocale].paymentSuccess));
    }
  }, []);

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
    setBusy(true);
    setNotice("");
    const response = await fetch("/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ packId }),
    });
    const payload = (await response.json()) as { url?: string; error?: string };
    setBusy(false);
    if (payload.url) window.location.assign(payload.url);
    else setNotice(payload.error || "Checkout is unavailable.");
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
    <main id="top">
      <header className="nav-wrap">
        <nav className="nav container" aria-label="Primary navigation">
          <Logo />
          <div className="nav-links">
            <a href="#features">{t.nav[0]}</a>
            <a href="#how">{t.nav[1]}</a>
            <a href="#pricing">{t.nav[2]}</a>
            <a href="#download">{t.nav[3]}</a>
          </div>
          <div className="nav-actions">
            <div className="locale-toggle" aria-label="Language">
              <button className={locale === "zh" ? "active" : ""} onClick={() => chooseLocale("zh")}>中</button>
              <button className={locale === "en" ? "active" : ""} onClick={() => chooseLocale("en")}>EN</button>
            </div>
            <button
              className="button button-small button-ghost"
              onClick={() => user ? setAccountOpen(true) : setAuthOpen(true)}
            >
              {user ? `${user.credits} · ${t.account}` : t.signIn}
            </button>
          </div>
        </nav>
      </header>

      <section className="hero container">
        <div className="hero-copy">
          <p className="eyebrow"><span />{t.eyebrow}</p>
          <h1>{t.titleA}<em>{t.titleB}</em></h1>
          <p className="hero-lead">{t.lead}</p>
          <div className="hero-buttons">
            <a className="button button-primary" href="#download">{t.downloadMac}</a>
            <a className="button button-secondary" href="#download">{t.downloadWin}</a>
          </div>
          <p className="free-note"><span>✓</span>{t.free}</p>
          <div className="proof-row">
            {t.proof.map((item) => <span key={item}>{item}</span>)}
          </div>
        </div>
        <div className="product-stage" aria-label="PassWisely product preview">
          <div className="stage-glow" />
          <div className="window">
            <div className="window-bar">
              <div className="traffic"><i /><i /><i /></div>
              <span className="window-brand">
                <img src="/passwisely-logo.png" alt="" width="512" height="512" />
                PassWisely
              </span>
              <b>⌘ B</b>
            </div>
            <div className="question-card">
              <span className="question-label">SYSTEM DESIGN</span>
              <h3>{t.mockQuestion}</h3>
              <p>{t.mockAnswer}</p>
            </div>
            <div className="step-grid">
              {t.mockStep.map((step, index) => (
                <div key={step} className={index === 2 ? "step active" : "step"}>
                  <span>0{index + 1}</span><b>{step}</b>
                </div>
              ))}
            </div>
            <div className="code-card">
              <div><span className="code-purple">class</span> MessageRouter {"{"}</div>
              <div>&nbsp;&nbsp;<span className="code-blue">async</span> route(message) {"{"}</div>
              <div>&nbsp;&nbsp;&nbsp;&nbsp;<span className="code-gray">{"// shard by conversation"}</span></div>
              <div>&nbsp;&nbsp;&nbsp;&nbsp;<span className="code-purple">return</span> this.partition.send(message)</div>
              <div>&nbsp;&nbsp;{"}"}</div>
              <div>{"}"}</div>
            </div>
            <div className="window-footer">
              <span><i className="status-dot" /> Ready</span>
              <span>48 credits</span>
            </div>
          </div>
        </div>
      </section>

      <section className="section container" id="features">
        <div className="section-heading">
          <p className="eyebrow"><span />{t.sectionEyebrow}</p>
          <h2>{t.sectionTitle}</h2>
          <p>{t.sectionLead}</p>
        </div>
        <div className="feature-grid">
          {t.features.map(([number, title, description]) => (
            <article className="feature-card" key={number}>
              <span className="feature-number">{number}</span>
              <h3>{title}</h3>
              <p>{description}</p>
              <i className="feature-line" />
            </article>
          ))}
        </div>
      </section>

      <section className="how-section" id="how">
        <div className="container">
          <div className="section-heading centered">
            <p className="eyebrow"><span />{t.howEyebrow}</p>
            <h2>{t.howTitle}</h2>
          </div>
          <div className="steps">
            {t.steps.map(([title, description], index) => (
              <article key={title}>
                <span>{index + 1}</span>
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section container" id="pricing">
        <div className="section-heading centered">
          <p className="eyebrow"><span />{t.pricingEyebrow}</p>
          <h2>{t.pricingTitle}</h2>
          <p>{t.pricingLead}</p>
        </div>
        <div className="pricing-grid">
          {t.packs.map(([id, name, credits, price, description], index) => (
            <article className={index === 1 ? "price-card featured" : "price-card"} key={id}>
              {index === 1 && <span className="popular">{t.popular}</span>}
              <h3>{name}</h3>
              <div className="price"><strong>{price}</strong><span>USD</span></div>
              <div className="credits"><b>{credits}</b><span>credits</span></div>
              <p>{description}</p>
              <button className="button button-primary" disabled={busy} onClick={() => void buy(id as PackId)}>{t.buy}</button>
            </article>
          ))}
        </div>
      </section>

      <section className="download-section" id="download">
        <div className="container download-inner">
          <div>
            <p className="eyebrow eyebrow-light"><span />PassWisely Desktop</p>
            <h2>{t.downloadTitle}</h2>
            <p>{t.downloadLead}</p>
          </div>
          <div className="download-buttons">
            <button className="download-button" type="button" onClick={() => window.location.assign("/api/download/mac-arm64")}><b>⌘</b><span>{t.macArm}<small>DMG</small></span></button>
            <button className="download-button" type="button" onClick={() => window.location.assign("/api/download/mac-x64")}><b>⌘</b><span>{t.macIntel}<small>DMG</small></span></button>
            <button className="download-button" type="button" onClick={() => window.location.assign("/api/download/windows-x64")}><b>⊞</b><span>{t.windows}<small>EXE</small></span></button>
          </div>
        </div>
      </section>

      <section className="section container faq-section">
        <div className="section-heading"><h2>{t.faqTitle}</h2></div>
        <div className="faq-list">
          {t.faqs.map(([question, answer]) => (
            <details key={question}>
              <summary>{question}<span>＋</span></summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </section>

      <footer className="footer container">
        <Logo />
        <p>{t.footer}</p>
        <div><a href="mailto:support@passwisely.com">support@passwisely.com</a></div>
      </footer>

      {notice && <div className="notice" role="status" onClick={() => setNotice("")}>{notice}</div>}

      {authOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setAuthOpen(false)}>
          <section className="modal" role="dialog" aria-modal="true" aria-label={authMode === "login" ? t.authLogin : t.authRegister} onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" aria-label={t.close} onClick={() => setAuthOpen(false)}>×</button>
            <Logo />
            <h2>{authMode === "login" ? t.authLogin : t.authRegister}</h2>
            <form onSubmit={authenticate}>
              <label>{t.email}<input name="email" type="email" autoComplete="email" required /></label>
              <label>{t.password}<input name="password" type="password" autoComplete={authMode === "login" ? "current-password" : "new-password"} minLength={10} required /><small>{t.passwordHint}</small></label>
              <button className="button button-primary" disabled={busy} type="submit">{authMode === "login" ? t.submitLogin : t.submitRegister}</button>
            </form>
            <button className="switch-auth" onClick={() => setAuthMode(authMode === "login" ? "register" : "login")}>{authMode === "login" ? t.switchRegister : t.switchLogin}</button>
          </section>
        </div>
      )}

      {accountOpen && user && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setAccountOpen(false)}>
          <section className="modal account-modal" role="dialog" aria-modal="true" aria-label={t.account} onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" aria-label={t.close} onClick={() => setAccountOpen(false)}>×</button>
            <p className="account-email">{user.email}</p>
            <div className="balance-card"><span>{t.balance}</span><strong>{user.credits}</strong><small>credits</small></div>
            <h3>{t.history}</h3>
            <div className="history-list">
              {displayTransactions.length === 0 ? <p>{t.emptyHistory}</p> : displayTransactions.map((item) => (
                <div key={item.id}><span><b>{item.type.replaceAll("_", " ")}</b><small>{item.date}</small></span><strong className={item.amount > 0 ? "positive" : ""}>{item.amount > 0 ? "+" : ""}{item.amount}</strong></div>
              ))}
            </div>
            <button className="button button-secondary logout" onClick={() => void logout()}>{t.logout}</button>
          </section>
        </div>
      )}
    </main>
  );
}
