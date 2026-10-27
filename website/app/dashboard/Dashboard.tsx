"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import type { AccountUser } from "@/lib/auth";
import type { AccountUsageReport } from "../../../shared/account-usage";
import { CREDIT_PACKS, type CreditPackId } from "../../lib/payments/catalog";
import { DOWNLOAD_ARTIFACTS, type DownloadPlatform } from "../../lib/downloads";

export interface DashboardProps {
  locale: "zh" | "en";
  onLocale: (locale: "zh" | "en") => void;
  onAccount: () => void;
  onBuy: (packId: CreditPackId) => void;
  onLogout: () => Promise<void>;
  onUser: (user: AccountUser) => void;
  onUnauthorized: () => void;
  refreshRevision?: number;
}
type UsageResponse = AccountUsageReport & { user: AccountUser };
type UsageState = { key: string; data: UsageResponse; error: false } | { key: string; data: null; error: true };
type ChartMetric = "recordedRequests" | "totalTokens" | "netCreditsUsed";
type IconName = "grid" | "chart" | "wallet" | "download" | "arrow" | "logout" | "refresh" | "clock" | "check" | "token" | "external" | "apple" | "windows";

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    chart: <><path d="M4 4v16h17M8 14l4-5 4 3 5-7"/></>,
    wallet: <><rect x="3" y="5" width="18" height="15" rx="3"/><path d="M17 10h4v5h-4a2.5 2.5 0 0 1 0-5ZM5 5V4a1 1 0 0 1 1-1h12"/></>,
    download: <><path d="M12 3v12m-4-4 4 4 4-4M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
    logout: <><path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M9 12h12m-4-4 4 4-4 4"/></>,
    refresh: <><path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    token: <><path d="m12 2 9 5v10l-9 5-9-5V7Z"/><path d="m3 7 9 5 9-5m-9 5v10"/></>,
    external: <><path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/></>,
    apple: <><path d="M15.8 3c-.1 2-1.3 3.2-3.1 3.4C12.6 4.6 13.9 3.2 15.8 3ZM18.8 16.3c-.7 1.5-1.8 3.7-3.4 3.7-1 0-1.4-.5-2.7-.5-1.2 0-1.8.5-2.7.5-1.6 0-2.7-2-3.6-3.8-1.8-3.7-1-7.6 1.6-8.7 1.3-.6 2.5-.3 3.5.1.7.3 1.4.3 2.1 0 1.2-.5 2.8-.8 4 .1.4.2.9.6 1.3 1.1-2.9 1.6-2.9 5.6-.1 7.5Z"/></>,
    windows: <><path d="m3 5 8-1v7H3Zm10-1 8-1v8h-8ZM3 13h8v7l-8-1Zm10 0h8v8l-8-1Z"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function number(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function validTotals(value: unknown): boolean {
  return record(value) && ["recordedRequests", "promptTokens", "completionTokens", "totalTokens", "creditsDebited", "creditsRefunded"].every(key => number(value[key])) && Number.isSafeInteger(value.netCreditsUsed);
}
// Validate the JSON transport before rendering; the server owns accounting and aggregation.
function isUsageResponse(value: unknown, days: number): value is UsageResponse {
  if (!record(value) || !record(value.user) || !record(value.period) || !record(value.recent) || !record(value.coverage)) return false;
  const { user, period, recent, coverage } = value;
  if (typeof user.id !== "string" || typeof user.email !== "string" || !["zh", "en"].includes(String(user.locale)) || !number(user.credits) || !record(user.creditBalance)) return false;
  const balance = user.creditBalance;
  if (![balance.balance, balance.permanentBalance, balance.expiringBalance].every(number) || (balance.nextExpiry !== null && (typeof balance.nextExpiry !== "string" || !Number.isFinite(Date.parse(balance.nextExpiry))))) return false;
  return period.days === days && period.timeZone === "UTC" && typeof period.from === "string" && Number.isFinite(Date.parse(period.from)) && typeof period.to === "string" && Number.isFinite(Date.parse(period.to)) && validTotals(value.summary) &&
    Array.isArray(value.daily) && value.daily.length === days && value.daily.every(day => record(day) && typeof day.date === "string" && Number.isFinite(Date.parse(day.date)) && validTotals(day)) &&
    Array.isArray(recent.items) && recent.items.length <= 20 && recent.items.every(item => record(item) && typeof item.id === "string" && typeof item.action === "string" && (item.provider === null || typeof item.provider === "string") && (item.model === null || typeof item.model === "string") && [item.promptTokens, item.completionTokens, item.totalTokens, item.recordedCredits].every(number) && typeof item.createdAt === "string" && Number.isFinite(Date.parse(item.createdAt))) &&
    (recent.nextCursor === null || typeof recent.nextCursor === "string") && coverage.requests === "recorded_events" && coverage.tokens === "reported_only" && coverage.credits === "ledger" && coverage.audioMinutes === false;
}

function DailyChart({ report, locale, metric, onMetric }: { report: AccountUsageReport; locale: "zh" | "en"; metric: ChartMetric; onMetric: (metric: ChartMetric) => void }) {
  const [selected, setSelected] = useState<number | null>(null);
  const chartId = useId();
  const zh = locale === "zh";
  const format = (value: number) => new Intl.NumberFormat(zh ? "zh-CN" : "en-US").format(value);
  const names: Record<ChartMetric, string> = { recordedRequests: zh ? "请求" : "Requests", totalTokens: "Tokens", netCreditsUsed: zh ? "净消耗积分" : "Net credits" };
  const values = report.daily.map(day => day[metric]);
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const width = 720, height = 230, left = 42, right = 12, top = 18, bottom = 34;
  const graphWidth = width - left - right, graphHeight = height - top - bottom;
  const y = (value: number) => top + graphHeight * (max - value) / (max - min);
  const step = graphWidth / values.length;
  const selectedDay = selected === null ? null : report.daily[selected];
  const hasActivity = values.some(value => value !== 0);
  return <section className="pd-card pd-chart-card" aria-labelledby={`${chartId}-title`}>
    <div className="pd-card-heading"><div><span className="pd-eyebrow">ACTIVITY</span><h2 id={`${chartId}-title`}>{zh ? "每一次准备，都看得见。" : "See your preparation take shape."}</h2></div><div className="pd-chart-metrics" aria-label={zh ? "图表指标" : "Chart metric"}>{(Object.keys(names) as ChartMetric[]).map(key => <button key={key} type="button" onClick={() => { onMetric(key); setSelected(null); }} aria-pressed={metric === key}>{names[key]}</button>)}</div></div>
    <div className="pd-chart-figure">
      <div className="pd-chart-reading" aria-live="polite">{selectedDay ? <><span>{selectedDay.date} · UTC</span><strong>{format(selectedDay[metric])} <small>{names[metric]}</small></strong></> : <><span>{zh ? `最近 ${report.period.days} 天` : `Last ${report.period.days} days`}</span><strong>{format(report.summary[metric])} <small>{names[metric]}</small></strong></>}</div>
      <svg className="pd-chart" viewBox={`0 0 ${width} ${height}`} role="group" aria-label={zh ? "每日使用量。按 Tab 查看各日数据，也可展开下方数据表。" : "Daily usage. Tab through dates, or expand the data table below."}>
        {[...new Set([min, Math.round((min + max) / 2), max])].map(value => <g key={value}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} className="pd-chart-grid"/><text x={left - 10} y={y(value) + 4} textAnchor="end">{new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value)}</text></g>)}
        {report.daily.map((day, index) => { const value = day[metric], x = left + step * index; return <g key={day.date}>
          <rect x={x + step * .24} y={Math.min(y(0), y(value))} width={step * .52} height={value === 0 ? 0 : Math.max(2, Math.abs(y(0) - y(value)))} rx={Math.min(4, step * .12)} className={selected === index ? "pd-chart-bar is-selected" : "pd-chart-bar"}/>
          <rect x={x} y={top} width={step} height={graphHeight} className="pd-chart-target" tabIndex={0} role="img" aria-label={`${day.date}, ${names[metric]}: ${format(value)}`} onFocus={() => setSelected(index)} onBlur={() => setSelected(null)} onMouseEnter={() => setSelected(index)} onMouseLeave={() => setSelected(null)} />
          {(index === 0 || index === report.daily.length - 1 || (report.daily.length === 7 ? index === 3 : index === 9 || index === 19)) && <text x={x + step / 2} y={height - 9} textAnchor="middle">{day.date.slice(5).replace("-", "/")}</text>}
        </g>; })}
        <line x1={left} x2={width - right} y1={y(0)} y2={y(0)} className="pd-chart-baseline"/>
      </svg>
      {!hasActivity && <p className="pd-chart-empty">{zh ? "此期间暂无该指标的记录" : "No recorded activity for this metric yet"}</p>}
    </div>
    <div className="pd-chart-footnote"><span className="pd-legend"><i/>{names[metric]}</span><span>{zh ? "按 UTC 自然日统计，今日持续更新" : "UTC calendar days · today is partial"}</span></div>
    <details className="pd-chart-details"><summary>{zh ? "查看每日数据表" : "View daily data table"}</summary><div className="pd-table-scroll"><table><caption className="pd-sr-only">{zh ? "按 UTC 日期汇总的使用量" : "Usage totals by UTC date"}</caption><thead><tr><th scope="col">{zh ? "日期（UTC）" : "Date (UTC)"}</th><th scope="col">{zh ? "记录请求" : "Requests"}</th><th scope="col">Tokens</th><th scope="col">{zh ? "扣除积分" : "Debits"}</th><th scope="col">{zh ? "退回积分" : "Refunds"}</th><th scope="col">{zh ? "净消耗" : "Net credits"}</th></tr></thead><tbody>{report.daily.map(day => <tr key={day.date}><th scope="row">{day.date}</th><td>{format(day.recordedRequests)}</td><td>{format(day.totalTokens)}</td><td>{format(day.creditsDebited)}</td><td>{format(day.creditsRefunded)}</td><td>{format(day.netCreditsUsed)}</td></tr>)}</tbody></table></div></details>
  </section>;
}

