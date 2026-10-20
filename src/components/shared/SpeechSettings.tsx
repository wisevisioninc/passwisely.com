import { useEffect, useId, useRef, useState } from "react";
import {
  getTranscriptionProfile,
  TRANSCRIPTION_PROFILES,
} from "../../../electron/live/transcription";
import type { TranscriptionProfileId, TranscriptionSettings } from "../../../electron/live/transcription";

const RECALL_JAPAN_CREDENTIALS = "https://ap-northeast-1.recall.ai/dashboard/transcription";
const message = (error: unknown) => error instanceof Error ? error.message : "语音设置操作失败，请重试。";

/** Speech settings have their own draft and save boundary, independent of AI. */
export function SpeechSettings() {
  const [settings, setSettings] = useState<TranscriptionSettings | null>(null);
  const [profileId, setProfileId] = useState<TranscriptionProfileId | "">("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const selectId = useId();
  const mounted = useRef(false);
  const saveLocked = useRef(false);
  const selected = getTranscriptionProfile(profileId);

  useEffect(() => {
    let current = true;
    mounted.current = true;
    setLoading(true); setError("");
    void (async () => {
      try {
        if (typeof window.electronAPI?.getTranscriptionSettings !== "function") {
          throw new Error("当前应用不支持语音设置，请使用新版桌面应用。");
        }
        const result = await window.electronAPI.getTranscriptionSettings();
        const profile = getTranscriptionProfile(result?.profileId);
        if (!profile) throw new Error("无法识别已保存的语音设置，请重新加载。");
        if (current) { setSettings({ profileId: profile.id }); setProfileId(profile.id); }
      } catch (reason) { if (current) setError(message(reason)); }
      finally { if (current) setLoading(false); }
    })();
    return () => { current = false; mounted.current = false; };
  }, [reload]);

  const save = async () => {
    const requested = getTranscriptionProfile(profileId);
    if (!settings || !requested || saveLocked.current) return;
    saveLocked.current = true; setSaving(true); setError(""); setNotice("");
    try {
      const result = await window.electronAPI.saveTranscriptionSettings({ profileId: requested.id });
      if (!result.success) throw new Error(result.error || "无法保存语音设置，请重试。");
      const saved = getTranscriptionProfile(result.settings?.profileId);
      if (!saved || saved.id !== requested.id) throw new Error("服务返回了不同的语音设置，请重新加载确认。");
      if (mounted.current) {
        setSettings({ profileId: saved.id });
        setNotice(`已保存：${saved.label}。下次新会话生效，当前采集和回答保持不变。`);
      }
    } catch (reason) { if (mounted.current) setError(message(reason)); }
    finally {
      saveLocked.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  return <section className="space-y-2 px-2" aria-label="语音识别设置">
    <label htmlFor={selectId} className="block text-[12px] font-medium">语音识别 / Speech</label>
    <select id={selectId} aria-label="语音识别方式" value={profileId}
      disabled={loading || saving || !settings}
      onChange={event => {
        const profile = getTranscriptionProfile(event.target.value);
        if (!profile) { setError("请选择有效的语音识别方式。"); return; }
        setProfileId(profile.id); setError(""); setNotice("");
      }}
      className="w-full rounded bg-gray-900 px-2 py-1.5 text-[11px] outline-none disabled:opacity-50">
      {!profileId && <option value="" disabled>正在加载语音设置…</option>}
      {TRANSCRIPTION_PROFILES.map(profile => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
    </select>
    {selected?.id === "recall-en" && <p className="text-[10px] leading-relaxed text-white/60">英文实时转录，使用 Recall 内置识别。</p>}
    {selected?.id === "deepgram-zh" && <div className="space-y-1 text-[10px] leading-relaxed text-white/60">
      <p>中文实时转录，使用 Deepgram Nova-3。需在 Recall 日本项目配置自己的 Deepgram Key 和 Project ID，并设为默认凭据。</p>
      <a href={RECALL_JAPAN_CREDENTIALS} target="_blank" rel="noopener noreferrer"
        className="text-amber-200 underline underline-offset-2"
        onClick={event => {
          if (typeof window.electronAPI?.openExternal === "function") {
            event.preventDefault(); window.electronAPI.openExternal(RECALL_JAPAN_CREDENTIALS);
          }
        }}>打开 Recall 日本项目转录凭据</a>
      <p>此选项按中文识别，不承诺中英自动切换。无需在客户端填写语音服务 Key。</p>
    </div>}
    {selected?.id === "recall-zh" && <p className="text-[10px] leading-relaxed text-amber-200/90">中文分钟级转录（实验），通常延迟 3–10 分钟。Desktop 真实采集尚未验证，不适合需要即时转录的场景。</p>}
    <p className="text-[9px] leading-relaxed text-white/50">语音识别与 AI 回答语言分别设置。保存后仅对下次新会话生效。</p>
    {loading && <p role="status" className="text-[10px] text-white/50">正在加载语音设置…</p>}
    {error && <p role="alert" className="text-[10px] leading-relaxed text-red-300">{error}</p>}
    {notice && <p role="status" className="text-[10px] leading-relaxed text-green-300">{notice}</p>}
    <div className="flex gap-2">
      <button type="button" onClick={() => void save()} disabled={loading || saving || !settings || !selected || selected.id === settings.profileId}
        className="rounded bg-amber-500/60 px-2 py-1 text-[10px] hover:bg-amber-500/80 disabled:opacity-50">{saving ? "正在保存语音设置…" : "保存语音设置"}</button>
      {error && <button type="button" disabled={loading || saving} onClick={() => { setNotice(""); setReload(value => value + 1); }}
        className="rounded bg-white/10 px-2 py-1 text-[10px] hover:bg-white/20 disabled:opacity-50">重新加载语音设置</button>}
    </div>
  </section>;
}
