"use client";

import { Component, type ReactNode } from "react";

type Props = {
  kind: "dashboard" | "qr";
  locale: "zh" | "en";
  children: ReactNode;
};

// React.lazy retains a rejected import promise. Recover with a full document
// reload, rather than resetting this boundary or reopening the same lazy view.
export class DeferredViewBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const zh = this.props.locale === "zh";
    const qr = this.props.kind === "qr";
    const recovery = <section role="alert" className="deferred-view-error">
      <h2>{qr ? (zh ? "二维码加载失败" : "QR code could not load") : (zh ? "控制台加载失败" : "Dashboard could not load")}</h2>
      <p>{qr
        ? (zh ? "请重新加载页面，先查看账户积分与订单，避免重复付款。" : "Reload the page, then check your credits and order before paying again.")
        : (zh ? "请检查网络后重新加载页面，或返回首页。" : "Check your connection and reload the page, or return home.")}</p>
      <button type="button" onClick={() => window.location.reload()}>{zh ? "重新加载页面" : "Reload page"}</button>
      {" "}<a href={qr ? "/dashboard" : "/"}>{qr ? (zh ? "查看账户" : "View account") : (zh ? "返回首页" : "Return home")}</a>
    </section>;
    return qr ? recovery : <main className="pw-container">{recovery}</main>;
  }
}