export function Dashboard(props: DashboardProps) {
  const { locale, onLocale, onAccount, onBuy } = props;
  const zh = locale === "zh";
  const [days, setDays] = useState<7 | 30>(30);
  const [refresh, setRefresh] = useState(0);
  const [usage, setUsage] = useState<UsageState | null>(null);
  const [page, setPage] = useState<{ key: string; busy: boolean; error: boolean } | null>(null);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const [section, setSection] = useState("dashboard-overview");
  const [metric, setMetric] = useState<ChartMetric>("recordedRequests");
  const generation = useRef(0);
  const pageAbort = useRef<AbortController | null>(null);
  const callbacks = useRef(props);
  const requestKey = `${days}:${refresh}:${props.refreshRevision ?? 0}`;
  const data = usage?.key === requestKey ? usage.data : null;
  const error = usage?.key === requestKey && usage.error;
  const loading = !data && !error;
  const pageBusy = page?.key === requestKey && page.busy;
  const pageError = page?.key === requestKey && page.error;
  useEffect(() => { callbacks.current = props; });
  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;
    pageAbort.current?.abort();
    void (async () => {
      try {
        const response = await fetch(`/api/account/usage?days=${days}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        if (current !== generation.current || controller.signal.aborted) return;
        if (response.status === 401) { callbacks.current.onUnauthorized(); return; }
        if (!response.ok) throw new Error("Usage unavailable");
        const value: unknown = await response.json();
        if (current !== generation.current || controller.signal.aborted) return;
        if (!isUsageResponse(value, days)) throw new Error("Invalid usage response");
        setUsage({ key: requestKey, data: value, error: false }); callbacks.current.onUser(value.user);
      } catch { if (current === generation.current && !controller.signal.aborted) setUsage({ key: requestKey, data: null, error: true }); }
    })();
    return () => { controller.abort(); pageAbort.current?.abort(); };
  }, [days, requestKey]);
  useEffect(() => {
    const focused = () => { if (!loading && !logoutBusy && document.visibilityState !== "hidden") setRefresh(value => value + 1); };
    window.addEventListener("focus", focused);
    return () => window.removeEventListener("focus", focused);
  }, [loading, logoutBusy]);
  useEffect(() => {
    const hashChanged = () => { const hash = window.location.hash.slice(1); if (["dashboard-overview", "usage", "billing", "downloads"].includes(hash)) setSection(hash); };
    hashChanged(); window.addEventListener("hashchange", hashChanged);
    return () => window.removeEventListener("hashchange", hashChanged);
  }, []);
  const format = useMemo(() => new Intl.NumberFormat(zh ? "zh-CN" : "en-US"), [zh]);
  const dateTime = (value: string) => new Intl.DateTimeFormat(zh ? "zh-CN" : "en-GB", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
  async function nextPage() {
    if (!data?.recent.nextCursor || pageBusy || pageAbort.current && !pageAbort.current.signal.aborted) return;
    const controller = new AbortController(); pageAbort.current = controller;
    const current = generation.current;
    setPage({ key: requestKey, busy: true, error: false });
    try {
      const response = await fetch(`/api/account/usage?days=${days}&cursor=${encodeURIComponent(data.recent.nextCursor)}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
      if (current !== generation.current || controller.signal.aborted) return;
      if (response.status === 401) { callbacks.current.onUnauthorized(); return; }
      if (!response.ok) throw new Error("Usage unavailable");
      const value: unknown = await response.json();
      if (current !== generation.current || controller.signal.aborted) return;
      if (!isUsageResponse(value, days) || value.period.to !== data.period.to || value.user.id !== data.user.id) throw new Error("Invalid usage page");
      setUsage(previous => previous?.key === requestKey && previous.data ? { ...previous, data: { ...value, recent: { items: [...previous.data.recent.items, ...value.recent.items], nextCursor: value.recent.nextCursor } } } : previous);
      callbacks.current.onUser(value.user);
    } catch { if (current === generation.current && !controller.signal.aborted) setPage({ key: requestKey, busy: false, error: true }); }
    finally { if (current === generation.current && !controller.signal.aborted) { setPage(previous => previous?.key === requestKey ? { ...previous, busy: false } : previous); pageAbort.current = null; } }
  }
  async function logout() {
    if (logoutBusy) return;
    // Sign-out owns the session transition. Pending usage reads must not
    // restore private data or redirect after that transition has begun.
    ++generation.current;
    pageAbort.current?.abort();
    setLogoutBusy(true); setLogoutError(false);
    try { await callbacks.current.onLogout(); }
    catch { setLogoutError(true); setLogoutBusy(false); setRefresh(value => value + 1); }
  }
  const nav: Array<{ id: string; icon: IconName; label: string }> = [
    { id: "dashboard-overview", icon: "grid", label: zh ? "概览" : "Overview" },
    { id: "usage", icon: "chart", label: zh ? "使用量" : "Usage" },
    { id: "billing", icon: "wallet", label: zh ? "积分与套餐" : "Credits & plans" },
    { id: "downloads", icon: "download", label: zh ? "下载应用" : "Downloads" },
  ];
  return <div className="pd-app">
    <a href="#dashboard-main" className="pd-skip">{zh ? "跳到主要内容" : "Skip to content"}</a>
    <aside className="pd-sidebar" aria-label={zh ? "工作台导航" : "Workspace navigation"}>
      <Link className="pd-brand" href="/"><img src="/passwisely-logo.png" alt="" width="38" height="38"/><span>PassWisely<small>YOUR PREPARATION SPACE</small></span></Link>
      <span className="pd-nav-label">WORKSPACE</span>
      <nav>{nav.map(item => <a href={`#${item.id}`} key={item.id} aria-current={section === item.id ? "location" : undefined} onClick={() => setSection(item.id)}><Icon name={item.icon}/><span>{item.label}</span>{section === item.id && <i/>}</a>)}</nav>
      <div className="pd-sidebar-bottom"><Link href="/" className="pd-home-link">{zh ? "回到官网" : "Back to website"}<Icon name="external" size={14}/></Link><button className="pd-account" aria-label={zh ? "我的账户与安全" : "My account and security"} onClick={onAccount} disabled={logoutBusy} type="button"><span className="pd-avatar">{data ? data.user.email.slice(0, 1).toUpperCase() : "P"}</span><span><strong>{zh ? "我的账户" : "My account"}</strong><small>{data ? data.user.email : zh ? "账户与安全" : "Account & security"}</small></span><Icon name="arrow" size={15}/></button><button className="pd-logout" onClick={() => void logout()} disabled={logoutBusy} type="button"><Icon name="logout" size={16}/>{logoutBusy ? zh ? "正在退出…" : "Signing out…" : zh ? "退出登录" : "Sign out"}</button>{logoutError && <p className="pd-sidebar-error" role="alert">{zh ? "退出失败，请重试。" : "Could not sign out. Please retry."}</p>}</div>
    </aside>
    <main className="pd-main" id="dashboard-main">
      <header className="pd-topbar"><div className="pd-breadcrumb">WORKSPACE <span>/</span> <strong>Dashboard</strong></div><div className="pd-top-actions"><div className="pd-locale" aria-label={zh ? "语言" : "Language"}><button onClick={() => onLocale("zh")} aria-pressed={zh} type="button">中</button><span>/</span><button onClick={() => onLocale("en")} aria-pressed={!zh} type="button">EN</button></div><span className="pd-private"><Icon name="check" size={13}/>{zh ? "仅你可见" : "Private to you"}</span></div></header>
      <section className="pd-page-heading" id="dashboard-overview"><div><span className="pd-eyebrow">YOUR DASHBOARD</span><h1>{zh ? "为下一次，从容准备。" : "Make your next move count."}</h1><p>{zh ? "你的使用量、积分与工具，都在这里。" : "Your activity, credits, and tools. All in one place."}</p></div><div className="pd-period-controls"><div className="pd-period" aria-label={zh ? "统计期间" : "Usage period"}>{([7, 30] as const).map(value => <button type="button" key={value} aria-pressed={days === value} onClick={() => setDays(value)}>{zh ? `${value} 天` : `${value} days`}</button>)}</div><button className="pd-refresh" disabled={loading || logoutBusy} type="button" onClick={() => setRefresh(value => value + 1)} aria-label={zh ? "刷新使用量" : "Refresh usage"} title={zh ? "刷新使用量" : "Refresh usage"}><Icon name="refresh" size={17}/></button></div></section>
      <div aria-busy={loading} className="pd-data-region">
        {loading && <div className="pd-loading" role="status"><div className="pd-skeleton-metrics">{[0, 1, 2].map(value => <div key={value}><i/><b/><i/></div>)}</div><div className="pd-skeleton-chart"/><span>{zh ? "正在读取你的使用量…" : "Loading your usage…"}</span></div>}
        {error && <section className="pd-error" role="alert"><span className="pd-error-icon"><Icon name="chart" size={28}/></span><h2>{zh ? "使用量暂时无法加载" : "Your usage could not be loaded"}</h2><p>{zh ? "请稍后重试。此状态不代表你的使用量或积分为零。" : "Please try again. Your usage and credit balance are not zeroed by this error."}</p><button type="button" className="pd-button pd-button-gold" onClick={() => setRefresh(value => value + 1)}><Icon name="refresh" size={15}/>{zh ? "重新加载" : "Try again"}</button></section>}
        {data && !loading && <>
          <div className="pd-metric-grid"><article className="pd-metric"><div><span>{zh ? "已记录请求" : "Recorded requests"}</span><Icon name="chart"/></div><strong>{format.format(data.summary.recordedRequests)}<small>{zh ? "次" : "requests"}</small></strong><p>{zh ? "来自已有的 AI 使用事件" : "From recorded AI usage events"}</p></article><article className="pd-metric"><div><span>{zh ? "已上报 Tokens" : "Reported tokens"}</span><Icon name="token"/></div><strong>{format.format(data.summary.totalTokens)}<small>tokens</small></strong><p>{zh ? "输入" : "Input"} {format.format(data.summary.promptTokens)} <i/> {zh ? "输出" : "Output"} {format.format(data.summary.completionTokens)}</p></article><article className="pd-metric"><div><span>{zh ? "净消耗积分" : "Net credits used"}</span><Icon name="wallet"/></div><strong>{format.format(data.summary.netCreditsUsed)}<small>{zh ? "积分" : "credits"}</small></strong><p>{zh ? "扣除" : "Debited"} {format.format(data.summary.creditsDebited)} <i/> {zh ? "退回" : "Refunded"} {format.format(data.summary.creditsRefunded)}</p></article></div>
          <div className="pd-overview-grid"><DailyChart report={data} locale={locale} metric={metric} onMetric={setMetric}/><aside className="pd-credit-card" aria-labelledby="pd-credit-title"><div className="pd-credit-heading"><span className="pd-eyebrow">READY WHEN YOU ARE</span><Icon name="wallet" size={23}/></div><h2 id="pd-credit-title">{zh ? "可用积分" : "Available credits"}</h2><strong className="pd-credit-balance">{format.format(data.user.creditBalance.balance)}<small>{zh ? "积分" : "credits"}</small></strong><div className="pd-credit-breakdown"><div><span>{zh ? "永久积分" : "Permanent"}</span><strong>{format.format(data.user.creditBalance.permanentBalance)}</strong></div><div><span>{zh ? "限期积分" : "Expiring"}</span><strong>{format.format(data.user.creditBalance.expiringBalance)}</strong></div></div><p className="pd-credit-expiry"><Icon name="clock" size={14}/>{data.user.creditBalance.nextExpiry ? <span>{zh ? "最近到期" : "Next expiry"}<br/><time dateTime={data.user.creditBalance.nextExpiry}>{dateTime(data.user.creditBalance.nextExpiry)} UTC</time></span> : <span>{zh ? "当前没有即将到期的积分" : "No credits scheduled to expire"}</span>}</p><a className="pd-button pd-button-gold" href="#billing" onClick={() => setSection("billing")}>{zh ? "补充准备的底气" : "Add credits"}<Icon name="arrow" size={17}/></a><small className="pd-credit-note">{zh ? "手动续购，自主掌握节奏" : "Manual renewal. Your pace, your choice."}</small></aside></div>
          <section className="pd-card pd-usage-card" id="usage" aria-labelledby="pd-usage-title"><div className="pd-card-heading"><div><span className="pd-eyebrow">USAGE HISTORY</span><h2 id="pd-usage-title">{zh ? "使用记录" : "Usage history"}</h2></div><span className="pd-subtle">{zh ? "最近发生优先 · UTC" : "Newest first · UTC"}</span></div><p className="pd-period-caption"><time dateTime={data.period.from}>{dateTime(data.period.from)}</time> — <time dateTime={data.period.to}>{dateTime(data.period.to)}</time> UTC</p>
            {data.recent.items.length ? <div className="pd-table-scroll"><table className="pd-usage-table"><caption className="pd-sr-only">{zh ? "账户 AI 使用事件；事件积分不代表账单扣款" : "Account AI usage events. Recorded credits are not billing debits."}</caption><thead><tr><th scope="col">{zh ? "操作 / 模型" : "Action / model"}</th><th scope="col">{zh ? "服务商" : "Provider"}</th><th scope="col">{zh ? "输入 / 输出 Tokens" : "Input / output tokens"}</th><th scope="col">{zh ? "事件记录积分" : "Recorded credits"}</th><th scope="col">{zh ? "时间（UTC）" : "Time (UTC)"}</th></tr></thead><tbody>{data.recent.items.map(item => <tr key={item.id}><td><strong>{item.action}</strong><span>{item.model ?? (zh ? "未上报模型" : "Model not reported")}</span></td><td>{item.provider ?? (zh ? "未上报" : "Not reported")}</td><td><strong>{format.format(item.totalTokens)}</strong><span>{format.format(item.promptTokens)} / {format.format(item.completionTokens)}</span></td><td>{format.format(item.recordedCredits)}</td><td><time dateTime={item.createdAt}>{dateTime(item.createdAt)}</time></td></tr>)}</tbody></table></div> : <div className="pd-empty"><span><Icon name="chart" size={25}/></span><h3>{zh ? "你的下一次准备，从这里开始。" : "Your next preparation starts here."}</h3><p>{zh ? "该期间暂无已记录的 AI 请求。使用桌面应用后，已记录的活动会显示在这里。" : "No AI requests recorded in this period. Recorded desktop activity will appear here."}</p><a href="#downloads" onClick={() => setSection("downloads")}>{zh ? "下载桌面应用" : "Get the desktop app"}<Icon name="arrow" size={16}/></a></div>}
            {pageError && <p className="pd-inline-error" role="alert">{zh ? "更多记录加载失败，请重试；也可刷新统计重新开始。" : "Could not load more records. Retry, or refresh usage to start again."}</p>}
            {data.recent.nextCursor && <div className="pd-pagination"><span>{zh ? `已显示 ${format.format(data.recent.items.length)} 条` : `${format.format(data.recent.items.length)} records shown`}</span><button type="button" disabled={pageBusy || logoutBusy} onClick={() => void nextPage()}>{pageBusy ? zh ? "正在加载…" : "Loading…" : pageError ? zh ? "重试加载" : "Retry" : zh ? "加载更多" : "Load more"}<Icon name="arrow" size={15}/></button></div>}
          </section>
          <details className="pd-coverage"><summary><span className="pd-info-mark">i</span>{zh ? "这些数字包含什么？" : "What do these numbers include?"}<span>+</span></summary><div><p>{zh ? "请求数来自已记录的 AI 使用事件，并非每次点击或所有请求尝试。Tokens 仅包含服务商已上报的用量；未上报的用量无法从这里推断。" : "Requests count recorded AI usage events, not every click or attempted request. Tokens only include usage reported by providers; unreported usage cannot be inferred here."}</p><p>{zh ? "净消耗积分按积分账本的扣除减退回计算。明细中的“事件记录积分”是事件元数据，不能与实际账单划等号。客户端直连自有 Key 的请求（BYOK）可能未进入此统计。" : "Net credits use ledger debits minus refunds. Recorded credits on individual events are metadata, not a billing statement. Requests sent directly using your own key (BYOK) may not appear here."}</p><p>{zh ? "当前尚未统计音频时长、ASR 分钟数或识别准确率；这些项目没有被计为零。" : "Audio duration, ASR minutes, and recognition accuracy are not currently measured. These are unavailable, not zero."}</p></div></details>
        </>}
      </div>
      <section className="pd-billing-section" id="billing" aria-labelledby="pd-billing-title"><div className="pd-section-heading"><div><span className="pd-eyebrow">KEEP YOUR MOMENTUM</span><h2 id="pd-billing-title">{zh ? "按需补充，继续准备。" : "Keep your preparation moving."}</h2></div><span>{zh ? "手动续购 · 无自动扣款" : "Manual renewal · no automatic charges"}</span></div><div className="pd-plans">{(Object.entries(CREDIT_PACKS) as Array<[CreditPackId, typeof CREDIT_PACKS[CreditPackId]]>).map(([id, pack], index) => <article className={`pd-plan${index === 0 ? " pd-plan-featured" : ""}`} key={id}><div className="pd-plan-title"><h3>{zh ? pack.name : pack.nameEn}</h3><span>{format.format(pack.credits)} {zh ? "积分" : "credits"}</span></div><p>{index === 0 ? zh ? "为完整的求职周期留出空间" : "Room for your next interview cycle" : zh ? "为更高频的准备，从容加码" : "More room for a focused preparation routine"}</p><div className="pd-plan-bottom"><strong><small>¥</small>{format.format(pack.amountFen / 100)}<span>{zh ? "/月" : "/month"}</span></strong><button type="button" className={`pd-button ${index === 0 ? "pd-button-gold" : "pd-button-outline"}`} disabled={logoutBusy} onClick={() => onBuy(id)}>{zh ? "购买积分" : "Buy credits"}<Icon name="arrow" size={16}/></button></div><div className="pd-plan-validity"><Icon name="check" size={14}/>{zh ? `每次到账后 ${pack.validityDays} 天到期，独立计算` : `Each purchase expires ${pack.validityDays} days after delivery`}</div></article>)}</div><p className="pd-billing-note">{zh ? "“无限制包”包含 1,000 积分，仍按实际使用扣除。续购不会延长已有积分的有效期；原永久积分保持有效。" : "The Unlimited plan includes 1,000 credits and remains credit based. Repurchasing does not extend existing grants. Permanent credits keep their original validity."}</p></section>
      <section className="pd-download-section" id="downloads" aria-labelledby="pd-download-title">
        <div className="pd-section-heading"><div><span className="pd-eyebrow">YOUR DESKTOP, READY</span><h2 id="pd-download-title">{zh ? "让工具，就位。" : "Put your tools within reach."}</h2></div></div>
        <div className="pd-downloads">
          {(["mac-arm64", "mac-x64", "windows-x64"] as DownloadPlatform[]).map(platform => {
            const artifact = DOWNLOAD_ARTIFACTS[platform];
            const name = platform === "mac-arm64" ? "macOS Apple silicon" : platform === "mac-x64" ? "macOS Intel" : "Windows x64";
            const chip = platform === "mac-arm64" ? zh ? "Apple 芯片" : "Apple silicon" : platform === "mac-x64" ? "Intel x64" : "Windows x64";
            return <article className="pd-download-card" data-platform={platform} key={platform}>
              <span className="pd-os-icon"><Icon name={platform === "windows-x64" ? "windows" : "apple"} size={25}/></span>
              <div>
                <h3>{platform === "windows-x64" ? "Windows" : "macOS"}<span>v{artifact.version}</span></h3>
                <p>{chip}{artifact.legacy ? zh ? " · 旧版" : " · Legacy" : ""}{artifact.liveAudio === "not_included" ? zh ? " · 不含实时音频" : " · No live audio" : ""}</p>
              </div>
              {artifact.available
                ? <a href={`/api/download/${platform}`} className="pd-download-link" aria-label={`${zh ? "下载" : "Download"} ${name}`}><Icon name="download" size={19}/></a>
                : <span className="pd-download-notice">{zh ? "安装包准备中，暂时无法下载。" : "Installer pending; not available yet."}</span>}
              {artifact.notice && <p className="pd-download-notice">{artifact.notice[locale]}</p>}
            </article>;
          })}
        </div>
      </section>
      <footer className="pd-footer"><span>© {new Date().getUTCFullYear()} PassWisely</span><span>{zh ? "准备充分，表达从容。" : "Prepared with purpose."}</span></footer>
    </main>
  </div>;
}
