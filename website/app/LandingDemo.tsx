"use client";

/* The original brand asset is intentionally rendered without an image service. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useId, useState } from "react";
import "./landing-demo.css";

type Locale = "zh" | "en";
type DemoIcon =
  | "play"
  | "pause"
  | "previous"
  | "next"
  | "camera"
  | "audio"
  | "mic"
  | "spark"
  | "check";

function DemoGlyph({ name, size = 18 }: { name: DemoIcon; size?: number }) {
  const paths: Record<DemoIcon, React.ReactNode> = {
    play: <path d="m9 5 10 7-10 7V5Z" fill="currentColor" stroke="none" />,
    pause: <path d="M8 5v14M16 5v14" strokeWidth="4" />,
    previous: <path d="m14 6-6 6 6 6" />,
    next: <path d="m10 6 6 6-6 6" />,
    camera: (
      <>
        <rect x="3" y="6" width="18" height="14" rx="3" />
        <path d="m8 6 2-3h4l2 3" />
        <circle cx="12" cy="13" r="3" />
      </>
    ),
    audio: <path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4" />,
    mic: (
      <>
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </>
    ),
    spark: (
      <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" />
    ),
    check: <path d="m5 12 4 4L19 6" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

const HEIGHTS = [4, 2, 0, 3, 2, 5];
const WATER = HEIGHTS.map((height, index) => {
  const left = Math.max(...HEIGHTS.slice(0, index + 1));
  const right = Math.max(...HEIGHTS.slice(index));
  return Math.min(left, right) - height;
});

/* Elevation map for [4, 2, 0, 3, 2, 5]: bars plus trapped water (9 units). */
function ElevationMap({ pointers }: { pointers: boolean }) {
  const cell = 22;
  const rows = 5;
  const width = HEIGHTS.length * cell;
  const height = rows * cell;
  return (
    <svg
      className="pw-demo-map"
      viewBox={`0 0 ${width} ${height + 20}`}
      aria-hidden="true"
    >
      {Array.from({ length: rows + 1 }, (_, row) => (
        <line
          key={`r${row}`}
          x1="0"
          x2={width}
          y1={row * cell}
          y2={row * cell}
          className="pw-demo-map-grid"
        />
      ))}
      {HEIGHTS.map((bar, index) => (
        <g key={index}>
          <rect
            className="pw-demo-map-water"
            x={index * cell + 1}
            y={height - (bar + WATER[index]) * cell}
            width={cell - 2}
            height={WATER[index] * cell}
            style={{ animationDelay: `${index * 90}ms` }}
          />
          <rect
            className="pw-demo-map-bar"
            x={index * cell + 1}
            y={height - bar * cell}
            width={cell - 2}
            height={bar * cell}
            rx="2"
          />
        </g>
      ))}
      {pointers && (
        <g className="pw-demo-map-pointers">
          <text x={cell / 2} y={height + 15}>
            L
          </text>
          <text x={width - cell / 2} y={height + 15}>
            R
          </text>
        </g>
      )}
    </svg>
  );
}

