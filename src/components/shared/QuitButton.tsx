import { Power } from "lucide-react";
import { useToast } from "../../contexts/toast";

export function QuitButton() {
  const { showToast } = useToast();
  return <button type="button" aria-label="Quit / 退出程序"
    className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-red-400/15 hover:text-red-200"
    onClick={() => void window.electronAPI.quitApp().catch(() =>
      showToast("退出失败", "请重试退出程序。", "error"))}>
    <Power size={14} aria-hidden="true" /> Quit / 退出程序
  </button>;
}
