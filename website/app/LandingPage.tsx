"use client";

/* Downloads are navigation to file redirects, never Next.js prefetch targets. */
/* eslint-disable @next/next/no-html-link-for-pages */

import { useState } from "react";
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

function Downloads({
  locale,
  compact = false,
}: {
  locale: Locale;
  compact?: boolean;
}) {
  return (
    <div className={`pw-downloads${compact ? " pw-downloads-compact" : ""}`}>
      <a className="pw-download" href="/api/track-download/windows-x64">
        <span className="pw-platform">
          <Icon name="windows" size={18} />
        </span>
        <span>{locale === "zh" ? "下载 Windows 版" : "Get for Windows"}</span>
        <Icon name="arrow" size={17} />
      </a>
      <a className="pw-download" href="/api/track-download/mac-arm64">
        <span className="pw-platform">
          <Icon name="apple" size={19} />
        </span>
        <span>{locale === "zh" ? "下载 Mac 版" : "Get for Mac"}</span>
        <Icon name="arrow" size={17} />
      </a>
    </div>
  );
}

const examples = {
  zh: [
    {
      label: "算法解题",
      tag: "CODING",
      question: "找到数组中和为目标值的两个数",
      prompt:
        "给定整数数组 nums 和目标值 target，返回和为 target 的两个元素下标。每个元素只能使用一次。",
      input: "nums = [2, 7, 11, 15], target = 9",
      result: "[0, 1]",
      heading: "一次遍历，哈希表记录已见元素",
      explanation:
        "遍历数组，查找 target − 当前值是否已出现。找到即返回两个下标，否则记录当前元素。",
      complexity: "时间 O(n) · 空间 O(n)",
      code: "class Solution:\n    def twoSum(self, nums, target):\n        seen = {}\n        for i, num in enumerate(nums):\n            if target - num in seen:\n                return [seen[target - num], i]\n            seen[num] = i\n        return []",
      other: "其他解法：排序后使用双指针，时间 O(n log n)，需保留原始下标。",
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
      question: "Find two numbers that add up to a target",
      prompt:
        "Given an integer array nums and a target, return the indices of two elements whose sum is target. Use each element at most once.",
      input: "nums = [2, 7, 11, 15], target = 9",
      result: "[0, 1]",
      heading: "One pass. A hash map for seen values.",
      explanation:
        "Look for target minus the current value in the map. Return both indices when found; otherwise store the current value.",
      complexity: "Time O(n) · Space O(n)",
      code: "class Solution:\n    def twoSum(self, nums, target):\n        seen = {}\n        for i, num in enumerate(nums):\n            if target - num in seen:\n                return [seen[target - num], i]\n            seen[num] = i\n        return []",
      other:
        "Alternative: sort and use two pointers in O(n log n), keeping the original indices.",
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
  hero = false,
}: {
  locale: Locale;
  example?: number;
  hero?: boolean;
}) {
  const content = examples[locale][example];
  return (
    <div className={`pw-product${hero ? " pw-product-hero" : ""}`}>
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
          {!hero && <p className="pw-alternative">{content.other}</p>}
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
            <span>01 / TWO SUM</span>
            <b>{zh ? "两数之和" : "Two Sum"}</b>
            <div className="pw-faux-line" />
            <div className="pw-faux-line short" />
            <code>nums = [2, 7, 11, 15]</code>
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
            {zh ? "用哈希表，一次遍历完成查找。" : "A hash map. A single pass."}
          </b>
          <div className="pw-stream-line">
            <span />
          </div>
          <div className="pw-stream-line short">
            <span />
          </div>
          <code>
            if target - num in seen:
            <br />
            &nbsp; return [seen[target - num], i]
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
  onBuy: (id: "starter" | "pro" | "max") => void;
  busy: boolean;
}

export function LandingPage({
  locale,
  onLocale,
  accountLabel,
  onAccount,
  onBuy,
  busy,
}: LandingProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scenario, setScenario] = useState(0);
  const zh = locale === "zh";
  const tr = (cn: string, en: string) => (zh ? cn : en);
  const nav = [
    ["features", tr("产品功能", "Features")],
    ["how", tr("使用方式", "How it works")],
    ["pricing", tr("积分套餐", "Pricing")],
    ["faq", tr("常见问题", "FAQ")],
  ];
  const features: [IconName, string, string][] = [
    [
      "capture",
      tr("一张截图，进入解题状态", "A screenshot is all it takes"),
      tr(
        "捕获题目、代码或报错信息，减少复制粘贴，让注意力留在问题本身。",
        "Capture a question, code, or an error. Spend less time copying and more time understanding the problem.",
      ),
    ],
    [
      "spark",
      tr("答案流式出现，思路先行", "Read the answer as it arrives"),
      tr(
        "从第一段思路开始阅读。解题思路、复杂度、完整代码和其他解法，逐步清晰呈现。",
        "Start with the first explanation. Follow the approach, complexity, complete code, and alternative solutions as they unfold.",
      ),
    ],
    [
      "layers",
      tr("多轮上下文，连续思考", "Keep the whole problem in view"),
      tr(
        "补充截图、调试代码、继续追问，在同一个桌面工作流里逐步深入。",
        "Add screenshots, debug your code, and ask follow-up questions in one connected desktop workflow.",
      ),
    ],
    [
      "keyboard",
      tr("快捷键，让操作更轻盈", "Stay in flow with shortcuts"),
      tr(
        "截图、解答、切换窗口，常用操作触手可及。支持 macOS 与 Windows。",
        "Capture, solve, and control your window with keyboard shortcuts. Available on macOS and Windows.",
      ),
    ],
  ];
  const faqs = [
    [
      tr("如何开始使用 PassWisely？", "How do I get started?"),
      tr(
        "下载适合电脑的安装包，安装后注册或登录。新账户可获得 10 个体验积分，随后即可通过截图或文字输入开始练习。",
        "Download the build for your computer, install it, and create an account. New accounts receive 10 trial credits. Start with a screenshot or a typed question.",
      ),
    ],
    [
      tr("支持哪些电脑和模型？", "Which computers and models are supported?"),
      tr(
        "提供 macOS Apple 芯片、macOS Intel 芯片和 Windows x64 版本。支持 Kimi、Qwen 等模型；可用模型以客户端和服务端当前配置为准。",
        "Builds are available for Apple silicon Macs, Intel Macs, and Windows x64. Models include Kimi and Qwen; availability follows the current app and service configuration.",
      ),
    ],
    [
      tr("积分如何计费，会过期吗？", "How do credits work? Do they expire?"),
      tr(
        "积分按需购买，目前不会过期。不同模型和任务的消耗可能不同，部分服务按 token 预算计费；请以客户端提示及账户积分明细为准。",
        "Buy credits as needed; they currently do not expire. Usage varies by model and task, and some services use token-based budgets. Check the app and your account history for actual charges.",
      ),
    ],
    [
      tr("Mac 应该下载哪个版本？", "Which Mac version should I download?"),
      tr(
        "在 Mac 左上角的苹果菜单打开“关于本机”。显示 Apple M 系列芯片请选择 Apple 芯片版；显示 Intel 处理器请选择 Intel 版。",
        "Open About This Mac from the Apple menu. Choose the Apple silicon build for an Apple M-series chip, or the Intel build for an Intel processor.",
      ),
    ],
    [
      tr("上传的问题如何处理？", "How are my questions processed?"),
      tr(
        "你主动提交的题目、截图及上下文会发送给所选 AI 服务进行处理。请勿提交无权分享的机密内容，模型输出也需要自行检查与验证。",
        "Questions, screenshots, and context you submit are sent to the selected AI service for processing. Only share material you are authorized to provide, and review and verify model output.",
      ),
    ],
    [
      tr("适合哪些使用场景？", "What can I use it for?"),
      tr(
        "适用于算法练习、模拟面试、系统设计学习、代码调试和简历准备。在面试或考试中使用前，请确认并遵守组织方的规则。",
        "Use PassWisely for coding practice, mock interviews, system design, debugging, and resume preparation. Follow the organizer’s rules for any interview or assessment.",
      ),
    ],
  ];
  return (
    <div className="pw-landing">
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
              <Icon name="arrow" size={15} />
            </button>
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
              <a href="#download" onClick={() => setMenuOpen(false)}>
                {tr("下载应用", "Download app")}
                <Icon name="download" size={16} />
              </a>
            </div>
          )}
        </nav>
      </header>

      <section
        className="pw-hero"
        id="main-content"
        aria-labelledby="pw-hero-title"
      >
        <div className="pw-shell">
          <div className="pw-hero-copy">
            <a href="#features" className="pw-pill">
              <span />
              {tr("你的 AI 技术面试助手", "YOUR AI INTERVIEW COPILOT")}
              <Icon name="arrow" size={13} />
            </a>
            <h1 id="pw-hero-title">
              {tr("让每一道难题，", "Your next technical interview.")}
              <br />
              {tr("都有清晰的思路。", "Meet it with clarity.")}
            </h1>
            <p>
              {tr(
                "截图识题，即时展开解答。把算法、系统设计、代码调试和简历准备，汇集到一个专注的 AI 桌面工作台。",
                "Capture a question. Follow a clear answer. Coding, system design, debugging, and resume prep—together in one focused AI desktop workspace.",
              )}
            </p>
            <Downloads locale={locale} />
            <div className="pw-free-note">
              {tr(
                "无需信用卡 · 注册即送 10 积分",
                "NO CREDIT CARD NEEDED · 10 FREE CREDITS",
              )}
            </div>
            <a className="pw-intel-link" href="/api/track-download/mac-x64">
              {tr(
                "使用 Intel Mac？下载对应版本",
                "On an Intel Mac? Get your version",
              )}
              <Icon name="arrow" size={12} />
            </a>
          </div>
          <div className="pw-hero-stage">
            <div className="pw-stage-label">
              <span>PASSWISELY DESKTOP</span>
              <span>
                {tr("从问题，到清晰的答案", "FROM QUESTION TO CLARITY")}
              </span>
            </div>
            <ProductPreview locale={locale} hero />
          </div>
          <div className="pw-capabilities">
            <span>
              {tr("为你的下一轮面试做好准备", "BUILT FOR YOUR NEXT ROUND")}
            </span>
            <div>
              {[
                tr("算法解题", "Coding"),
                tr("系统设计", "System design"),
                tr("代码调试", "Debugging"),
                tr("简历准备", "Resume prep"),
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

      <section className="pw-section pw-shell" id="features">
        <div className="pw-section-heading">
          <p className="pw-eyebrow">
            {tr("专注问题，少些切换", "LESS FRICTION. MORE FOCUS.")}
          </p>
          <h2>
            {tr("为你的答题节奏而设计", "Built around the way you think")}
          </h2>
          <p>
            {tr(
              "从捕获问题到理解答案，每一步都更顺手。",
              "From capturing the question to understanding the answer, stay in your flow.",
            )}
          </p>
        </div>
        <div className="pw-features">
          {features.map(([icon, title, description], index) => (
            <article className="pw-feature" key={icon}>
              <FeatureVisual index={index} locale={locale} />
              <div className="pw-feature-copy">
                <span className="pw-icon-tile">
                  <Icon name={icon} size={23} />
                </span>
                <h3>{title}</h3>
                <p>{description}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="pw-light-section" id="how">
        <div className="pw-shell">
          <div className="pw-section-heading">
            <p className="pw-eyebrow">
              {tr("简单开始，专注练习", "A SMALL SETUP. A BETTER WORKFLOW.")}
            </p>
            <h2>
              {tr("从安装到解题，只需三步", "Three steps to your next answer")}
            </h2>
            <p>
              {tr(
                "准备好问题，剩下的从这里开始。",
                "Bring a question. Build a clearer way to answer it.",
              )}
            </p>
          </div>
          <div className="pw-steps">
            {[
              [
                "download",
                tr("下载并登录", "Download and sign in"),
                tr(
                  "选择适合电脑的版本，创建账户，领取 10 个体验积分。",
                  "Choose your desktop build. Create an account and get 10 trial credits.",
                ),
              ],
              [
                "capture",
                tr("捕获你的问题", "Capture your question"),
                tr(
                  "快捷键截取题目，或直接输入文字。补充上下文，让问题更完整。",
                  "Take a screenshot or type a question. Add the context that matters.",
                ),
              ],
              [
                "code",
                tr("理解，再讲清楚", "Understand. Then explain."),
                tr(
                  "跟随流式答案梳理思路，运行代码验证结果，再深入追问。",
                  "Follow the streamed explanation, run the code to verify it, and ask deeper questions.",
                ),
              ],
            ].map(([icon, title, description], index) => (
              <article key={title}>
                <div className="pw-step-top">
                  <Icon name={icon as IconName} size={27} />
                  <span>0{index + 1}</span>
                </div>
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
          <a className="pw-text-link" href="#download">
            {tr(
              "下载 PassWisely，开始练习",
              "Get PassWisely and start practicing",
            )}
            <Icon name="arrow" size={18} />
          </a>
        </div>
      </section>

      <section className="pw-section pw-shell pw-scenarios" id="scenarios">
        <div className="pw-section-heading">
          <p className="pw-eyebrow">
            {tr(
              "一个工作台，多种准备方式",
              "ONE WORKSPACE. EVERY KIND OF PREP.",
            )}
          </p>
          <h2>{tr("下一题，无论是什么", "Whatever comes up next")}</h2>
          <p>
            {tr(
              "选择一个场景，看看 PassWisely 如何组织答案。",
              "Choose a scenario to explore how PassWisely structures an answer.",
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
              {tr("按需购买，自由安排", "YOUR PREP. YOUR PACE.")}
            </p>
            <h2>
              {tr("为下一步，选一份准备", "A little credit for your next step")}
            </h2>
            <p>
              {tr(
                "免费下载，注册赠送 10 积分。需要更多时，再按需补充。",
                "Download for free and start with 10 welcome credits. Top up when you need more.",
              )}
            </p>
          </div>
          <div className="pw-pricing-grid">
            {(
              [
                [
                  "starter",
                  tr("轻量包", "Starter"),
                  "9",
                  "100",
                  tr("一次专注的面试准备", "For a focused interview sprint"),
                ],
                [
                  "pro",
                  tr("进阶包", "Pro"),
                  "29",
                  "400",
                  tr("陪你走过完整求职周期", "For a complete job-search cycle"),
                ],
                [
                  "max",
                  tr("冲刺包", "Max"),
                  "59",
                  "1,000",
                  tr("为高频练习留足空间", "Room for regular, deeper practice"),
                ],
              ] as const
            ).map(([id, title, price, credits, description], index) => (
              <article
                className={`pw-price-card${index === 1 ? " pw-featured" : ""}`}
                key={id}
              >
                {index === 1 && (
                  <span className="pw-recommended">
                    {tr("推荐套餐", "RECOMMENDED")}
                  </span>
                )}
                <div className="pw-plan-name">
                  <h3>{title}</h3>
                  <Icon
                    name={
                      index === 0 ? "spark" : index === 1 ? "layers" : "code"
                    }
                  />
                </div>
                <p>{description}</p>
                <div className="pw-price">
                  <span>¥</span>
                  <strong>{price}</strong>
                  <span>CNY</span>
                </div>
                <div className="pw-credit-amount">
                  {credits}
                  <span>{tr("积分", "credits")}</span>
                </div>
                <button
                  className="pw-buy"
                  disabled={busy}
                  onClick={() => onBuy(id)}
                >
                  {tr("购买积分", "Buy credits")}
                  <Icon name="arrow" size={17} />
                </button>
                <ul>
                  {[
                    tr("一次购买，无自动续费", "One purchase, no auto-renewal"),
                    tr("积分目前长期有效", "Credits currently do not expire"),
                    tr("支持截图、解题与追问", "Capture, solve, and follow up"),
                    tr("账户余额与明细可查", "Track your balance and activity"),
                  ].map((item) => (
                    <li key={item}>
                      <Icon name="check" size={15} />
                      {item}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
          <p className="pw-pricing-note">
            {tr(
              "模型与任务的积分消耗可能不同，以客户端提示及账户明细为准。支持支付宝与微信支付。",
              "Credit usage varies by model and task. Check the app and account activity for charges. Alipay and WeChat Pay supported.",
            )}
          </p>
        </div>
      </section>

      <section className="pw-section pw-shell pw-faq-section" id="faq">
        <div className="pw-faq-heading">
          <p className="pw-eyebrow">
            {tr("你可能还想了解", "A FEW MORE THINGS")}
          </p>
          <h2>{tr("常见问题", "Frequently asked questions")}</h2>
          <p>
            {tr(
              "还有疑问？我们随时愿意帮助。",
              "Still have a question? We’re here to help.",
            )}
          </p>
          <a href="mailto:support@passwisely.com">
            {tr("联系支持", "Contact support")}
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
            <Icon name="spark" size={30} />
          </span>
          <h2>
            {tr("把下一题，", "Your next question.")}
            <br />
            {tr("变成你的下一步。", "Your next step forward.")}
          </h2>
          <p>
            {tr(
              "下载 PassWisely，让准备更充分，让表达更从容。",
              "Get PassWisely. Prepare with focus. Explain with confidence.",
            )}
          </p>
          <Downloads locale={locale} compact />
          <div className="pw-final-meta">
            <span>{tr("注册即送 10 积分", "10 free welcome credits")}</span>
            <span>macOS · Windows</span>
            <a href="/api/track-download/mac-x64">
              {tr("Mac Intel 版", "Intel Mac download")}
              <Icon name="arrow" size={12} />
            </a>
          </div>
        </div>
      </section>

      <footer className="pw-footer">
        <div className="pw-shell">
          <div className="pw-footer-top">
            <div>
              <Brand />
              <p>
                {tr(
                  "为每一次认真准备而打造。",
                  "Built for everyone who comes prepared.",
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
                <a href="#faq">{tr("常见问题", "FAQ")}</a>
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
                "为准备与学习而设计，请遵守面试和考试规则。",
                "Designed for preparation and learning. Follow your interview and assessment rules.",
              )}
            </span>
            <a href="mailto:support@passwisely.com">support@passwisely.com</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