const copy = {
  zh: {
    region: "PassWisely 交互式产品演示",
    window: "编程练习",
    level: "困难",
    question: "接雨水",
    instructions: "给定每根柱子的高度（宽度为 1），计算下雨之后最多能接多少雨水。",
    captured: "已截取题目",
    interviewer: "提问者",
    candidate: "练习者",
    speaking: "正在说话",
    status: ["聆听中", "生成解答", "追问中"],
    tabs: ["转录", "回答"],
    systemAudio: "系统音频",
    microphone: "麦克风",
    transcript: [
      ["提问者", "给一组柱子的高度，下雨之后最多能接多少水？"],
      ["我", "柱子的宽度都是 1，对吗？"],
      ["提问者", "对，宽度都是 1，先说说你的思路。"],
    ],
    context: "已组合上下文",
    contextItems: ["对话转录", "题目截图", "手输追问"],
    kicker: "解题思路",
    responseTitle: "每一列的水位，取决于两侧最高柱子中较矮的一方。",
    responseBody: "左右指针相向移动，每次处理较矮的一侧，累加「当前最高值 − 柱高」。",
    complexity: ["时间 O(n)", "空间 O(1)"],
    followupQuestion: "能把额外空间降到 O(1) 吗？",
    followupTitle: "可以：双指针不需要额外数组。",
    followupBody: "较矮一侧的最高值已经确定了水位上限，边移动边累加即可。",
    tests: "边界检查",
    meNote: "先讲按列计算，再说明空间优化。",
    stages: [
      { title: "捕捉问题", text: "对话转录与题目截图，自动组合成同一个上下文。" },
      { title: "梳理思路", text: "先给出思路，再展开代码与复杂度。" },
      { title: "接住追问", text: "沿着当前对话继续回答，并检查边界情况。" },
    ],
    play: "播放演示",
    pause: "暂停演示",
    previous: "上一步",
    next: "下一步",
    stageLabel: "演示步骤",
    caption: "合成界面演示，非真实会议、实时生成或速度测量。",
    codeLabel: "Python 示例代码",
  },
  en: {
    region: "PassWisely interactive product demo",
    window: "Coding practice",
    level: "Hard",
    question: "Trapping rain water",
    instructions:
      "Given the height of each bar (width 1), compute how much water can be trapped after it rains.",
    captured: "Question captured",
    interviewer: "Interviewer",
    candidate: "You",
    speaking: "Speaking",
    status: ["Listening", "Answering", "Follow-up"],
    tabs: ["Transcript", "Answer"],
    systemAudio: "System audio",
    microphone: "Microphone",
    transcript: [
      ["Interviewer", "Given the bar heights, how much water can be trapped after it rains?"],
      ["Me", "Every bar has a width of 1, right?"],
      ["Interviewer", "Yes, width 1. Walk me through your approach."],
    ],
    context: "Context combined",
    contextItems: ["Transcript", "Screenshot", "Typed follow-up"],
    kicker: "Approach",
    responseTitle: "Each column fills to the shorter of its two tallest walls.",
    responseBody:
      "Move two pointers inward, always from the shorter side, and add running max − height.",
    complexity: ["Time O(n)", "Space O(1)"],
    followupQuestion: "Can you reduce the extra space to O(1)?",
    followupTitle: "Yes. Two pointers need no extra arrays.",
    followupBody:
      "The shorter side's running maximum already caps the water level, so add as you move.",
    tests: "Edge cases",
    meNote: "Start per column, then explain the space optimization.",
    stages: [
      { title: "Capture the question", text: "Transcript and screenshot become one context." },
      { title: "Build an approach", text: "Reasoning first, then code and complexity." },
      { title: "Handle the follow-up", text: "Continue the conversation and check the edges." },
    ],
    play: "Play demo",
    pause: "Pause demo",
    previous: "Previous step",
    next: "Next step",
    stageLabel: "Demo steps",
    caption:
      "Illustrative interface. Not a real meeting, live generation, or a speed measurement.",
    codeLabel: "Example Python code",
  },
};

const answerCode = [
  "def trap(h):",
  "    l, r = 0, len(h) - 1",
  "    lmax = rmax = water = 0",
  "    while l < r:",
  "        if h[l] < h[r]:",
  "            lmax = max(lmax, h[l])",
  "            water += lmax - h[l]",
  "            l += 1",
  "        else:",
  "            rmax = max(rmax, h[r])",
  "            water += rmax - h[r]",
  "            r -= 1",
  "    return water",
];

const starterCode = [
  "class Solution:",
  "    def trap(self, height: list[int]) -> int:",
  "        ",
];

const testCases = [
  ["trap([4, 2, 0, 3, 2, 5])", "9"],
  ["trap([2, 0, 2])", "2"],
  ["trap([])", "0"],
];

