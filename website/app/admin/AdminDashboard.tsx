"use client";

/* eslint-disable @next/next/no-img-element -- Vinext does not expose Next's image optimizer route. */

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type {
  AdminStats,
  CountBreakdown,
  DailyUsage,
} from "@/lib/admin-data";
import { AI_PROVIDER_CATALOG, isAiProvider } from "@/lib/ai-catalog";

type View = "overview" | "services" | "settings";
type IconName = "overview" | "services" | "settings" | "users" | "activity" | "coins" | "revenue" | "refresh" | "logout";

const EMPTY: AdminStats = {
  generatedAt: "",
  totalUsers: 0,
  activeUsers: 0,
  newUsersToday: 0,
  newUsers7d: 0,
  newUsers30d: 0,
  dau: 0,
  wau: 0,
  mau: 0,
  onlineSessions: 0,
  requestsToday: 0,
  requests7d: 0,
  requests30d: 0,
  creditsToday: 0,
  credits7d: 0,
  credits30d: 0,
  availableCredits: 0,
  tokensToday: 0,
  tokens7d: 0,
  tokens30d: 0,
  totalTokens: 0,
  revenueToday: 0,
  revenue7d: 0,
  revenue30d: 0,
  totalRevenue: 0,
  completedOrders30d: 0,
  pendingOrders: 0,
  failedOrders30d: 0,
  payingUsers30d: 0,
  paymentSuccessRate30d: 0,
  resumeDocuments: 0,
  resumeRuns30d: 0,
  daily: [],
  actionBreakdown: [],
  providerBreakdown: [],
  paymentBreakdown: [],
  qpsCurrent: 0,
  qpsPeak1h: 0,
  requests5m: 0,
  avgLatencyMs5m: 0,
  maxLatencyMs5m: 0,
  errorRate5m: 0,
  downloadsToday: 0,
  downloads7d: 0,
  downloadsTotal: 0,
  requestSeries: [],
  routeBreakdown: [],
  downloadBreakdown: [],
  downloadPerformance: [],
  services: [],
  host: null,
};

