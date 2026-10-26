"use client";

/* Downloads are navigation to file redirects, never Next.js prefetch targets. */
/* Small, local brand assets do not need a remote image optimizer. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import { LandingDemo } from "./LandingDemo";
import { LandingPrivacy } from "./LandingPrivacy";
import { DEMO_VIDEO } from "./demo-video";
import { DOWNLOAD_ARTIFACTS, type DownloadPlatform } from "../lib/downloads";
import { detectDownloadPlatform, type DownloadPlatformDetection } from "../lib/download-platform";
import {
  CREDIT_PACKS,
  TRIAL_CREDITS,
  type CreditPackId,
} from "../lib/payments/catalog";
import "./landing.css";

type Locale = "zh" | "en";
type IconName =
  | "arrow"
  | "download"
  | "capture"
  | "code"
  | "layers"
  | "keyboard"
  | "check"
  | "plus"
  | "menu"
  | "close"
  | "windows"
  | "apple"
  | "spark";

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    arrow: (
      <>
        <path d="M5 12h14M13 6l6 6-6 6" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12m-5-5 5 5 5-5M5 16v4h14v-4" />
      </>
    ),
    capture: (
      <>
        <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />
        <rect x="7" y="7" width="10" height="10" rx="2" />
      </>
    ),
    code: (
      <>
        <path d="m7 6-6 6 6 6m10-12 6 6-6 6M14 3l-4 18" />
      </>
    ),
    layers: (
      <>
        <path d="m12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5" />
      </>
    ),
    keyboard: (
      <>
        <rect x="2" y="5" width="20" height="14" rx="3" />
        <path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 15h10" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    plus: <path d="M12 5v14M5 12h14" />,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    windows: (
      <path
        fill="currentColor"
        stroke="none"
        d="M2 4.5 10.5 3.3v8H2zm10-1.4L22 1.7v9.6h-9.5zM2 13h8.5v8L2 19.8zm10.5 0H22v9.3l-9.5-1.4z"
      />
    ),
    apple: (
      <path
        fill="currentColor"
        stroke="none"
        d="M16.7 1.2c.2 1.5-.5 3-1.4 3.9-.9.9-2.1 1.5-3.4 1.4-.2-1.4.5-2.8 1.3-3.7.9-.9 2.4-1.6 3.5-1.6ZM20 17.4c-.5 1.2-.8 1.7-1.4 2.7-.9 1.4-2.1 3.1-3.6 3.1-1.3 0-1.6-.9-3.4-.9s-2.1.9-3.4.9c-1.5.1-2.6-1.5-3.5-2.9-2.5-3.6-2.8-8-1.3-10.3 1.1-1.7 2.8-2.7 4.5-2.7 1.4 0 2.3.9 3.5.9 1.2 0 2-.9 3.5-.9 1.5 0 3.1.9 4.1 2.2-3.6 2-3 6.8 1 7.9Z"
      />
    ),
    spark: (
      <path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3L12 3Z" />
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

function Brand() {
  return (
    <a className="pw-brand" href="#top" aria-label="PassWisely">
      <img src="/passwisely-logo-192.png" width="36" height="36" alt="" />
      <span>PassWisely</span>
    </a>
  );
}

function downloadNames(locale: Locale): Record<DownloadPlatform, string> {
  return {
    "windows-x64": "Windows x64",
    "mac-arm64": locale === "zh" ? "Mac Apple 芯片" : "Mac Apple silicon",
    "mac-x64": "Mac Intel",
  };
}

export function Downloads({
  locale,
  detection = null,
  compact = false,
  showNotice = true,
}: {
  locale: Locale;
  detection?: DownloadPlatformDetection | null;
  compact?: boolean;
  showNotice?: boolean;
}) {
  const zh = locale === "zh";
  const recommended = detection?.recommendedPlatform;
  const names = downloadNames(locale);
  const platforms: DownloadPlatform[] = ["mac-arm64", "mac-x64", "windows-x64"];
  let guidance = zh ? "选择你的系统与 Mac 芯片版本" : "Choose your system and Mac chip";
  if (detection?.os === "macos") {
    guidance = recommended === "mac-arm64"
      ? (zh ? "已识别 Apple 芯片 Mac，已标出推荐版本。" : "Apple silicon Mac detected. Your recommended version is marked.")
      : recommended === "mac-x64"
        ? (zh ? "已识别 Intel Mac，已标出兼容版本。" : "Intel Mac detected. Your compatible version is marked.")
        : (zh ? "浏览器未提供芯片信息，请手动选择。可在  → 关于本机查看“芯片”或“处理器”。" : "Your browser did not provide chip information. Choose a version below; check Chip or Processor in  → About This Mac.");
  } else if (recommended === "windows-x64") {
    guidance = zh ? "已识别 Windows，已标出推荐版本。" : "Windows detected. Your recommended version is marked.";
  }
  if (recommended && !DOWNLOAD_ARTIFACTS[recommended].available) {
    guidance = zh
      ? `${names[recommended]} 安装包准备中，暂时无法下载。`
      : `The ${names[recommended]} installer is being prepared and is not available yet.`;
  }
  return (
    <div className={`pw-downloads${compact ? " pw-downloads-compact" : ""}`}>
      <p className="pw-download-detection" role={compact ? undefined : "status"}>{guidance}</p>
      {platforms.map((platform) => {
        const artifact = DOWNLOAD_ARTIFACTS[platform];
        const preferred = artifact.available && platform === recommended;
        return (
          <a
            key={platform}
            className="pw-download"
            data-platform={platform}
            data-recommended={preferred}
            href={artifact.available ? `/api/track-download/${platform}` : undefined}
            aria-disabled={!artifact.available}
          >
            <span className="pw-platform"><Icon name={platform === "windows-x64" ? "windows" : "apple"} size={18} /></span>
            <span className="pw-download-label">
              <span>{names[platform]} · v{artifact.version}{artifact.available ? "" : zh ? " · 准备中" : " · Pending"}</span>
              {(artifact.legacy || artifact.liveAudio === "not_included") && (
                <small>{artifact.liveAudio === "not_included"
                  ? artifact.legacy
                    ? (zh ? "旧版（不含实时音频）" : "Legacy (no live audio)")
                    : (zh ? "不含实时音频" : "No live audio")
                  : (zh ? "旧版" : "Legacy")}</small>
              )}
            </span>
            {preferred && <span className="pw-download-badge">{zh ? "推荐" : "Recommended"}</span>}
            <Icon name="arrow" size={17} />
          </a>
        );
      })}
      {showNotice && platforms.map((platform) => {
        const notice = DOWNLOAD_ARTIFACTS[platform].notice;
        return notice ? <p key={platform} className="pw-download-notice">{notice[locale]}</p> : null;
      })}
    </div>
  );
}

const examples = {
  zh: [
    {
      label: "算法解题",
      tag: "CODING",
      question: "接雨水：计算柱子之间能接多少水",
      prompt:
        "给定 n 个非负整数表示每根柱子的高度（宽度为 1），计算下雨之后最多能接多少雨水。",
      input: "height = [4, 2, 0, 3, 2, 5]",
      result: "9",
      heading: "双指针，从较矮的一侧向中间收敛",
      explanation:
        "每一列的水位由左右两侧最高柱子中较矮的一方决定。左右指针相向移动，每次处理较矮的一侧，并累加当前最高值与柱高之差。",
      complexity: "时间 O(n) · 空间 O(1)",
      code: "class Solution:\n    def trap(self, h):\n        l, r = 0, len(h) - 1\n        lmax = rmax = water = 0\n        while l < r:\n            if h[l] < h[r]:\n                lmax = max(lmax, h[l])\n                water += lmax - h[l]\n                l += 1\n            else:\n                rmax = max(rmax, h[r])\n                water += rmax - h[r]\n                r -= 1\n        return water",
      other: "其他解法：预处理左右最高值数组，或使用单调栈按层计算，时间 O(n)，空间 O(n)。",
    },
    {
      label: "系统设计",
      tag: "SYSTEM DESIGN",
      question: "设计一个实时消息系统",
      prompt:
        "支持一对一聊天、离线消息、已读回执。先明确规模与一致性需求，再设计可扩展的架构。",
      input: "核心需求：低延迟、可重试、消息有序",
      result: "连接层 → 路由层 → 消息存储",
      heading: "先拆分职责，再讨论关键权衡",
      explanation:
        "WebSocket 维持长连接，按会话分区保证局部顺序；消息持久化后确认，以消息 ID 做幂等去重。",
      complexity: "关注：吞吐量 · 持久性 · 故障恢复",
      code: "Client → WebSocket Gateway\n              ↓\n         Message Router\n              ↓\n       Partitioned Queue\n              ↓\n        Message Storage\n              ↓\n       Delivery + Receipt",
      other:
        "关键权衡：跨区延迟与一致性；离线补拉与实时推送；热点会话的分区策略。",
    },
    {
      label: "代码调试",
      tag: "DEBUGGING",
      question: "为什么二分查找会陷入死循环？",
      prompt:
        "当 left 和 right 相邻时，mid 可能等于 left。若直接令 left = mid，区间将无法缩小。",
      input: "nums = [1, 3], target = 3",
      result: "返回下标 1",
      heading: "每次迭代都要严格缩小搜索区间",
      explanation:
        "使用闭区间 [left, right]，命中时返回；否则排除已经检查过的 mid，更新为 mid + 1 或 mid − 1。",
      complexity: "时间 O(log n) · 空间 O(1)",
      code: "def search(nums, target):\n    left, right = 0, len(nums) - 1\n    while left <= right:\n        mid = (left + right) // 2\n        if nums[mid] == target:\n            return mid\n        if nums[mid] < target:\n            left = mid + 1\n        else:\n            right = mid - 1\n    return -1",
      other: "边界检查：空数组、单个元素、目标不存在，以及首尾元素。",
    },
    {
      label: "简历准备",
      tag: "CAREER",
      question: "把项目经历讲得更有说服力",
      prompt:
        "结合简历与目标职位描述，梳理你的职责、技术选择与项目结果，形成可以展开的面试故事。",
      input: "输入：项目经历 + 目标职位 JD",
      result: "匹配分析 · 经历改写 · 追问准备",
      heading: "让每段经历都有清晰的证据",
      explanation:
        "用背景、任务、行动和结果组织叙述。突出自己的贡献，只使用真实可核实的数据和成果。",
      complexity: "组织方式：STAR · 技术决策 · 项目复盘",
      code: "01  背景 / Situation\n    项目解决了什么实际问题？\n02  任务 / Task\n    你负责的目标是什么？\n03  行动 / Action\n    你做了哪些技术选择？\n04  结果 / Result\n    有哪些可核实的改进？",
      other: "进一步准备：方案取舍、遇到的难点、失败的尝试，以及下一步改进。",
    },
  ],
  en: [
    {
      label: "Coding",
      tag: "CODING",
      question: "Trapping Rain Water",
      prompt:
        "Given n non-negative integers representing bar heights (each of width 1), compute how much water can be trapped after it rains.",
      input: "height = [4, 2, 0, 3, 2, 5]",
      result: "9",
      heading: "Two pointers. Move in from the shorter side.",
      explanation:
        "Water above each bar is limited by the shorter of the tallest bars on either side. Move the pointer on the shorter side and add the gap between its running maximum and the bar height.",
      complexity: "Time O(n) · Space O(1)",
      code: "class Solution:\n    def trap(self, h):\n        l, r = 0, len(h) - 1\n        lmax = rmax = water = 0\n        while l < r:\n            if h[l] < h[r]:\n                lmax = max(lmax, h[l])\n                water += lmax - h[l]\n                l += 1\n            else:\n                rmax = max(rmax, h[r])\n                water += rmax - h[r]\n                r -= 1\n        return water",
      other:
        "Alternatives: precompute left and right maxima, or use a monotonic stack, both in O(n) time and O(n) space.",
    },
    {
      label: "System design",
      tag: "SYSTEM DESIGN",
      question: "Design a real-time messaging system",
      prompt:
        "Support direct messages, offline delivery, and read receipts. Clarify scale and consistency before choosing an architecture.",
      input: "Requirements: low latency, retries, ordering",
      result: "Connections → Routing → Storage",
      heading: "Separate responsibilities. Explain the trade-offs.",
      explanation:
        "Use WebSockets for connections and partition by conversation for local ordering. Persist before acknowledging; deduplicate by message ID.",
      complexity: "Focus: throughput · durability · recovery",
      code: "Client → WebSocket Gateway\n              ↓\n         Message Router\n              ↓\n       Partitioned Queue\n              ↓\n        Message Storage\n              ↓\n       Delivery + Receipt",
      other:
        "Trade-offs: regional latency and consistency, offline sync and live delivery, hot partition handling.",
    },
    {
      label: "Debugging",
      tag: "DEBUGGING",
      question: "Why does this binary search loop forever?",
      prompt:
        "When left and right are adjacent, mid may equal left. Assigning left = mid can leave the search interval unchanged.",
      input: "nums = [1, 3], target = 3",
      result: "Return index 1",
      heading: "Shrink the search interval on every iteration.",
      explanation:
        "Use a closed interval [left, right]. Return on a match; otherwise exclude mid by moving to mid + 1 or mid − 1.",
      complexity: "Time O(log n) · Space O(1)",
      code: "def search(nums, target):\n    left, right = 0, len(nums) - 1\n    while left <= right:\n        mid = (left + right) // 2\n        if nums[mid] == target:\n            return mid\n        if nums[mid] < target:\n            left = mid + 1\n        else:\n            right = mid - 1\n    return -1",
      other:
        "Check empty and single-element arrays, missing targets, and both endpoints.",
    },
    {
      label: "Resume prep",
      tag: "CAREER",
      question: "Tell a more convincing project story",
      prompt:
        "Connect your resume to the job description. Organize your responsibilities, decisions, and outcomes into a story you can explain.",
      input: "Input: project experience + job description",
      result: "Role fit · Resume edits · Follow-up prep",
      heading: "Give every claim a clear piece of evidence.",
      explanation:
        "Use situation, task, action, and result. Highlight your own contribution and only include genuine, verifiable outcomes.",
      complexity: "Structure: STAR · decisions · reflection",
      code: "01  Situation\n    What problem did the project solve?\n02  Task\n    What were you responsible for?\n03  Action\n    Which technical decisions did you make?\n04  Result\n    What improvement can you verify?",
      other:
        "Go deeper: trade-offs, difficult problems, failed attempts, and what you would improve next.",
    },
  ],
};

function ProductPreview({
  locale,
  example = 0,
}: {
  locale: Locale;
  example?: number;
}) {
  const content = examples[locale][example];
  return (
    <div className="pw-product">
      <div className="pw-product-chrome">
        <span className="pw-window-dots">
          <i />
          <i />
          <i />
        </span>
        <span>
          <img src="/passwisely-logo-192.png" alt="" width="18" height="18" />
          PassWisely
        </span>
        <span className="pw-product-model">
          <i />
          Kimi <span>/</span> Qwen
        </span>
      </div>
      <div className="pw-workspace">
        <div className="pw-question">
          <span className="pw-mono">{content.tag}</span>
          <h3>{content.question}</h3>
          <p>{content.prompt}</p>
          <div className="pw-example">
            <span>{locale === "zh" ? "输入" : "INPUT"}</span>
            <code>{content.input}</code>
            <span>{locale === "zh" ? "输出" : "OUTPUT"}</span>
            <code>{content.result}</code>
          </div>
          <div className="pw-captured">
            <Icon name="capture" size={16} />
            {locale === "zh" ? "问题已就绪" : "Question ready"}
            <Icon name="check" size={15} />
          </div>
        </div>
        <div className="pw-solution">
          <div className="pw-solution-label">
            <Icon name="spark" size={15} />
            <span>{locale === "zh" ? "解题思路" : "APPROACH"}</span>
            <span className="pw-demo-badge">
              {locale === "zh" ? "功能示例" : "EXAMPLE"}
            </span>
          </div>
          <h4>{content.heading}</h4>
          <p>{content.explanation}</p>
          <div className="pw-complexity">{content.complexity}</div>
          <div className="pw-code-header">
            <span>{example === 0 || example === 2 ? "Python" : "Notes"}</span>
            <Icon name="code" size={14} />
          </div>
          <pre>
            <code>
              {content.code.split("\n").map((line, index) => (
                <span className="pw-code-line" key={index}>
                  <span className="pw-line-number" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span>{line || " "}</span>
                </span>
              ))}
            </code>
          </pre>
          <p className="pw-alternative">{content.other}</p>
        </div>
      </div>
      <div className="pw-product-bottom">
        <span>
          <i />
          {locale === "zh"
            ? "思路 · 复杂度 · 代码 · 其他解法"
            : "Approach · Complexity · Code · Alternatives"}
        </span>
        <span>
          {locale === "zh"
            ? "界面演示，非实时生成"
            : "Illustrative preview, not a live response"}
        </span>
      </div>
    </div>
  );
}

function FeatureVisual({ index, locale }: { index: number; locale: Locale }) {
  const zh = locale === "zh";
  return (
    <div className={`pw-feature-visual pw-visual-${index}`} aria-hidden="true">
      {index === 0 && (
        <>
          <div className="pw-capture-page">
            <span>01 / RAIN WATER</span>
            <b>{zh ? "接雨水" : "Trapping Rain Water"}</b>
            <div className="pw-faux-line" />
            <div className="pw-faux-line short" />
            <code>height = [4, 2, 0, 3, 2, 5]</code>
            <div className="pw-selection">
              <i />
              <i />
              <i />
              <i />
              <span>
                <Icon name="capture" size={15} />
                {zh ? "已捕获题目" : "Question captured"}
              </span>
            </div>
          </div>
          <span className="pw-visual-caption">
            <Icon name="check" size={14} />
            {zh ? "保留题目与代码上下文" : "Keep the question in context"}
          </span>
        </>
      )}
      {index === 1 && (
        <div className="pw-stream-card">
          <span>
            <Icon name="spark" size={16} />
            {zh ? "正在生成回答" : "Generating your answer"}
            <i />
          </span>
          <b>
            {zh ? "双指针，从较矮的一侧收敛。" : "Two pointers, from the shorter side."}
          </b>
          <div className="pw-stream-line">
            <span />
          </div>
          <div className="pw-stream-line short">
            <span />
          </div>
          <code>
            water += lmax - h[l]
            <br />
            l += 1
            <i className="pw-cursor" />
          </code>
          <small>
            {zh
              ? "思路先到，答案逐步展开"
              : "Start reading while the answer unfolds"}
          </small>
        </div>
      )}
      {index === 2 && (
        <div className="pw-context-visual">
          <div>
            <span>01</span>
            <Icon name="capture" />
            {zh ? "题目截图" : "Question"}
            <Icon name="check" size={15} />
          </div>
          <div>
            <span>02</span>
            <Icon name="code" />
            {zh ? "补充代码" : "Your code"}
            <Icon name="check" size={15} />
          </div>
          <div>
            <span>03</span>
            <Icon name="layers" />
            {zh ? "继续追问" : "Follow-up"}
            <Icon name="plus" size={15} />
          </div>
          <small>
            {zh ? "一个工作流，衔接每一步" : "One connected workflow"}
          </small>
        </div>
      )}
      {index === 3 && (
        <div className="pw-shortcuts">
          <div>
            <span>{zh ? "捕获问题" : "Capture"}</span>
            <span>
              <kbd>⌘</kbd>
              <kbd>H</kbd>
            </span>
          </div>
          <div>
            <span>{zh ? "生成解答" : "Solve"}</span>
            <span>
              <kbd>⌘</kbd>
              <kbd>↵</kbd>
            </span>
          </div>
          <div>
            <span>{zh ? "显示 / 隐藏" : "Show / hide"}</span>
            <span>
              <kbd>⌘</kbd>
              <kbd>B</kbd>
            </span>
          </div>
          <small>
            {zh
              ? "macOS 示例 · Windows 使用 Ctrl"
              : "macOS shown · Ctrl on Windows"}
          </small>
        </div>
      )}
    </div>
  );
}

interface LandingProps {
  locale: Locale;
  onLocale: (locale: Locale) => void;
  accountLabel: string;
  onAccount: () => void;
  onBuy: (id: CreditPackId) => void;
  onRegisterTrial: () => void;
  busy: boolean;
}

type Support = "yes" | "partial" | "no";

const comparisonRows: Readonly<
  { zh: string; en: string; values: readonly [Support, Support, Support] }[]
> = [
  {
    zh: "同时转录系统音频与麦克风",
    en: "Transcribe system audio and microphone together",
    values: ["yes", "no", "no"],
  },
  {
    zh: "截图题目、代码或报错后直接提问",
    en: "Ask about a screenshot of a question, code, or error",
    values: ["yes", "partial", "no"],
  },
  {
    zh: "转录、截图与追问合并为同一上下文",
    en: "Keep transcript, screenshots, and follow-ups in one context",
    values: ["yes", "partial", "no"],
  },
  {
    zh: "流式展示思路、复杂度与代码",
    en: "Stream the approach, complexity, and code",
    values: ["yes", "yes", "no"],
  },
  {
    zh: "桌面浮层与快捷键，无需切换窗口",
    en: "Desktop overlay and shortcuts, no window switching",
    values: ["yes", "no", "no"],
  },
];

function SupportMark({ value, locale }: { value: Support; locale: Locale }) {
  const label =
    value === "yes"
      ? locale === "zh" ? "支持" : "Yes"
      : value === "partial"
        ? locale === "zh" ? "部分 / 需手动" : "Partly / manual"
        : locale === "zh" ? "不支持" : "No";
  return (
    <span className={`pw-mark is-${value}`} title={label}>
      {value === "yes" ? (
        <Icon name="check" size={15} />
      ) : value === "partial" ? (
        <i aria-hidden="true">~</i>
      ) : (
        <i aria-hidden="true">—</i>
      )}
      <span className="pw-sr">{label}</span>
    </span>
  );
}

function ComparisonSection({ locale }: { locale: Locale }) {
  const zh = locale === "zh";
  const tr = (cn: string, en: string) => (zh ? cn : en);
  const columns = [
    "PassWisely",
    tr("通用 AI 聊天", "General AI chat"),
    tr("手动整理", "Manual notes"),
  ];
  return (
    <section
      className="pw-section pw-shell pw-compare"
      id="compare"
      aria-labelledby="pw-compare-title"
    >
      <div className="pw-section-heading">
        <p className="pw-eyebrow">{tr("为什么是桌面工作台", "WHY A DESKTOP WORKSPACE")}</p>
        <h2 id="pw-compare-title">
          {tr("少一次复制粘贴，\n多一分专注。", "Less copy and paste.\nMore focus.")}
        </h2>
        <p>
          {tr(
            "把听到的、看到的和想问的放在一起，而不是在多个窗口之间来回搬运。",
            "Bring what you hear, see, and want to ask into one place instead of moving it between windows.",
          )}
        </p>
      </div>
      <div className="pw-compare-table" role="table" aria-label={tr("功能对比", "Feature comparison")}>
        <div className="pw-compare-row is-head" role="row">
          <span role="columnheader">{tr("能力", "Capability")}</span>
          {columns.map((name, index) => (
            <span role="columnheader" key={name} className={index === 0 ? "is-ours" : undefined}>
              {name}
            </span>
          ))}
        </div>
        {comparisonRows.map((row) => (
          <div className="pw-compare-row" role="row" key={row.en}>
            <span role="rowheader">{zh ? row.zh : row.en}</span>
            {row.values.map((value, index) => (
              <span role="cell" key={index} className={index === 0 ? "is-ours" : undefined}>
                <SupportMark value={value} locale={locale} />
              </span>
            ))}
          </div>
        ))}
      </div>
      <p className="pw-compare-note">
        {tr(
          "“通用 AI 聊天”指网页或 App 形式的对话助手，具体能力因产品而异。",
          "“General AI chat” refers to browser or app chat assistants; capabilities vary by product.",
        )}
      </p>
    </section>
  );
}

function DemoVideoSection({ locale }: { locale: Locale }) {
  if (!DEMO_VIDEO.src) return null;
  const zh = locale === "zh";
  return (
    <section className="pw-section pw-shell pw-video" id="demo" aria-labelledby="pw-video-title">
      <div className="pw-section-heading">
        <p className="pw-eyebrow">{zh ? "产品演示" : "SEE IT IN ACTION"}</p>
        <h2 id="pw-video-title">
          {zh ? "两分钟，看完整个工作流。" : "The whole workflow, in minutes."}
        </h2>
        <p>
          {zh
            ? "从开始聆听、截图提问，到流式解答和连续追问。"
            : "From listening and capturing a question to streamed answers and follow-ups."}
        </p>
      </div>
      <div className="pw-video-frame">
        <video
          src={DEMO_VIDEO.src}
          poster={DEMO_VIDEO.poster ?? undefined}
          controls
          playsInline
          preload="metadata"
        />
      </div>
      {DEMO_VIDEO.durationLabel && (
        <p className="pw-compare-note">{DEMO_VIDEO.durationLabel}</p>
      )}
    </section>
  );
}

export function PricingPlans({
  locale,
  onBuy,
  onRegisterTrial,
  busy,
}: Pick<LandingProps, "locale" | "onBuy" | "onRegisterTrial" | "busy">) {
  const zh = locale === "zh";
  const tr = (cn: string, en: string) => (zh ? cn : en);
  const plans: Array<{
    id: CreditPackId | null;
    name: string;
    amountFen: number;
    credits: number;
    validityDays: number | null;
  }> = [
    {
      id: null,
      name: tr("新用户体验", "New user trial"),
      amountFen: 0,
      credits: TRIAL_CREDITS,
      validityDays: null,
    },
    ...Object.entries(CREDIT_PACKS).map(([id, pack]) => ({
      id: id as CreditPackId,
      name: zh ? pack.name : pack.nameEn,
      amountFen: pack.amountFen,
      credits: pack.credits,
      validityDays: pack.validityDays,
    })),
  ];
  return (
    <div className="pw-pricing-grid">
      {plans.map((plan, index) => (
        <article
          className={`pw-price-card${index === 1 ? " pw-featured" : ""}`}
          key={plan.id || "trial"}
        >
          {index === 1 && (
            <span className="pw-recommended">
              {tr("推荐套餐", "RECOMMENDED")}
            </span>
          )}
          <div className="pw-plan-name">
            <h3>{plan.name}</h3>
            <Icon
              name={index === 0 ? "spark" : index === 1 ? "layers" : "code"}
            />
          </div>
          <p>
            {plan.id
              ? tr("手动续购，自由安排", "Renew manually, on your schedule")
              : tr(
                  "新账户一次赠送，无需支付",
                  "One welcome grant, no payment needed",
                )}
          </p>
          <div className="pw-price">
            <span>¥</span>
            <strong>{plan.amountFen / 100}</strong>
            <span>{plan.id ? tr("/月", "/month") : "CNY"}</span>
          </div>
          <div className="pw-credit-amount">
            {plan.credits.toLocaleString(zh ? "zh-CN" : "en-US")}
            <span>{tr("积分", "credits")}</span>
          </div>
          <button
            className="pw-buy"
            disabled={busy}
            onClick={() => (plan.id ? onBuy(plan.id) : onRegisterTrial())}
          >
            {plan.id
              ? tr("购买月包", "Buy monthly pack")
              : tr("免费注册体验", "Create free account")}
            <Icon name="arrow" size={17} />
          </button>
          <ul>
            {(plan.id
              ? [
                  tr("手动续购，无自动续费", "Manual renewal, no auto-renewal"),
                  tr(
                    `到账后 ${plan.validityDays} 天到期`,
                    `Expires ${plan.validityDays} days after credits arrive`,
                  ),
                  tr(
                    "每次独立起算，不延长旧包",
                    "Each purchase has its own expiry",
                  ),
                  tr(
                    `每包 ${plan.credits.toLocaleString("en-US")} 积分`,
                    `${plan.credits.toLocaleString("en-US")} credits per pack`,
                  ),
                ]
              : [
                  tr("新用户专享，一次领取", "New accounts, one welcome grant"),
                  tr("体验积分长期有效", "Trial credits do not expire"),
                  tr("无需绑定支付方式", "No payment method required"),
                  tr("支持截图、解题与追问", "Capture, solve, and follow up"),
                ]
            ).map((item) => (
              <li key={item}>
                <Icon name="check" size={15} />
                {item}
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}

export function LandingPage({
  locale,
  onLocale,
  accountLabel,
  onAccount,
  onBuy,
  onRegisterTrial,
  busy,
}: LandingProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scenario, setScenario] = useState(0);
  const [downloadDetection, setDownloadDetection] = useState<DownloadPlatformDetection | null>(null);
  const downloadDetectionRequest = useRef<Promise<DownloadPlatformDetection> | null>(null);
  useEffect(() => {
    let active = true;
    const request = downloadDetectionRequest.current ??= detectDownloadPlatform(navigator);
    void request.then((result) => {
      if (active) setDownloadDetection(result);
    }).catch(() => { /* Keep every explicit download available if a browser API fails. */ });
    return () => { active = false; };
  }, []);
  const zh = locale === "zh";
  const tr = (cn: string, en: string) => (zh ? cn : en);
  const nav = [
    ["features", tr("功能", "Features")],
    ["how", tr("使用方式", "How it works")],
    ["compare", tr("对比", "Compare")],
    ["pricing", tr("定价", "Pricing")],
    ["faq", tr("帮助", "Help")],
  ];
  const features: [IconName, string, string][] = [
    [
      "capture",
      tr("把屏幕里的问题带进来", "Bring the question into focus"),
      tr(
        "快捷截图题目、代码与报错。补充一句说明，和正在进行的对话一起交给 AI。",
        "Capture a question, code, or an error. Add a note and bring it together with the conversation.",
      ),
    ],
    [
      "spark",
      tr("从第一段思路，读到完整解答", "Follow the reasoning as it unfolds"),
      tr(
        "流式展示解题思路、复杂度和代码。继续追问边界条件，逐步理解每一个选择。",
        "Read the approach, complexity, and code as they arrive. Explore edge cases and understand the decisions.",
      ),
    ],
    [
      "layers",
      tr("让下一句，接得上上一句", "Keep the conversation connected"),
      tr(
        "转录、截图、手输问题组合为上下文。无需反复搬运材料，让追问留在同一条思路里。",
        "Combine transcripts, screenshots, and typed questions. Follow up without rebuilding the context each time.",
      ),
    ],
    [
      "keyboard",
      tr("常用操作，不打断你的节奏", "A workspace that stays within reach"),
      tr(
        "截图、解答、显示与隐藏都可用快捷键完成。Mac 半透明正文支持鼠标穿透，方便操作下方内容。",
        "Use shortcuts to capture, answer, show, or hide. On Mac, click through the translucent answer area to work underneath.",
      ),
    ],
  ];
  const buildNames = downloadNames(locale);
  const supportedBuilds = (["mac-arm64", "mac-x64", "windows-x64"] as const).map((platform) => {
    const artifact = DOWNLOAD_ARTIFACTS[platform];
    const details = [`${buildNames[platform]} v${artifact.version}`];
    if (artifact.legacy) details.push(tr("旧版", "legacy"));
    if (artifact.liveAudio === "not_included") details.push(tr("不含实时音频", "no live audio"));
    if (!artifact.available) details.push(tr("安装包准备中", "installer pending"));
    return details.join(" · ");
  }).join(zh ? "；" : "; ");
  const faqs = [
    [
      tr("怎样开始使用？", "How do I get started?"),
      tr(
        `下载适合电脑的安装包，安装后注册或登录。新账户可获得 ${TRIAL_CREDITS} 个体验积分，通过截图、文字或实时对话开始使用。`,
        `Download the build for your computer, install it, and create an account. New accounts receive ${TRIAL_CREDITS} trial credits. Start with a screenshot, a typed question, or a live conversation.`,
      ),
    ],
    [
      tr("支持中文实时转录吗？", "Does live transcription support Chinese?"),
      tr(
        "支持中英文实时转录，区分系统音频与麦克风来源，可暂停和恢复。首次使用需要授予相应录音权限；识别效果会受到麦克风、噪声和口音影响。",
        "Live transcription supports Chinese and English, identifies system audio and microphone sources, and can be paused and resumed. Grant the required recording permissions on first use. Results depend on your microphone, background noise, and accent.",
      ),
    ],
    [
      tr("支持哪些电脑和模型？", "Which computers and models are supported?"),
      tr(
        `${supportedBuilds}。支持实时音频的版本需要 macOS 14.2+ 或 Windows 10 1803+。支持 Kimi、Qwen 等模型，可用模型以当前配置为准。`,
        `${supportedBuilds}. Builds with live audio require macOS 14.2+ or Windows 10 1803+. Models include Kimi and Qwen; availability follows current configuration.`,
      ),
    ],
    [
      tr(
        "月包会自动续费吗？积分何时到期？",
        "Do packs auto-renew? When do credits expire?",
      ),
      tr(
        "月包手动续购，无自动续费。每次新购积分自成功到账起独立有效 30 天，续购不会延长此前积分的有效期。旧余额和新用户体验积分长期有效；不同模型和任务消耗以客户端与账户明细为准。",
        "Renew manually with no automatic charges. Each paid pack expires 30 days after its credits are added; a new purchase does not extend earlier packs. Existing permanent balances and trial credits do not expire. Usage varies by model and task; check the app and account activity.",
      ),
    ],
    [
      tr(
        "共享屏幕时，浮层是否可见？",
        "Will the overlay appear in a screen share?",
      ),
      tr(
        "Mac 版已在飞书双设备整屏共享中验证：接收端看不到 PassWisely 浮条和正文，底层页面与时钟正常。此结果仅代表该次环境；其他平台、系统版本和共享模式需要分别验证，不承诺对所有检测方式不可见。",
        "In a two-device Feishu full-screen sharing test on Mac, the receiving device did not display the PassWisely toolbar or body while the underlying page and clock remained visible. This result applies to that test environment. Other platforms, OS versions, and sharing modes need separate verification; it is not a guarantee against every form of detection.",
      ),
    ],
    [
      tr("如何查看使用量和余额？", "Where can I check usage and balance?"),
      tr(
        "登录后进入 Dashboard，可查看积分余额、有效期与使用记录，并按时间范围查看使用量。积分消耗以服务端账户明细为准。",
        "Sign in to your Dashboard to see your credit balance, expiry, and usage history, with time-range filters. Your server-side account activity is the source of truth for credit charges.",
      ),
    ],
    [
      tr("提交的内容会怎样处理？", "How is submitted content processed?"),
      tr(
        "主动提交的题目、截图及上下文会发送给所选 AI 服务；实时音频会交由配置的转录服务处理。请只提供有权分享的内容，并自行验证模型输出。适用于练习、模拟面试与获准使用辅助工具的场景。",
        "Submitted questions, screenshots, and context go to the selected AI service. Live audio is processed by the configured transcription service. Share only material you are authorized to provide and verify model output. Use it for practice, mock interviews, and situations where assistance is permitted.",
      ),
    ],
  ];
  const checks = [
    [
      tr("实时音频与中文转录", "Live audio and Chinese transcription"),
      tr(
        "系统音频 · 麦克风 · 暂停 / 恢复",
        "System audio · Microphone · Pause / resume",
      ),
      tr("Mac 已验证", "Verified on Mac"),
    ],
    [
      tr("组合上下文问答", "Questions with combined context"),
      tr("转录 + 截图 + 手输问题", "Transcript + Screenshot + Typed question"),
      tr("Mac 已验证", "Verified on Mac"),
    ],
    [
      tr("半透明浮层鼠标穿透", "Click-through translucent overlay"),
      tr(
        "底层选字与输入，控件仍可点击",
        "Select and type underneath; controls stay clickable",
      ),
      tr("Mac 已验证", "Verified on Mac"),
    ],
    [
      tr("账户使用量统计", "Account usage reporting"),
      tr("余额 · 有效期 · 使用明细", "Balance · Expiry · Activity"),
      tr("网页已提供", "Available on web"),
    ],
  ];
  return (
    <div className="pw-landing" data-locale={locale}>
      <a className="pw-skip" href="#main-content">
        {tr("跳到主要内容", "Skip to content")}
      </a>
      <header className="pw-header">
        <nav
          className="pw-nav pw-shell"
          aria-label={tr("主导航", "Main navigation")}
        >
          <Brand />
          <div className="pw-nav-links">
            {nav.map(([id, title]) => (
              <a key={id} href={`#${id}`}>
                {title}
              </a>
            ))}
          </div>
          <div className="pw-nav-actions">
            <div
              className="pw-language"
              aria-label={tr("选择语言", "Language")}
            >
              <button aria-pressed={zh} onClick={() => onLocale("zh")}>
                中
              </button>
              <span>/</span>
              <button aria-pressed={!zh} onClick={() => onLocale("en")}>
                EN
              </button>
            </div>
            <button className="pw-login" onClick={onAccount}>
              {accountLabel}
            </button>
            <a className="pw-nav-download" href="#download">
              <span>
                <Icon name="download" size={15} />
              </span>
              {tr("免费下载", "Download free")}
            </a>
            <button
              className="pw-menu-toggle"
              aria-label={
                menuOpen
                  ? tr("关闭菜单", "Close menu")
                  : tr("打开菜单", "Open menu")
              }
              aria-expanded={menuOpen}
              aria-controls="pw-mobile-menu"
              onClick={() => setMenuOpen(!menuOpen)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setMenuOpen(false);
              }}
            >
              <Icon name={menuOpen ? "close" : "menu"} />
            </button>
          </div>
          {menuOpen && (
            <div
              id="pw-mobile-menu"
              className="pw-mobile-menu"
              onKeyDown={(event) => {
                if (event.key === "Escape") setMenuOpen(false);
              }}
            >
              {nav.map(([id, title]) => (
                <a key={id} href={`#${id}`} onClick={() => setMenuOpen(false)}>
                  {title}
                  <Icon name="arrow" size={16} />
                </a>
              ))}
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onAccount();
                }}
              >
                {accountLabel}
                <Icon name="arrow" size={16} />
              </button>
              <a href="#download" onClick={() => setMenuOpen(false)}>
                {tr("下载应用", "Download app")}
                <Icon name="download" size={16} />
              </a>
            </div>
          )}
        </nav>
      </header>
      <main id="main-content">
        <section className="pw-hero" aria-labelledby="pw-hero-title">
          <div className="pw-shell">
            <div className="pw-hero-copy">
              <a href="#how" className="pw-pill">
                <span />
                {tr(
                  "PASSWISELY · 你的桌面 AI 面试助手",
                  "PASSWISELY · YOUR DESKTOP INTERVIEW WORKSPACE",
                )}
                <Icon name="arrow" size={13} />
              </a>
              <h1 id="pw-hero-title" className="pw-hero-title">
                {tr("每一场面试，都机灵地通过", "Pass Every Interview Wisely.")}
              </h1>
              <p>
                {tr(
                  "隐身 AI，助力你拿下offer。",
                  "The Undetectable AI That Gets You Hired.",
                )}
              </p>
              <Downloads locale={locale} detection={downloadDetection} showNotice={false} />
              <div className="pw-free-note">
                <Icon name="check" size={13} />
                {tr(
                  `免费注册 · ${TRIAL_CREDITS} 积分体验 · 无需信用卡`,
                  `${TRIAL_CREDITS} WELCOME CREDITS · NO CREDIT CARD REQUIRED`,
                )}
              </div>
            </div>
            <div className="pw-hero-stage">
              <LandingDemo locale={locale} compact />
            </div>
            <div className="pw-capabilities">
              <span>
                {tr("围绕真实的准备流程", "BUILT AROUND YOUR PREPARATION")}
              </span>
              <div>
                {[
                  tr("实时转录", "Live transcription"),
                  tr("截图解答", "Screenshot answers"),
                  tr("连续追问", "Follow-up questions"),
                  tr("使用量统计", "Usage dashboard"),
                ].map((label) => (
                  <span key={label}>
                    <Icon name="check" size={14} />
                    {label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        <LandingPrivacy locale={locale} />

        <DemoVideoSection locale={locale} />

        <section className="pw-section pw-shell" id="how">
          <div className="pw-section-heading">
            <p className="pw-eyebrow">{tr("从输入，到思路", "THE WORKFLOW")}</p>
            <h2>
              {tr("让每个问题，都有上下文。", "Every question has a context.")}
            </h2>
            <p>
              {tr(
                "听、看、问、答，连接成一个桌面工作流。",
                "Listen, capture, ask, and explore. All in one desktop workflow.",
              )}
            </p>
          </div>
          <div className="pw-audio-feature">
            <div className="pw-audio-copy">
              <span className="pw-feature-number">01 / LIVE CONVERSATION</span>
              <h3>
                {tr(
                  "对话在继续，\n思路也跟得上。",
                  "The conversation moves.\nYour context comes with it.",
                )}
              </h3>
              <p>
                {tr(
                  "同时采集系统音频与麦克风，将中英文对话转成实时文本。区分说话来源，保留临时与最终文本，随时暂停和恢复。",
                  "Capture system audio and your microphone, with live Chinese and English transcription. Distinguish sources, follow interim and final text, and pause or resume when you need.",
                )}
              </p>
              <a className="pw-text-link" href="#scenarios">
                {tr("探索回答示例", "Explore an example")}
                <Icon name="arrow" size={16} />
              </a>
            </div>
            <div
              className="pw-audio-sample"
              aria-label={tr("合成转录示例", "Illustrative transcript")}
            >
              <div className="pw-audio-sample-top">
                <span>
                  <i />
                  {tr("正在聆听", "Listening")}
                </span>
                <span>00:24</span>
              </div>
              <div className="pw-waveform" aria-hidden="true">
                {Array.from({ length: 42 }, (_, i) => (
                  <i key={i} style={{ height: `${12 + ((i * 17) % 31)}px` }} />
                ))}
              </div>
              <div className="pw-transcript-line">
                <span>{tr("系统音频", "System audio")}</span>
                <p>
                  {tr(
                    "如果输入是空数组，我们应该返回什么？",
                    "What should we return when the input is empty?",
                  )}
                </p>
              </div>
              <div className="pw-transcript-line is-mic">
                <span>{tr("麦克风", "Microphone")}</span>
                <p>
                  {tr(
                    "先确认边界，再说明时间复杂度。",
                    "Check the boundary case, then explain the complexity.",
                  )}
                </p>
              </div>
              <small>
                {tr(
                  "合成界面示例 · 非实时录音",
                  "Illustrative UI · Not a live recording",
                )}
              </small>
            </div>
          </div>
          <div className="pw-features" id="features">
            {features.map(([icon, title, description], index) => (
              <article className="pw-feature" key={icon}>
                <FeatureVisual index={index} locale={locale} />
                <div className="pw-feature-copy">
                  <span className="pw-feature-number">0{index + 2}</span>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <ComparisonSection locale={locale} />

        <section className="pw-proof-section">
          <div className="pw-shell pw-proof-layout">
            <div className="pw-proof-heading">
              <p className="pw-eyebrow">
                {tr("功能与验证", "CAPABILITIES & VALIDATION")}
              </p>
              <h2>
                {tr(
                  "看得见的能力，\n说得清的边界。",
                  "Useful capabilities.\nClear boundaries.",
                )}
              </h2>
              <p>
                {tr(
                  "从实际工作流出发，把已验证的体验与仍待验证的环境分别说明。",
                  "Start with the workflow. Know what has been verified and where more testing is needed.",
                )}
              </p>
              <a className="pw-text-link" href="#compatibility">
                {tr("查看共享测试范围", "See sharing test coverage")}
                <Icon name="arrow" size={16} />
              </a>
            </div>
            <div className="pw-check-list">
              {checks.map(([title, description, status], index) => (
                <article key={title}>
                  <span className="pw-check-number">0{index + 1}</span>
                  <div>
                    <h3>{title}</h3>
                    <p>{description}</p>
                  </div>
                  <span className="pw-check-status">
                    <Icon name="check" size={14} />
                    {status}
                  </span>
                </article>
              ))}
              <p className="pw-validation-note">
                {tr(
                  "Windows 安装包已提供；实时音频与浮层行为仍待 Windows 真机验证。",
                  "A Windows installer is available. Live audio and overlay behavior still require validation on a Windows device.",
                )}
              </p>
            </div>
          </div>
        </section>

        <section className="pw-section pw-shell pw-scenarios" id="scenarios">
          <div className="pw-section-heading">
            <p className="pw-eyebrow">
              {tr("看看它如何组织答案", "EXPLORE THE WORKSPACE")}
            </p>
            <h2>
              {tr(
                "一个工作台，不止一种思路。",
                "One workspace. More ways to prepare.",
              )}
            </h2>
            <p>
              {tr(
                "切换场景，查看完整的思路、代码与下一步追问。",
                "Choose a scenario. Explore the reasoning, code, and next question.",
              )}
            </p>
          </div>
          <div
            className="pw-scenario-tabs"
            role="group"
            aria-label={tr("选择演示场景", "Choose a demo scenario")}
          >
            {examples[locale].map((example, index) => (
              <button
                key={example.tag}
                aria-pressed={index === scenario}
                onClick={() => setScenario(index)}
              >
                {example.label}
                <Icon name="arrow" size={15} />
              </button>
            ))}
          </div>
          <div aria-live="polite" aria-atomic="true">
            <ProductPreview locale={locale} example={scenario} />
          </div>
        </section>

        <section className="pw-pricing-section" id="pricing">
          <div className="pw-shell">
            <div className="pw-section-heading">
              <p className="pw-eyebrow">
                {tr("按需准备，自由选择", "PREPARE AT YOUR PACE")}
              </p>
              <h2>
                {tr("先开始，再选你的节奏。", "Start free. Find your pace.")}
              </h2>
              <p>
                {tr(
                  `免费下载，新用户注册赠送 ${TRIAL_CREDITS} 积分。月包按需手动续购，无自动续费。`,
                  `Download for free and start with ${TRIAL_CREDITS} welcome credits. Renew a monthly pack manually whenever you need it.`,
                )}
              </p>
            </div>
            <PricingPlans
              locale={locale}
              onBuy={onBuy}
              onRegisterTrial={onRegisterTrial}
              busy={busy}
            />
            <p className="pw-pricing-note">
              {tr(
                "新购月包每次独立有效 30 天；旧余额长期有效。“无限制包”为套餐名称，每包提供 1,000 积分，并非无限额度。支付渠道以结算页实际可用状态为准。",
                "Each paid pack has its own 30-day validity; existing permanent balances do not expire. Unlimited is the plan name: each pack contains 1,000 credits, not unlimited usage. Available payment methods are shown at checkout.",
              )}
            </p>
          </div>
        </section>

        <section
          className="pw-section pw-shell pw-compatibility"
          id="compatibility"
        >
          <div className="pw-section-heading">
            <p className="pw-eyebrow">
              {tr("共享与浮层", "SHARING & OVERLAYS")}
            </p>
            <h2>
              {tr("兼容性，用实测说明。", "Compatibility, with test context.")}
            </h2>
            <p>
              {tr(
                "平台、系统和共享方式不同，结果也可能不同。",
                "Results can vary with the platform, OS, and sharing mode.",
              )}
            </p>
          </div>
          <div className="pw-compat-list">
            {[
              [
                "Feishu / 飞书",
                true,
                tr(
                  "Mac 双设备整屏共享实测，接收端未显示浮条与正文，底层页面及动态时钟正常。这一结果不覆盖所有系统版本、录屏工具或检测方式。",
                  "Verified in a two-device full-screen share on Mac: the receiving device did not show the toolbar or body, while the underlying page and animated clock remained visible. This does not cover all OS versions, recording tools, or detection methods.",
                ),
              ],
              [
                "Zoom / Google Meet",
                false,
                tr(
                  "尚未完成同等条件的接收端测试。请在自己的测试会议中核对整屏共享和窗口共享结果。",
                  "Equivalent receiving-device tests have not been completed. Check full-screen and window sharing in a test meeting.",
                ),
              ],
              [
                "Microsoft Teams / Webex",
                false,
                tr(
                  "尚未验证。共享客户端和 macOS 更新可能改变捕获行为，使用前应重新测试。",
                  "Not yet verified. Updates to sharing clients and macOS can change capture behavior; test again before use.",
                ),
              ],
            ].map(([name, verified, description], index) => (
              <details key={String(name)} open={index === 0}>
                <summary>
                  <span className="pw-check-number">00{index + 1}</span>
                  <span className="pw-platform-name">{name}</span>
                  <span
                    className={`pw-platform-status${verified ? " is-verified" : ""}`}
                  >
                    {verified
                      ? tr("已实测", "Tested")
                      : tr("待实测", "Not tested")}
                  </span>
                  <Icon name="plus" size={20} />
                </summary>
                <p>{description}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="pw-section pw-shell pw-faq-section" id="faq">
          <div className="pw-faq-heading">
            <p className="pw-eyebrow">
              {tr("你可能还想了解", "BEFORE YOU START")}
            </p>
            <h2>{tr("常见问题", "Questions, answered.")}</h2>
            <p>
              {tr("还有疑问？欢迎联系我们。", "Need a hand? Get in touch.")}
            </p>
            <a href="mailto:support@passwisely.com">
              support@passwisely.com
              <Icon name="arrow" size={16} />
            </a>
          </div>
          <div className="pw-faq-list">
            {faqs.map(([question, answer]) => (
              <details key={question}>
                <summary>
                  {question}
                  <Icon name="plus" size={19} />
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="pw-final" id="download">
          <div className="pw-shell">
            <span className="pw-final-icon">
              <Icon name="spark" size={28} />
            </span>
            <h2>
              {tr("下一轮，", "Your next round.")}
              <br />
              <span>
                {tr("带着思路出发。", "Bring a clearer perspective.")}
              </span>
            </h2>
            <p>
              {tr(
                "准备好你的问题，剩下的从这里开始。",
                "Bring your questions. Build your next answer.",
              )}
            </p>
            <Downloads locale={locale} detection={downloadDetection} compact />
            <details className="pw-release-checksums">
              <summary>{tr("安装包 SHA-256", "Installer SHA-256")}</summary>
              {Object.values(DOWNLOAD_ARTIFACTS)
                .filter((artifact) => artifact.sha256)
                .map((artifact) => (
                  <p key={artifact.platform}>
                    <span>
                      {artifact.platform} · v{artifact.version}:{" "}
                    </span>
                    <code>{artifact.sha256}</code>
                  </p>
                ))}
            </details>
            <div className="pw-final-meta">
              <span>
                {tr(
                  `注册即送 ${TRIAL_CREDITS} 积分`,
                  `${TRIAL_CREDITS} free welcome credits`,
                )}
              </span>
              <span>macOS · Windows</span>
            </div>
          </div>
        </section>
      </main>
      <footer className="pw-footer">
        <div className="pw-shell">
          <div className="pw-footer-top">
            <div>
              <Brand />
              <p>
                {tr(
                  "让每一次认真准备，都更进一步。",
                  "A clearer way to prepare for what’s next.",
                )}
              </p>
            </div>
            <div className="pw-footer-links">
              <div>
                <span>{tr("产品", "PRODUCT")}</span>
                <a href="#features">{tr("功能介绍", "Features")}</a>
                <a href="#pricing">{tr("积分套餐", "Pricing")}</a>
                <a href="#download">{tr("下载应用", "Download")}</a>
              </div>
              <div>
                <span>{tr("了解更多", "RESOURCES")}</span>
                <a href="#how">{tr("快速开始", "Getting started")}</a>
                <a href="#scenarios">{tr("场景示例", "Examples")}</a>
                <a href="#faq">{tr("常见问题", "FAQ")}</a>
              </div>
              <div>
                <span>{tr("账户与支持", "ACCOUNT & SUPPORT")}</span>
                <button onClick={onAccount}>{accountLabel}</button>
                <a href="mailto:support@passwisely.com">
                  {tr("联系支持", "Contact support")}
                </a>
              </div>
            </div>
          </div>
          <div className="pw-footer-bottom">
            <span>© {new Date().getFullYear()} PassWisely</span>
            <span>
              {tr(
                "福建智感灵眸科技有限公司",
                "Fujian Zhigan Lingmou Technology Co., Ltd.",
              )}
            </span>
            <span>
              {tr(
                "请遵守面试与考试规则。",
                "Follow your interview and assessment rules.",
              )}
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