export function LandingDemo({
  locale,
  compact = false,
}: {
  locale: Locale;
  compact?: boolean;
}) {
  const t = copy[locale];
  const [stage, setStage] = useState(0);
  const [playing, setPlaying] = useState(false);
  const captionId = useId();
  const stageCount = t.stages.length;

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setStage((current) => (current + 1) % stageCount);
    }, 6000);
    return () => window.clearInterval(timer);
  }, [playing, stageCount]);

  function goTo(next: number) {
    setPlaying(false);
    setStage((next + stageCount) % stageCount);
  }

  const speaker = stage === 1 ? 1 : 0;

  return (
    <figure
      className={`pw-demo${compact ? " pw-demo-compact" : ""}${playing ? " pw-demo-playing" : ""}`}
      data-stage={stage}
      aria-label={t.region}
      aria-describedby={captionId}
    >
      <div className="pw-demo-window">
        <div className="pw-demo-titlebar">
          <span className="pw-demo-traffic" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="pw-demo-title">{t.window}</span>
          <span className="pw-demo-timer" aria-hidden="true">
            <i />
            24:18
          </span>
        </div>

        <div className="pw-demo-body">
          <section className="pw-demo-ide" aria-hidden="true">
            <div className="pw-demo-problem">
              <div className="pw-demo-problemhead">
                <span>42</span>
                <h3>{t.question}</h3>
                <em>{t.level}</em>
              </div>
              <p>{t.instructions}</p>
              <div className="pw-demo-figure">
                <ElevationMap pointers={stage === 1} />
                <code>
                  height = [4, 2, 0, 3, 2, 5]
                  <b>→ 9</b>
                </code>
              </div>
              {stage === 0 && (
                <span className="pw-demo-capture">
                  <i />
                  <i />
                  <i />
                  <i />
                  <b>
                    <DemoGlyph name="camera" size={12} />
                    {t.captured}
                  </b>
                </span>
              )}
            </div>

            <div className="pw-demo-editor">
              <div className="pw-demo-editortab">solution.py</div>
              <pre>
                {starterCode.map((line, index) => (
                  <span key={index}>
                    <i>{index + 1}</i>
                    {line}
                    {index === starterCode.length - 1 && (
                      <b className="pw-demo-caret" />
                    )}
                  </span>
                ))}
              </pre>
            </div>

            <div className="pw-demo-call">
              {[t.interviewer, t.candidate].map((name, index) => (
                <div
                  key={name}
                  className={`pw-demo-tile${index === speaker ? " is-speaking" : ""}`}
                >
                  <span className="pw-demo-initial">
                    {name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="pw-demo-tilename">{name}</span>
                  <span className="pw-demo-level">
                    <i />
                    <i />
                    <i />
                  </span>
                </div>
              ))}
            </div>
          </section>

          <aside className="pw-demo-overlay">
            <div className="pw-demo-bar" aria-hidden="true">
              <img src="/passwisely-logo-192.png" width="22" height="22" alt="" />
              <span className="pw-demo-status">
                <i />
                {t.status[stage]}
              </span>
              <span className="pw-demo-baricons">
                <DemoGlyph name="camera" size={15} />
                <DemoGlyph name="spark" size={15} />
                <kbd>⌘ ↵</kbd>
              </span>
            </div>
            <div className="pw-demo-tabs" aria-hidden="true">
              <span className={stage === 0 ? "is-active" : ""}>{t.tabs[0]}</span>
              <span className={stage === 0 ? "" : "is-active"}>{t.tabs[1]}</span>
            </div>

            <div
              className="pw-demo-panel"
              key={stage}
              aria-live={playing ? "off" : "polite"}
              aria-atomic="true"
            >
              {stage === 0 && (
                <div className="pw-demo-feed">
                  {t.transcript.map(([who, text], index) => (
                    <div
                      key={index}
                      className={`pw-demo-line${index === 1 ? " is-me" : ""}${index === 2 ? " is-live" : ""}`}
                      style={{ animationDelay: `${index * 260}ms` }}
                    >
                      <span className="pw-demo-who">
                        <DemoGlyph name={index === 1 ? "mic" : "audio"} size={12} />
                        {who}
                        <small>{index === 1 ? t.microphone : t.systemAudio}</small>
                      </span>
                      <p>
                        {text}
                        {index === 2 && (
                          <span className="pw-demo-wave">
                            {Array.from({ length: 7 }, (_, bar) => (
                              <i key={bar} style={{ animationDelay: `${bar * 90}ms` }} />
                            ))}
                          </span>
                        )}
                      </p>
                    </div>
                  ))}
                  <div className="pw-demo-context">
                    <span>{t.context}</span>
                    <div>
                      {t.contextItems.map((item, index) => (
                        <b key={item} className={index < 2 ? "is-on" : ""}>
                          <DemoGlyph
                            name={index === 0 ? "audio" : index === 1 ? "camera" : "spark"}
                            size={12}
                          />
                          {item}
                          {index < 2 && <DemoGlyph name="check" size={11} />}
                        </b>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {stage === 1 && (
                <div className="pw-demo-answer">
                  <span className="pw-demo-kicker">
                    <DemoGlyph name="spark" size={13} />
                    {t.kicker}
                  </span>
                  <h4>{t.responseTitle}</h4>
                  <p>{t.responseBody}</p>
                  <div className="pw-demo-code" aria-label={t.codeLabel}>
                    <div>
                      <span>solution.py</span>
                      <span>PYTHON</span>
                    </div>
                    <pre>
                      <code>
                        {answerCode.map((line, index) => (
                          <span key={index} style={{ animationDelay: `${index * 45}ms` }}>
                            <i aria-hidden="true">{index + 1}</i>
                            {line}
                          </span>
                        ))}
                      </code>
                    </pre>
                  </div>
                  <div className="pw-demo-chips">
                    {t.complexity.map((item) => (
                      <span key={item}>{item}</span>
                    ))}
                  </div>
                </div>
              )}

              {stage === 2 && (
                <div className="pw-demo-answer">
                  <div className="pw-demo-question">
                    <span>
                      <DemoGlyph name="audio" size={12} />
                      {t.interviewer} · {t.systemAudio}
                    </span>
                    <p>{t.followupQuestion}</p>
                  </div>
                  <h4>{t.followupTitle}</h4>
                  <p>{t.followupBody}</p>
                  <div className="pw-demo-chips">
                    {t.complexity.map((item) => (
                      <span key={item}>{item}</span>
                    ))}
                  </div>
                  <div className="pw-demo-tests">
                    <span>{t.tests}</span>
                    {testCases.map(([call, result], index) => (
                      <code key={call} style={{ animationDelay: `${index * 140}ms` }}>
                        <DemoGlyph name="check" size={12} />
                        {call}
                        <b>{result}</b>
                      </code>
                    ))}
                  </div>
                  <div className="pw-demo-note">
                    <DemoGlyph name="mic" size={12} />
                    {t.meNote}
                  </div>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>

      <div className="pw-demo-player">
        <div className="pw-demo-steps" role="group" aria-label={t.stageLabel}>
          {t.stages.map((item, index) => (
            <button
              type="button"
              className={index === stage ? "pw-demo-selected" : ""}
              key={item.title}
              aria-pressed={index === stage}
              onClick={() => goTo(index)}
            >
              <span className="pw-demo-progress">
                <i />
              </span>
              <span className="pw-demo-steptitle">
                <em>0{index + 1}</em>
                {item.title}
              </span>
              <span className="pw-demo-steptext">{item.text}</span>
            </button>
          ))}
        </div>
        <div
          className="pw-demo-playbuttons"
          role="group"
          aria-label={locale === "zh" ? "播放控制" : "Playback controls"}
        >
          <button type="button" onClick={() => goTo(stage - 1)} aria-label={t.previous}>
            <DemoGlyph name="previous" />
          </button>
          <button
            type="button"
            className="pw-demo-play"
            onClick={() => setPlaying((value) => !value)}
            aria-label={playing ? t.pause : t.play}
            aria-pressed={playing}
          >
            <DemoGlyph name={playing ? "pause" : "play"} />
          </button>
          <button type="button" onClick={() => goTo(stage + 1)} aria-label={t.next}>
            <DemoGlyph name="next" />
          </button>
        </div>
      </div>
      <figcaption id={captionId}>{t.caption}</figcaption>
    </figure>
  );
}
