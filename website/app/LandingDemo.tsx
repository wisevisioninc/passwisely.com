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
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

const copy = {
  zh: {
    region: "PassWisely 交互式产品演示",
    session: "模拟练习会话",
    question: "接雨水",
    instructions:
      "给定每根柱子的高度（宽度为 1），计算下雨之后最多能接多少雨水。",
    examples: "示例",
    constraints: "先说明思路，再写出实现，并检查边界情况。",
    interviewer: "提问者",
    candidate: "练习者",
    sessionTag: "CODING PRACTICE",
    toolbarSession: "练习会话",
    screenshot: "截图",
    solve: "整理思路",
    response: "回答",
    transcripts: "转录",
    source: "系统音频",
    microphone: "麦克风",
    questionTranscript: "给一组柱子的高度，下雨之后最多能接多少水？",
    followupTranscript: "能把额外空间降到 O(1) 吗？",
    meTranscript: "先说按列计算，再优化空间。",
    responseTitle: "每一列的水位，由两侧最高柱子中较矮的一方决定。",
    responseBody:
      "对每一列计算 min(左侧最高, 右侧最高) − 当前高度并累加。预处理左右最高值数组即可做到 O(n)。",
    followupTitle: "可以，用双指针从较矮的一侧收敛。",
    followupBody:
      "较矮一侧的最高值已经确定了水位上限，边移动边累加。对于 [4, 2, 0, 3, 2, 5]，结果是 9。",
    complexity: "时间 O(n) · 空间 O(1)",
    context: "组合上下文",
    contextItems: ["对话转录", "题目截图", "手输追问"],
    stages: [
      {
        title: "捕捉问题",
        text: "把对话和题目放到同一个上下文。",
        short: "采集",
      },
      {
        title: "梳理思路",
        text: "从解题思路走到代码和复杂度。",
        short: "理解",
      },
      {
        title: "接住追问",
        text: "沿着当前对话，继续检查边界。",
        short: "追问",
      },
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
    session: "Practice session",
    question: "Trapping rain water",
    instructions:
      "Given the height of each bar (width 1), compute how much water can be trapped after it rains.",
    examples: "EXAMPLE",
    constraints:
      "Explain an approach, write the code, then check the edge cases.",
    interviewer: "Interviewer",
    candidate: "Practicing",
    sessionTag: "CODING PRACTICE",
    toolbarSession: "Practice session",
    screenshot: "Capture",
    solve: "Reason it out",
    response: "Response",
    transcripts: "Transcripts",
    source: "System audio",
    microphone: "Microphone",
    questionTranscript:
      "Given the bar heights, how much water can be trapped after it rains?",
    followupTranscript: "Can you reduce the extra space to O(1)?",
    meTranscript: "Start with a per-column view, then optimize space.",
    responseTitle: "Each column fills to the shorter of its two tallest walls.",
    responseBody:
      "For every column, add min(max left, max right) minus its height. Precomputing both maxima gives O(n).",
    followupTitle: "Yes. Close in from the shorter side.",
    followupBody:
      "The shorter side's running maximum already caps the water level, so add as you move. For [4, 2, 0, 3, 2, 5], the answer is 9.",
    complexity: "Time O(n) · Space O(1)",
    context: "CONTEXT TOGETHER",
    contextItems: ["Conversation", "Question capture", "Typed follow-up"],
    stages: [
      {
        title: "Capture the question",
        text: "Keep the conversation and question in one context.",
        short: "Capture",
      },
      {
        title: "Build an approach",
        text: "Move from reasoning to code and complexity.",
        short: "Understand",
      },
      {
        title: "Follow the next question",
        text: "Continue the conversation and check the edges.",
        short: "Follow up",
      },
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

function Avatar({ variant }: { variant: "a" | "b" }) {
  return (
    <svg
      viewBox="0 0 180 180"
      fill="none"
      aria-hidden="true"
      className={`pw-demo-avatar pw-demo-avatar-${variant}`}
    >
      <circle cx="90" cy="90" r="81" fill="currentColor" opacity=".06" />
      <circle cx="90" cy="66" r="27" fill="currentColor" opacity=".68" />
      <path
        d="M38 144c0-28.7 23.3-52 52-52s52 23.3 52 52"
        fill="currentColor"
        opacity=".4"
      />
      <circle
        cx="90"
        cy="90"
        r="80"
        stroke="currentColor"
        strokeOpacity=".12"
      />
    </svg>
  );
}

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
  const displayedCode =
    stage === 2
      ? [
          "assert trap([4, 2, 0, 3, 2, 5]) == 9",
          "assert trap([2, 0, 2]) == 2",
          "assert trap([]) == 0",
        ]
      : answerCode;

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

  return (
    <figure
      className={`pw-demo${compact ? " pw-demo-compact" : ""}${playing ? " pw-demo-playing" : ""}`}
      aria-label={t.region}
      aria-describedby={captionId}
    >
      <div className="pw-demo-frame" data-stage={stage}>
        <div className="pw-demo-windowbar">
          <span className="pw-demo-traffic" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="pw-demo-windowname">
            practice.session <span>/ {t.sessionTag}</span>
          </span>
          <span className="pw-demo-sessionlabel">
            <span />
            {t.session}
          </span>
        </div>

        <div className="pw-demo-scene">
          <div className="pw-demo-question">
            <div className="pw-demo-questiontop">
              <span>01 / PYTHON</span>
              <span className="pw-demo-editorbadge">{t.sessionTag}</span>
            </div>
            <h3>
              {t.question}
              <span>↗</span>
            </h3>
            <p>{t.instructions}</p>
            <div className="pw-demo-example">
              <span>{t.examples}</span>
              <code>
                height = [4, 2, 0, 3, 2, 5]
                <br />
                <b>→ 9</b>
              </code>
            </div>
            <p className="pw-demo-constraint">{t.constraints}</p>
            <div className="pw-demo-participants">
              <div className="pw-demo-participant">
                <Avatar variant="a" />
                <span>
                  {t.interviewer}
                  <i className="pw-demo-participant-audio">
                    <DemoGlyph name="audio" size={12} />
                  </i>
                </span>
              </div>
              <div className="pw-demo-participant">
                <Avatar variant="b" />
                <span>
                  {t.candidate}
                  <i>
                    <DemoGlyph name="audio" size={12} />
                  </i>
                </span>
              </div>
            </div>
          </div>

          <div className="pw-demo-overlayarea">
            <div className="pw-demo-toolbar" aria-hidden="true">
              <img
                src="/passwisely-logo-192.png"
                width="24"
                height="24"
                alt=""
              />
              <span className="pw-demo-toolbarsession">
                <i />
                <span>{t.toolbarSession}</span>
              </span>
              <span>
                <DemoGlyph name="camera" size={15} />
                <span>{t.screenshot}</span>
              </span>
              <span className="pw-demo-toolbarsolve">
                <DemoGlyph name="spark" size={15} />
                <span>{t.solve}</span>
              </span>
              <span className="pw-demo-toolbarshortcut">⌘ ↵</span>
            </div>

            <div className="pw-demo-overlay">
              <div className="pw-demo-overlayhead">
                <div>
                  <img
                    src="/passwisely-logo-192.png"
                    width="22"
                    height="22"
                    alt=""
                  />
                  <span className={stage === 0 ? "" : "pw-demo-active"}>
                    {t.response}
                  </span>
                  <span className={stage === 0 ? "pw-demo-active" : ""}>
                    {t.transcripts}
                  </span>
                </div>
                <span className="pw-demo-overlaymark">PassWisely</span>
              </div>
              <div
                className="pw-demo-content"
                aria-live={playing ? "off" : "polite"}
                aria-atomic="true"
              >
                {stage === 0 ? (
                  <div className="pw-demo-transcript">
                    <span className="pw-demo-source">
                      <DemoGlyph name="audio" size={13} />
                      {t.source}
                    </span>
                    <p>{t.questionTranscript}</p>
                    <div className="pw-demo-wave" aria-hidden="true">
                      {Array.from({ length: 25 }, (_, index) => (
                        <i
                          key={index}
                          style={{
                            height: `${9 + ((index * 13 + 7) % 29)}px`,
                            animationDelay: `${index * 75}ms`,
                          }}
                        />
                      ))}
                    </div>
                    <span className="pw-demo-contextlabel">{t.context}</span>
                    <div className="pw-demo-contextchips">
                      {t.contextItems.map((item, index) => (
                        <span key={item}>
                          <DemoGlyph
                            name={
                              index === 0
                                ? "audio"
                                : index === 1
                                  ? "camera"
                                  : "spark"
                            }
                            size={12}
                          />
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="pw-demo-answer">
                    {stage === 2 && (
                      <div className="pw-demo-followup">
                        <span>
                          <DemoGlyph name="audio" size={12} />
                          {t.source}
                        </span>
                        <p>{t.followupTranscript}</p>
                      </div>
                    )}
                    <h4>{stage === 1 ? t.responseTitle : t.followupTitle}</h4>
                    <p>{stage === 1 ? t.responseBody : t.followupBody}</p>
                    <div className="pw-demo-code" aria-label={t.codeLabel}>
                      <div>
                        <span>solution.py</span>
                        <span>PYTHON</span>
                      </div>
                      <pre>
                        <code>
                          {displayedCode.map((line, index) => (
                            <span
                              className={
                                stage === 2 && index === 0
                                  ? "pw-demo-code-highlight"
                                  : ""
                              }
                              key={line}
                            >
                              <i aria-hidden="true">{index + 1}</i>
                              {line}
                            </span>
                          ))}
                        </code>
                      </pre>
                    </div>
                    <div className="pw-demo-complexity">
                      <DemoGlyph name="check" size={13} />
                      {t.complexity}
                    </div>
                    {stage === 2 && (
                      <div className="pw-demo-microphone">
                        <span>{t.microphone}</span>
                        <p>{t.meTranscript}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="pw-demo-player">
        <div className="pw-demo-current">
          <span className="pw-demo-stepnumber">0{stage + 1}</span>
          <div>
            <h3>{t.stages[stage].title}</h3>
            <p>{t.stages[stage].text}</p>
          </div>
        </div>
        <div className="pw-demo-playercontrols">
          <div className="pw-demo-steps" role="group" aria-label={t.stageLabel}>
            {t.stages.map((item, index) => (
              <button
                type="button"
                className={index === stage ? "pw-demo-selected" : ""}
                key={item.short}
                aria-pressed={index === stage}
                onClick={() => goTo(index)}
              >
                <span>0{index + 1}</span>
                {item.short}
              </button>
            ))}
          </div>
          <div
            className="pw-demo-playbuttons"
            role="group"
            aria-label={locale === "zh" ? "播放控制" : "Playback controls"}
          >
            <button
              type="button"
              onClick={() => goTo(stage - 1)}
              aria-label={t.previous}
            >
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
            <button
              type="button"
              onClick={() => goTo(stage + 1)}
              aria-label={t.next}
            >
              <DemoGlyph name="next" />
            </button>
          </div>
        </div>
      </div>
      <figcaption id={captionId}>{t.caption}</figcaption>
    </figure>
  );
}