const numberFormat = new Intl.NumberFormat("zh-CN");
const compactFormat = new Intl.NumberFormat("zh-CN", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const actionNames: Record<string, string> = {
  ai_chat: "AI 实时问答",
  solve: "截图解题",
  analyze: "问题分析",
  resume_opt_agent: "简历优化",
  interview_question_agent: "面试预测",
  history_interview_agent: "面试复盘",
};
const providerNames: Record<string, string> = {
  kimi: "Kimi",
  openai: "OpenAI",
  anthropic: "Claude",
  gemini: "Gemini",
  alipay: "支付宝",
  wechat: "微信支付",
  stripe: "Stripe",
  other: "其他",
};
const platformNames: Record<string, string> = {
  "mac-arm64": "macOS · Apple 芯片",
  "mac-x64": "macOS · Intel",
  "windows-x64": "Windows · x64",
};

function formatNumber(value: number, compact = false) {
  return (compact ? compactFormat : numberFormat).format(value || 0);
}

function formatMoney(value: number) {
  return `¥${((value || 0) / 100).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  return days > 0 ? `${days} 天 ${hours} 小时` : `${hours} 小时`;
}

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    services: <><path d="M4 7h16M7 4v6M17 4v6M5 14h14v6H5z"/><path d="M8 17h.01M11 17h.01"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.09A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3V9.6h.09A1.7 1.7 0 0 0 4.6 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.5 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.2.38.6.76 1 .96.34.18.72.27 1.1.27h.09v4h-.09a1.7 1.7 0 0 0-1.1.4 1.7 1.7 0 0 0-1 .37Z"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    activity: <polyline points="3 12 7 12 10 4 14 20 17 12 21 12"/>,
    coins: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></>,
    revenue: <><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></>,
    refresh: <><polyline points="23 4 23 10 17 10"/><path d="M20.5 15a9 9 0 1 1-2.1-9.4L23 10"/></>,
    logout: <><path d="M10 17l5-5-5-5M15 12H3"/><path d="M15 3h5a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-5"/></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function TrendChart({ daily }: { daily: DailyUsage[] }) {
  const width = 760;
  const height = 230;
  const bottom = 196;
  const max = Math.max(1, ...daily.flatMap((day) => [day.requests, day.users]));
  const point = (value: number, index: number) => {
    const x = daily.length > 1 ? 24 + index * ((width - 48) / (daily.length - 1)) : width / 2;
    const y = bottom - (value / max) * 156;
    return `${x},${y}`;
  };
  const requests = daily.map((day, index) => point(day.requests, index)).join(" ");
  const users = daily.map((day, index) => point(day.users, index)).join(" ");

  return <div className="admin-trend-chart">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="最近 14 天请求和活跃用户趋势">
      {[0, 1, 2, 3].map((line) => <line key={line} x1="24" x2={width - 24} y1={40 + line * 52} y2={40 + line * 52} className="admin-chart-grid" />)}
      {daily.length > 0 && <>
        <polyline points={requests} className="admin-chart-line admin-chart-requests" />
        <polyline points={users} className="admin-chart-line admin-chart-users" />
        {daily.map((day, index) => <g key={day.date}>
          <circle cx={point(day.requests, index).split(",")[0]} cy={point(day.requests, index).split(",")[1]} r="3" className="admin-chart-dot" />
          {(index === 0 || index === daily.length - 1 || index % 3 === 1) && <text x={point(0, index).split(",")[0]} y="222" textAnchor="middle">{day.date.slice(5).replace("-", "/")}</text>}
        </g>)}
      </>}
    </svg>
    {!daily.some((day) => day.requests || day.users) && <div className="admin-chart-empty">等待产生第一批使用数据</div>}
  </div>;
}

function Breakdown({ items, names = actionNames }: { items: CountBreakdown[]; names?: Record<string, string> }) {
  const max = Math.max(1, ...items.map((item) => item.value));
  if (!items.length) return <div className="admin-empty">暂无使用数据</div>;
  return <div className="admin-breakdown">{items.map((item) => <div key={item.label}>
    <div><span>{names[item.label] || item.label}</span><strong>{formatNumber(item.value)}</strong></div>
    <i><b style={{ width: `${Math.max(3, item.value / max * 100)}%` }} /></i>
  </div>)}</div>;
}

function RequestRateChart({ points }: { points: AdminStats["requestSeries"] }) {
  const visible = points.slice(-30);
  const max = Math.max(1, ...visible.map((point) => point.requests));
  return <div className="admin-qps-chart" aria-label="最近 30 分钟请求量">
    {visible.map((point) => <i key={point.minute} title={`${new Date(point.minute).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" })} · ${point.requests} 请求`}><b style={{ height: `${Math.max(4, point.requests / max * 100)}%` }} className={point.errors ? "has-error" : ""}/></i>)}
    {!visible.some((point) => point.requests) && <span>等待采集第一批请求数据</span>}
  </div>;
}

function MetricCard({ icon, label, value, detail, accent }: { icon: IconName; label: string; value: string; detail: string; accent: string }) {
  return <article className={`admin-metric-card admin-accent-${accent}`}>
    <div className="admin-metric-icon"><Icon name={icon} /></div>
    <span>{label}</span>
    <strong>{value}</strong>
    <small>{detail}</small>
  </article>;
}

export default function AdminDashboard() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [stats, setStats] = useState<AdminStats>(EMPTY);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [view, setView] = useState<View>("overview");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const response = await fetch("/api/admin/stats", { cache: "no-store" });
      if (response.status === 401) {
        setAuthenticated(false);
        return;
      }
      if (!response.ok) throw new Error("运营数据加载失败，请稍后重试。");
      setStats(await response.json());
      setAuthenticated(true);
      setError("");
      const configResponse = await fetch("/api/admin/settings", { cache: "no-store" });
      if (configResponse.ok) setSettings(await configResponse.json());
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // The initial authenticated fetch populates this client-only dashboard.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().catch((reason) => {
      setAuthenticated((current) => current ?? false);
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  }, [load]);

  useEffect(() => {
    if (!authenticated) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load(true).catch(() => undefined);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [authenticated, load]);

  const healthyServices = useMemo(
    () => stats.services.filter((service) => service.state === "healthy").length,
    [stats.services],
  );

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: data.get("username"), password: data.get("password") }),
    });
    if (!response.ok) {
      setError("管理员账号或密码不正确。");
      return;
    }
    await load();
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSaveMessage("");
    const response = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...settings,
        [`ai_api_key_${selectedAiProvider}`]: apiKeyInput,
      }),
    });
    setSaving(false);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string };
      setError(payload.error || "配置保存失败，请检查服务状态后重试。");
      return;
    }
    if (apiKeyInput) {
      setSettings((value) => ({
        ...value,
        [`ai_api_key_${selectedAiProvider}_configured`]: "true",
      }));
      setApiKeyInput("");
    }
    setSaveMessage("配置已保存，新的默认模型将在数秒内用于后续请求。");
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    setAuthenticated(false);
  }

  if (authenticated === null) return <main className="admin-loading">
    <img src="/passwisely-logo-192.png" alt="PassWisely" width="58" height="58" />
    <span>正在载入运营数据</span><i />
  </main>;

  if (!authenticated) return <main className="admin-login">
    <div className="admin-login-art" aria-hidden="true"><div className="admin-orb admin-orb-one"/><div className="admin-orb admin-orb-two"/><div className="admin-login-message"><span>PASSWISELY OPERATIONS</span><strong>看清每一次增长，<br/>守住每一项服务。</strong><p>业务数据、支付转化与服务健康集中在一个安全工作台。</p></div></div>
    <form className="admin-login-card" onSubmit={login}>
      <div className="admin-login-brand"><img src="/passwisely-logo-192.png" alt="PassWisely" width="50" height="50" /><div><strong>PassWisely</strong><span>运营管理后台</span></div></div>
      <div className="admin-login-copy"><h1>欢迎回来</h1><p>使用管理员凭据继续</p></div>
      <label><span>管理员账号</span><input name="username" autoComplete="username" required autoFocus /></label>
      <label><span>密码</span><input name="password" type="password" autoComplete="current-password" required /></label>
      {error && <div className="admin-error">{error}</div>}
      <button className="admin-primary-button">安全登录 <span>→</span></button>
      <small className="admin-login-security">受加密会话保护 · 12 小时自动失效</small>
    </form>
  </main>;

  const nav = [
    { id: "overview" as const, label: "运营概览", icon: "overview" as const },
    { id: "services" as const, label: "服务监控", icon: "services" as const },
    { id: "settings" as const, label: "站点设置", icon: "settings" as const },
  ];
  const activeRate = stats.totalUsers ? Math.round(stats.mau / stats.totalUsers * 1000) / 10 : 0;
  const payingRate = stats.newUsers30d ? Math.round(stats.payingUsers30d / stats.newUsers30d * 1000) / 10 : 0;
  const selectedAiProvider = isAiProvider(settings.ai_default_provider)
    ? settings.ai_default_provider
    : "kimi";
  const selectedAiDefinition = AI_PROVIDER_CATALOG[selectedAiProvider];
  const selectedAiKeyConfigured =
    settings[`ai_api_key_${selectedAiProvider}_configured`] === "true";

  return <main className="admin-app">
    <aside className="admin-sidebar">
      <div className="admin-brand"><img src="/passwisely-logo-192.png" alt="PassWisely" width="42" height="42" /><div><strong>PassWisely</strong><span>Admin Console</span></div></div>
      <nav>{nav.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><Icon name={item.icon}/><span>{item.label}</span></button>)}</nav>
      <div className="admin-sidebar-status"><i className={healthyServices === stats.services.length ? "healthy" : "warning"}/><div><strong>{healthyServices}/{stats.services.length || 0} 服务正常</strong><span>每分钟自动更新</span></div></div>
      <button className="admin-logout" onClick={logout}><Icon name="logout"/><span>退出登录</span></button>
    </aside>

    <section className="admin-main">
      <header className="admin-topbar"><div><span className="admin-kicker">PASSWISELY · 运营中心</span><h1>{nav.find((item) => item.id === view)?.label}</h1><p>{view === "overview" ? "关键增长、使用与收入表现" : view === "services" ? "线上依赖、交付链路与服务器资源" : "控制注册与对外服务信息"}</p></div><div className="admin-top-actions"><div className="admin-live"><i/> 实时</div><button onClick={() => load().catch((reason) => setError(String(reason)))} disabled={refreshing}><Icon name="refresh"/>{refreshing ? "更新中" : "刷新数据"}</button></div></header>
      {error && <div className="admin-error admin-global-error">{error}</div>}

      {view === "overview" && <>
        <section className="admin-metric-grid">
          <MetricCard icon="users" label="总用户" value={formatNumber(stats.totalUsers)} detail={`今日 +${formatNumber(stats.newUsersToday)} · 近 7 日 +${formatNumber(stats.newUsers7d)}`} accent="violet" />
          <MetricCard icon="activity" label="月活用户 MAU" value={formatNumber(stats.mau)} detail={`DAU ${formatNumber(stats.dau)} · 活跃率 ${activeRate}%`} accent="blue" />
          <MetricCard icon="activity" label="近 7 日 AI 请求" value={formatNumber(stats.requests7d)} detail={`今日 ${formatNumber(stats.requestsToday)} · 30 日 ${formatNumber(stats.requests30d)}`} accent="cyan" />
          <MetricCard icon="coins" label="近 7 日积分消耗" value={formatNumber(stats.credits7d)} detail={`账户余额 ${formatNumber(stats.availableCredits)}`} accent="amber" />
          <MetricCard icon="revenue" label="近 30 日收入" value={formatMoney(stats.revenue30d)} detail={`${formatNumber(stats.completedOrders30d)} 笔完成订单`} accent="green" />
          <MetricCard icon="revenue" label="支付成功率" value={`${stats.paymentSuccessRate30d}%`} detail={`${formatNumber(stats.pendingOrders)} 笔待支付 · ${formatNumber(stats.failedOrders30d)} 笔失败`} accent="rose" />
        </section>

        <section className="admin-layout-wide">
          <article className="admin-card admin-usage-card"><div className="admin-card-heading"><div><span className="admin-card-kicker">USAGE TREND</span><h2>活跃与请求趋势</h2></div><div className="admin-legend"><span><i className="requests"/>请求数</span><span><i className="users"/>活跃用户</span></div></div><TrendChart daily={stats.daily}/><div className="admin-chart-summary"><div><span>30 日 Token</span><strong>{formatNumber(stats.tokens30d, true)}</strong></div><div><span>30 日积分</span><strong>{formatNumber(stats.credits30d)}</strong></div><div><span>在线会话</span><strong>{formatNumber(stats.onlineSessions)}</strong></div><div><span>简历任务</span><strong>{formatNumber(stats.resumeRuns30d)}</strong></div></div></article>
          <article className="admin-card"><div className="admin-card-heading"><div><span className="admin-card-kicker">CONVERSION</span><h2>30 日转化漏斗</h2></div></div><div className="admin-funnel"><div><i style={{ width: "100%" }}/><span>新增注册</span><strong>{formatNumber(stats.newUsers30d)}</strong></div><div><i style={{ width: `${Math.max(8, activeRate)}%` }}/><span>月活用户</span><strong>{formatNumber(stats.mau)}</strong><small>{activeRate}%</small></div><div><i style={{ width: `${Math.max(8, payingRate)}%` }}/><span>付费用户</span><strong>{formatNumber(stats.payingUsers30d)}</strong><small>{payingRate}%</small></div></div><div className="admin-mini-stat"><span>累计收入</span><strong>{formatMoney(stats.totalRevenue)}</strong></div></article>
        </section>

        <section className="admin-layout-three">
          <article className="admin-card"><div className="admin-card-heading"><div><span className="admin-card-kicker">FEATURES</span><h2>功能使用分布</h2></div><small>近 30 日</small></div><Breakdown items={stats.actionBreakdown}/></article>
          <article className="admin-card"><div className="admin-card-heading"><div><span className="admin-card-kicker">MODELS</span><h2>模型渠道分布</h2></div><small>近 30 日</small></div><Breakdown items={stats.providerBreakdown} names={providerNames}/></article>
          <article className="admin-card"><div className="admin-card-heading"><div><span className="admin-card-kicker">PAYMENTS</span><h2>支付渠道</h2></div><small>近 30 日</small></div>{stats.paymentBreakdown.length ? <div className="admin-payment-list">{stats.paymentBreakdown.map((item) => <div key={item.label}><div className={`admin-payment-mark ${item.label}`}>{item.label === "alipay" ? "支" : item.label === "wechat" ? "微" : "$"}</div><div><strong>{providerNames[item.label] || item.label}</strong><span>{item.completed}/{item.attempts} 笔成功</span></div><b>{formatMoney(item.revenue)}</b></div>)}</div> : <div className="admin-empty">暂无支付数据</div>}</article>
        </section>
      </>}

      {view === "services" && <>
        <section className="admin-service-summary"><div><span>服务健康度</span><strong>{stats.services.length ? Math.round(healthyServices / stats.services.length * 100) : 0}%</strong><small>{healthyServices} 项正常，{stats.services.length - healthyServices} 项需关注</small></div><div className="admin-health-ring" style={{ "--health": `${stats.services.length ? healthyServices / stats.services.length * 360 : 0}deg` } as React.CSSProperties}><span>{healthyServices}/{stats.services.length}</span></div></section>
        <section className="admin-performance-metrics">
          <article><span>当前 QPS</span><strong>{stats.qpsCurrent.toFixed(3)}</strong><small>最近 5 分钟平均</small></article>
          <article><span>1 小时峰值 QPS</span><strong>{stats.qpsPeak1h.toFixed(3)}</strong><small>{formatNumber(stats.requests5m)} 次请求 / 5 分钟</small></article>
          <article><span>平均响应耗时</span><strong>{formatNumber(stats.avgLatencyMs5m)} <em>ms</em></strong><small>最大 {formatNumber(stats.maxLatencyMs5m)} ms</small></article>
          <article><span>服务端错误率</span><strong>{stats.errorRate5m.toFixed(2)}<em>%</em></strong><small>统计 HTTP 5xx</small></article>
        </section>
        <section className="admin-layout-wide admin-performance-layout">
          <article className="admin-card"><div className="admin-card-heading"><div><span className="admin-card-kicker">REQUEST RATE</span><h2>最近 30 分钟请求量</h2></div><small>应用层实时采集</small></div><RequestRateChart points={stats.requestSeries}/></article>
          <article className="admin-card"><div className="admin-card-heading"><div><span className="admin-card-kicker">ROUTE LATENCY</span><h2>接口性能</h2></div><small>近 24 小时</small></div>{stats.routeBreakdown.length ? <div className="admin-route-table">{stats.routeBreakdown.map((route) => <div key={route.label}><span>{route.label}</span><strong>{formatNumber(route.requests)}</strong><b>{formatNumber(route.avgLatencyMs)} ms</b><em className={route.errors ? "error" : ""}>{route.errors} 错误</em></div>)}</div> : <div className="admin-empty">性能数据将在新请求进入后显示</div>}</article>
        </section>
        <section className="admin-download-summary">
          <div><span>今日下载</span><strong>{formatNumber(stats.downloadsToday)}</strong></div>
          <div><span>近 7 日下载</span><strong>{formatNumber(stats.downloads7d)}</strong></div>
          <div><span>累计下载</span><strong>{formatNumber(stats.downloadsTotal)}</strong></div>
          {Object.keys(platformNames).map((platform) => { const item = stats.downloadBreakdown.find((download) => download.label === platform); return <div key={platform}><span>{platformNames[platform]}</span><strong>{formatNumber(item?.sevenDays || 0)}</strong><small>7 日 / 累计 {formatNumber(item?.total || 0)}</small></div>; })}
        </section>
        <section className="admin-card admin-download-performance"><div className="admin-card-heading"><div><span className="admin-card-kicker">DOWNLOAD PERFORMANCE</span><h2>安装包下载性能</h2></div><small>每小时抽样 256 KB，不完整下载文件</small></div>{stats.downloadPerformance.length ? <div className="admin-download-table"><header><span>安装包</span><span>文件大小</span><span>首包耗时</span><span>抽样速度</span><span>预计完成</span><span>采集时间</span></header>{stats.downloadPerformance.map((download) => <div key={download.platform}><span><i className={download.status}/>{platformNames[download.platform] || download.platform}</span><span>{(download.objectBytes / 1024 / 1024).toFixed(1)} MB</span><span>{download.ttfbMs} ms</span><span>{(download.throughputBps / 1024 / 1024).toFixed(2)} MB/s</span><span>{download.estimatedSeconds.toFixed(1)} 秒</span><span>{download.createdAt ? new Date(download.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}</span></div>)}</div> : <div className="admin-empty">等待第一次下载性能采集</div>}</section>
        <section className="admin-service-grid">{stats.services.map((service) => <article className="admin-service-card" key={service.id}><div><i className={service.state}/><span>{service.group === "runtime" ? "运行服务" : service.group === "storage" ? "数据服务" : service.group === "delivery" ? "下载交付" : "生产配置"}</span></div><h2>{service.name}</h2><p>{service.detail}</p><footer><span className={`admin-state-${service.state}`}>{service.state === "healthy" ? "正常" : service.state === "degraded" ? "需检查" : "不可用"}</span>{service.latencyMs !== undefined && <b>{service.latencyMs} ms</b>}</footer></article>)}</section>
        <section className="admin-card admin-host-card"><div className="admin-card-heading"><div><span className="admin-card-kicker">WISE HOST</span><h2>服务器资源</h2></div><small>{stats.host ? `已运行 ${formatUptime(stats.host.uptimeSeconds)}` : "暂时无法读取"}</small></div>{stats.host ? <div className="admin-host-grid"><div><div><span>内存使用</span><strong>{stats.host.memoryUsedPercent}%</strong></div><i><b style={{ width: `${stats.host.memoryUsedPercent}%` }}/></i></div><div><div><span>磁盘使用</span><strong>{stats.host.diskUsedPercent}%</strong></div><i><b style={{ width: `${stats.host.diskUsedPercent}%` }}/></i></div><div><span>1 分钟负载</span><strong>{stats.host.loadAverage1m}</strong><small>{stats.host.cpuCount} 核 CPU</small></div><div><span>gRPC 进程</span><strong>{formatNumber(stats.host.processRssBytes / 1024 / 1024)} MB</strong><small>运行 {formatUptime(stats.host.processUptimeSeconds)}</small></div></div> : <div className="admin-empty">服务器健康端点尚未连接</div>}</section>
      </>}

      {view === "settings" && <section className="admin-settings-layout">
        <form className="admin-card admin-settings-card" onSubmit={saveSettings}>
          <div className="admin-card-heading"><div><span className="admin-card-kicker">AI RUNTIME</span><h2>默认大模型配置</h2></div><span className={`admin-secret-state ${selectedAiKeyConfigured ? "configured" : "missing"}`}>{selectedAiKeyConfigured ? "API Key 已配置" : "API Key 未配置"}</span></div>
          <label><div><strong>默认模型渠道</strong><span>未填写个人 API Key 的客户端统一使用该渠道</span></div><select value={selectedAiProvider} onChange={(event) => { const provider = isAiProvider(event.target.value) ? event.target.value : "kimi"; setApiKeyInput(""); setSaveMessage(""); setSettings((value) => ({ ...value, ai_default_provider: provider, ai_default_model: AI_PROVIDER_CATALOG[provider].defaultModel })); }}>
            {Object.entries(AI_PROVIDER_CATALOG).map(([id, definition]) => <option key={id} value={id}>{definition.label}</option>)}
          </select></label>
          <label><div><strong>模型型号</strong><span>可选择推荐型号，也可以填写服务商支持的自定义型号</span></div><div className="admin-model-field"><input value={settings.ai_default_model || selectedAiDefinition.defaultModel} list="admin-model-options" maxLength={100} spellCheck={false} onChange={(event) => setSettings((value) => ({ ...value, ai_default_model: event.target.value }))}/><datalist id="admin-model-options">{selectedAiDefinition.models.map((model) => <option key={model} value={model}/>)}</datalist><small>当前渠道：{selectedAiDefinition.label}</small></div></label>
          <label><div><strong>{selectedAiDefinition.label} API Key</strong><span>每个模型渠道独立保存；留空表示保留该渠道当前 Key</span></div><div className="admin-model-field"><input type="password" autoComplete="new-password" value={apiKeyInput} maxLength={4096} placeholder={selectedAiKeyConfigured ? "已安全配置 · 输入新 Key 可替换" : `请输入 ${selectedAiDefinition.label} API Key`} onChange={(event) => setApiKeyInput(event.target.value)}/><small>密钥会加密写入 Supabase，不会通过管理接口回显或写入日志</small></div></label>
          <div className="admin-settings-section"><span className="admin-card-kicker">SITE CONTROL</span><h2>站点配置</h2></div>
          <label><div><strong>开放新用户注册</strong><span>关闭后现有用户仍可正常登录和使用</span></div><select value={settings.registration_enabled || "true"} onChange={(event) => setSettings((value) => ({ ...value, registration_enabled: event.target.value }))}><option value="true">已开启</option><option value="false">已关闭</option></select></label>
          <label><div><strong>客服邮箱</strong><span>用于网站和客户端的用户支持入口</span></div><input type="email" value={settings.support_email || ""} placeholder="support@passwisely.com" onChange={(event) => setSettings((value) => ({ ...value, support_email: event.target.value }))}/></label>
          <label className="admin-settings-message"><div><strong>维护公告</strong><span>为空时不展示公告，最多 500 字</span></div><textarea value={settings.maintenance_message || ""} rows={6} maxLength={500} placeholder="输入维护时间或重要通知…" onChange={(event) => setSettings((value) => ({ ...value, maintenance_message: event.target.value }))}/><small>{(settings.maintenance_message || "").length}/500</small></label>
          {saveMessage && <div className="admin-settings-success" role="status">{saveMessage}</div>}
          <button className="admin-primary-button" disabled={saving}>{saving ? "正在保存…" : "保存全部配置"}</button>
        </form>
        <aside className="admin-card admin-settings-note"><span className="admin-card-kicker">SECURITY</span><h2>安全说明</h2><p>默认 API Key 使用管理员会话密钥派生的 AES-GCM 密钥加密后存入 Supabase；管理接口只返回“是否已配置”，不会返回密钥内容。</p><ul><li>修改渠道时请同时更新对应 API Key</li><li>配置将在 10 秒内作用于新的模型请求</li><li>服务器环境变量仅作为数据库不可用时的回退</li><li>建议每 90 天轮换管理员密码和模型密钥</li></ul></aside>
      </section>}

      <footer className="admin-footer"><span>数据时间：{stats.generatedAt ? new Date(stats.generatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "—"}</span><span>自动刷新间隔 60 秒 · Asia/Shanghai</span></footer>
    </section>
  </main>;
}
