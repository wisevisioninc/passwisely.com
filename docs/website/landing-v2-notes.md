# Homepage v2: reference analysis and changes

## Reference analysis (interviewcoder.co, captured 2026-10-22)

Visual language: black canvas, `#121212` panels alternating with a beige
`rgb(225,220,201)` panel, a single yellow accent (`#EFC83A`) used for pill CTAs,
Inter/Geist, H1 47px / 600 / -1.88px tracking, mono uppercase social-proof pill
above the H1, product video directly under the hero.

Section order: Hero (pill, H1, one CTA + "no credit card") → feature cards →
comparison table vs competitors → testimonials → "in action" video → use-case
tabs → results gallery → pricing (Free / Monthly / Lifetime) → numbered
per-platform status cards → FAQ accordion → final CTA → large footer.

PassWisely already follows most of this structure (hero, workflow features,
scenario tabs, pricing, numbered compatibility cards, FAQ, final CTA). We do
not copy its copy, assets, videos, or its "undetectable / never caught" and
unverified user/offer claims.

## v2 changes

- Hero: the unsigned-Windows notice moves out of the hero; it remains in the
  final download section and FAQ.
- New `#compare` section: capability table PassWisely vs general AI chat vs
  manual notes, with a note that chat-assistant capabilities vary.
- New optional `#demo` video section, driven by `website/app/demo-video.ts`.
  It renders only when `src` is set to a PassWisely-owned video.

## Demo video brief (for AI generation or screen recording)

Target: 60–90 s, 16:9, 1080p H.264 MP4 under ~15 MB, plus a poster JPG.
Put files in `website/public/media/` and set `DEMO_VIDEO.src`/`poster`.

1. 0–8 s: dark desktop, PassWisely logo, title "捕捉对话中的问题，展开下一步思路".
2. 8–25 s: overlay starts listening; system-audio and microphone lines
   transcribe a question ("给定一个整数数组，怎样找到和为目标值的两个数？").
3. 25–40 s: ⌘H screenshot of a coding question; the capture appears as context.
4. 40–60 s: ⌘↵ streams approach → complexity → Python code.
5. 60–75 s: typed follow-up about edge cases; answer continues in the same thread.
6. 75–90 s: pricing card (20 free credits) and download buttons.

Use only PassWisely UI, synthetic content and stock-free generated scenes; no
real company logos, people, or third-party footage.
