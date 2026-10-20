import React, { useEffect } from "react"
import { CODE_LANGUAGES, getCodeLanguage } from "../../../electron/languages"

interface LanguageSelectorProps {
  currentLanguage: string
  setLanguage: (language: string) => void
}

export const LanguageSelector: React.FC<LanguageSelectorProps> = ({
  currentLanguage,
  setLanguage
}) => {
  useEffect(() => {
    // Listen for language change events from main process
    const unsubscribe = window.electronAPI.onLanguageChange((newLanguage: string) => {
      handleLanguageChange(newLanguage);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const handleLanguageChange = (newLanguage: string) => {
    const language = getCodeLanguage(newLanguage)
    if (language) setLanguage(language.id)
  }

  const shortcuts: Readonly<Record<string, string>> = { python: 'Alt+P', cpp: 'Alt+C', java: 'Alt+J' }

  return (
    <div className="mb-3 px-2 space-y-1">
      <label className="block text-[12px] font-medium text-white/90">
        Solution language
      </label>
      <select
        value={getCodeLanguage(currentLanguage)?.id ?? ""}
        onChange={(event) => handleLanguageChange(event.target.value)}
        className="w-full rounded bg-gray-900 px-2 py-1.5 text-[11px] outline-none"
      >
        {!getCodeLanguage(currentLanguage) && <option value="" disabled>Select language</option>}
        {CODE_LANGUAGES.map(({ id, label }) => (
          <option key={id} value={id}>
            {label}{shortcuts[id] ? ` (${shortcuts[id]})` : ""}
          </option>
        ))}
      </select>
    </div>
  )
}
