import React, { useEffect } from "react"

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
    window.__LANGUAGE__ = newLanguage
    setLanguage(newLanguage)
  }

  const languages = [
    { value: 'python', label: 'Python', shortcut: 'Alt+P' },
    { value: 'cpp', label: 'C++', shortcut: 'Alt+C' },
    { value: 'java', label: 'Java', shortcut: 'Alt+J' }
  ]

  return (
    <div className="mb-3 px-2 space-y-1">
      <label className="block text-[12px] font-medium text-white/90">
        Solution language
      </label>
      <select
        value={currentLanguage}
        onChange={(event) => handleLanguageChange(event.target.value)}
        className="w-full rounded bg-gray-900 px-2 py-1.5 text-[11px] outline-none"
      >
        {languages.map(({ value, label, shortcut }) => (
          <option key={value} value={value}>
            {label} ({shortcut})
          </option>
        ))}
      </select>
    </div>
  )
}
