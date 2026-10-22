"use client";

/* These original illustrations use the existing local brand asset. */
/* eslint-disable @next/next/no-img-element */

import { useId, useState, type CSSProperties } from "react";
import "./landing-privacy.css";

type Locale = "zh" | "en";
type GlyphName = "dock" | "eye" | "pointer" | "shield";

function PrivacyGlyph({ name }: { name: GlyphName }) {
  const paths = {
    dock: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 15h18M7 18h.01M12 18h.01M17 18h.01" />
      </>
    ),
    eye: (
      <>
        <path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A11 11 0 0 1 12 5c6 0 10 7 10 7a19 19 0 0 1-3.2 3.9M6.2 6.2A19 19 0 0 0 2 12s4 7 10 7a11 11 0 0 0 5.8-1.8" />
      </>
    ),
    pointer: (
      <>
        <path d="m5 3 3 17 4-5 6 5 3-3-6-5 5-3L5 3Z" />
        <path d="M2 9H0M10 2V0M3 3 1 1" />
      </>
    ),
    shield: (
      <>
        <path d="m12 3 9 4v5c0 5-9 10-9 10S3 17 3 12V7l9-4Z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
  };
  return (
    <svg
      width="25"
      height="25"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

function WindowDots() {
  return (
    <span className="pw-privacy-dots">
      <i />
      <i />
      <i />
    </span>
  );
}

function MiniOverlay({ locale }: { locale: Locale }) {
  return (
    <div className="pw-privacy-overlay" aria-hidden="true">
      <div className="pw-privacy-overlay-head">
        <img src="/passwisely-logo-192.png" width="18" height="18" alt="" />
        <b>PassWisely</b>
        <span>⌘ ↵</span>
      </div>
      <p>
        {locale === "zh"
          ? "先确认边界，再梳理思路。"
          : "Check the edges. Build an approach."}
      </p>
      <div className="pw-privacy-code">
        <span>if</span> not heights:<br />&nbsp;&nbsp;&nbsp;&nbsp;<span>return</span> 0
      </div>
      <div className="pw-privacy-skeleton">
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}

function DockIllustration({ locale }: { locale: Locale }) {
  return (
    <div
      className="pw-privacy-scene pw-privacy-dock-scene"
      aria-hidden="true"
    >
      <span className="pw-privacy-scene-tag">
        {locale === "zh"
          ? "你的 Mac · 浮层工作区"
          : "YOUR MAC · OVERLAY WORKSPACE"}
      </span>
      <div className="pw-privacy-mini-bar">
        <img src="/passwisely-logo-192.png" width="22" height="22" alt="" />
        <span>PassWisely</span>
        <span className="pw-privacy-wave">▂ ▆ █ ▄ ▂</span>
        <kbd>⌘ B</kbd>
      </div>
      <div className="pw-privacy-dock">
        <span className="pw-privacy-app is-files">
          <svg viewBox="0 0 32 32">
            <path d="M16 2v28M8 10v3m15-3v3M8 21q8 7 16-1" />
          </svg>
        </span>
        <span className="pw-privacy-app is-grid">
          <i />
          <i />
          <i />
          <i />
        </span>
        <span className="pw-privacy-app is-web">
          <svg viewBox="0 0 32 32">
            <circle cx="16" cy="16" r="11" />
            <path d="m21 10-3 9-8 3 3-9 8-3Z" />
          </svg>
        </span>
        <span className="pw-privacy-app is-notes">
          <i />
          <i />
          <i />
        </span>
        <span className="pw-privacy-dock-divider" />
        <span className="pw-privacy-app is-folder">
          <svg viewBox="0 0 32 32">
            <path d="M3 8h11l3 4h12v16H3V8Z" />
          </svg>
        </span>
        <span className="pw-privacy-app is-bin">
          <svg viewBox="0 0 32 32">
            <path d="M7 9h18l-2 20H9L7 9ZM5 6h22M12 3h8M13 13v11m6-11v11" />
          </svg>
        </span>
      </div>
      <span className="pw-privacy-dock-caption">
        {locale === "zh"
          ? "浮条在手边，Dock 留给你的工作。"
          : "Within reach. Out of your Dock."}
      </span>
    </div>
  );
}

function HideIllustration({ locale }: { locale: Locale }) {
  const [hidden, setHidden] = useState(false);
  const zh = locale === "zh";
  return (
    <div
      className={`pw-privacy-scene pw-privacy-hide-scene${hidden ? " is-hidden" : ""}`}
    >
      <div className="pw-privacy-work-window" aria-hidden="true">
        <div>
          <WindowDots />
          <span>workspace.py</span>
        </div>
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="pw-privacy-hide-overlay">
        <MiniOverlay locale={locale} />
      </div>
      <div className="pw-privacy-shortcut-control">
        <button
          type="button"
          aria-pressed={hidden}
          onClick={() => setHidden(!hidden)}
          aria-label={
            zh
              ? "演示浮层的显示与隐藏"
              : "Demonstrate showing and hiding the overlay"
          }
        >
          <kbd>⌘ / Ctrl</kbd>
          <kbd>B</kbd>
          <span>
            {hidden
              ? zh
                ? "显示浮层"
                : "Show overlay"
              : zh
                ? "试试隐藏"
                : "Try hiding"}
          </span>
        </button>
        <span aria-live="polite">
          {hidden
            ? zh
              ? "浮层已隐藏 · 会话保留"
              : "Overlay hidden · Session kept"
            : zh
              ? "浮层显示中"
              : "Overlay visible"}
        </span>
      </div>
    </div>
  );
}

function ClickThroughIllustration({ locale }: { locale: Locale }) {
  const inputId = useId();
  const zh = locale === "zh";
  return (
    <div className="pw-privacy-scene pw-privacy-click-scene">
      <div className="pw-privacy-editor">
        <div className="pw-privacy-editor-head">
          <WindowDots />
          <span>{zh ? "你的工作区" : "Your workspace"}</span>
        </div>
        <div className="pw-privacy-editor-content">
          <p>{zh ? "试着选中这段文字" : "Try selecting this text"}</p>
          <p>
            {zh
              ? "空数组返回 0，继续检查边界。"
              : "Return 0 for an empty array."}
          </p>
          <label htmlFor={inputId}>
            {zh ? "透过浮层，直接输入" : "Type through the overlay"}
          </label>
          <input
            id={inputId}
            type="text"
            maxLength={80}
            placeholder={zh ? "在这里输入…" : "Type here…"}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </div>
      <div className="pw-privacy-click-overlay">
        <MiniOverlay locale={locale} />
      </div>
      <span className="pw-privacy-click-cursor" aria-hidden="true">
        <PrivacyGlyph name="pointer" />
      </span>
    </div>
  );
}

function SharingIllustration({ locale }: { locale: Locale }) {
  const [split, setSplit] = useState(52);
  const rangeId = useId();
  const zh = locale === "zh";
  const label = zh
    ? "拖动对比本机与共享画面"
    : "Drag to compare your screen and the shared view";
  return (
    <div className="pw-privacy-share-demo">
      <div
        className="pw-privacy-scene pw-privacy-share-scene"
        style={{ "--privacy-split": `${split}%` } as CSSProperties}
      >
        <div className="pw-privacy-meeting" aria-hidden="true">
          <div className="pw-privacy-meeting-head">
            <WindowDots />
            <span>{zh ? "屏幕共享 · 合成练习" : "SCREEN SHARE · PRACTICE"}</span>
            <i />
          </div>
          <div className="pw-privacy-meeting-body">
            <div className="pw-privacy-person">
              <span>Y</span>
              <i />
              <b>{zh ? "练习会话" : "Practice session"}</b>
            </div>
            <div className="pw-privacy-meeting-code">
              <span>QUESTION / 01</span>
              <b>{zh ? "接雨水" : "Trapping rain water"}</b>
              <p>height = [4, 2, 0, 3, 2, 5]</p>
              <i />
              <i />
              <i />
              <i />
            </div>
          </div>
          <div className="pw-privacy-meeting-footer">
            <span>01:24</span>
            <span>{zh ? "正在共享工作区" : "Sharing workspace"}</span>
            <i />
          </div>
        </div>
        <div className="pw-privacy-local-layer" aria-hidden="true">
          <MiniOverlay locale={locale} />
        </div>
        <div className="pw-privacy-compare-labels" aria-hidden="true">
          <span>{zh ? "本机画面" : "YOUR SCREEN"}</span>
          <span>{zh ? "共享画面" : "SHARED VIEW"}</span>
        </div>
        <div className="pw-privacy-compare-divider" aria-hidden="true">
          <span>‹ ›</span>
        </div>
        <input
          id={rangeId}
          className="pw-privacy-range"
          type="range"
          min="0"
          max="100"
          step="1"
          value={split}
          onChange={(event) => setSplit(Number(event.target.value))}
          aria-label={label}
          aria-valuetext={
            zh
              ? `本机画面占 ${split}%，共享画面占 ${100 - split}%`
              : `Your screen ${split} percent, shared view ${100 - split} percent`
          }
        />
      </div>
      <label className="pw-privacy-range-label" htmlFor={rangeId}>
        <span>↔</span>
        {label}
      </label>
    </div>
  );
}

export function LandingPrivacy({ locale }: { locale: Locale }) {
  const zh = locale === "zh";
  const cards = [
    {
      key: "dock",
      icon: "dock" as const,
      title: zh ? "不占用你的 Dock" : "Invisible on your Dock",
      body: zh
        ? "进入浮层工作区后，Mac Dock 不显示应用图标。PassWisely 仍在手边，让桌面留给正在进行的工作。"
        : "Enter the overlay workspace without an app icon in your Mac’s Dock. PassWisely stays within reach, while your desktop stays focused.",
      visual: <DockIllustration locale={locale} />,
    },
    {
      key: "hide",
      icon: "eye" as const,
      title: zh ? "一键隐藏，随时唤回" : "Out of sight. One shortcut.",
      body: zh
        ? "按下 ⌘ / Ctrl + B，显示或隐藏整个浮层。问题、转录和回答留在当前会话，随时回来继续。"
        : "Press ⌘ / Ctrl + B to hide or restore the entire overlay. Keep your questions, transcripts, and answers in the same session.",
      visual: <HideIllustration locale={locale} />,
    },
    {
      key: "click",
      icon: "pointer" as const,
      title: zh ? "正文可穿透，操作不断档" : "Click through. Stay in flow.",
      body: zh
        ? "透过 Mac 半透明正文选取文字、输入内容。浮条、设置和复制按钮依然可点击，操作下方窗口更顺手。"
        : "Select text and type through the translucent body on Mac. Toolbar, settings, and copy controls stay interactive while you work underneath.",
      visual: <ClickThroughIllustration locale={locale} />,
    },
    {
      key: "share",
      icon: "shield" as const,
      title: zh ? "共享画面，保护浮层内容" : "Your overlay. Off the shared view.",
      body: zh
        ? "通过系统窗口内容保护，在兼容的共享方式中排除浮层。Mac 飞书整屏共享已完成双设备验证。"
        : "System window content protection excludes the overlay from compatible sharing methods. Tested with a two-device, full-screen Feishu share on Mac.",
      visual: <SharingIllustration locale={locale} />,
    },
  ];
  return (
    <section
      className="pw-privacy pw-shell"
      id="privacy"
      aria-labelledby="pw-privacy-title"
    >
      <header className="pw-privacy-heading">
        <p className="pw-eyebrow">
          <span />
          {zh ? "隐身背后的原理" : "HOW IT WORKS"}
        </p>
        <h2 id="pw-privacy-title">
          {zh ? "如何做到隐身？" : "How we're undetectable"}
        </h2>
      </header>
      <div className="pw-privacy-grid">
        {cards.map((card) => (
          <article className="pw-privacy-card" key={card.key}>
            <div className="pw-privacy-card-visual">{card.visual}</div>
            <div className="pw-privacy-card-copy">
              <span className="pw-privacy-icon">
                <PrivacyGlyph name={card.icon} />
              </span>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
            </div>
          </article>
        ))}
      </div>
      <p className="pw-privacy-note">
        {zh
          ? "以上为交互原理示意。保护效果取决于操作系统、共享软件和录制方式；不代表后台进程对系统工具不可见。"
          : "Interactive illustrations of the workflow. Protection varies by OS, sharing app, and recording method; background processes remain visible to system tools."}{" "}
        <a href="#compatibility">
          {zh ? "查看已验证的共享范围" : "See sharing test coverage"}
          <span aria-hidden="true"> ↗</span>
        </a>
      </p>
    </section>
  );
}
