/** Shared language contracts. Output, generated code, and ASR are independent. */
export const OUTPUT_LANGUAGES = [
  {"id": "ar-SA", "label": "Arabic (العربية)", "instructionName": "Arabic"},
  {"id": "bn-BD", "label": "Bengali (বাংলা)", "instructionName": "Bengali"},
  {"id": "yue-Hant-HK", "label": "Cantonese (粵語)", "instructionName": "Traditional Cantonese"},
  {"id": "de-DE", "label": "German (Deutsch)", "instructionName": "German"},
  {"id": "en-US", "label": "English", "instructionName": "English"},
  {"id": "fa-IR", "label": "Farsi (فارسی)", "instructionName": "Persian"},
  {"id": "fr-FR", "label": "French (Français)", "instructionName": "French"},
  {"id": "hi-IN", "label": "Hindi (हिन्दी)", "instructionName": "Hindi"},
  {"id": "it-IT", "label": "Italian (Italiano)", "instructionName": "Italian"},
  {"id": "ja-JP", "label": "Japanese (日本語)", "instructionName": "Japanese"},
  {"id": "ko-KR", "label": "Korean (한국어)", "instructionName": "Korean"},
  {"id": "zh-CN", "label": "Mandarin (普通话)", "instructionName": "Simplified Chinese"},
  {"id": "nl-NL", "label": "Dutch (Nederlands)", "instructionName": "Dutch"},
  {"id": "pl-PL", "label": "Polish (Polski)", "instructionName": "Polish"},
  {"id": "pt-PT", "label": "Portuguese (Português)", "instructionName": "Portuguese"},
  {"id": "ru-RU", "label": "Russian (Русский)", "instructionName": "Russian"},
  {"id": "es-ES", "label": "Spanish (Español)", "instructionName": "Spanish"},
  {"id": "ta-IN", "label": "Tamil (தமிழ்)", "instructionName": "Tamil"},
  {"id": "th-TH", "label": "Thai (ไทย)", "instructionName": "Thai"},
  {"id": "tr-TR", "label": "Turkish (Türkçe)", "instructionName": "Turkish"},
  {"id": "ur-PK", "label": "Urdu (اردو)", "instructionName": "Urdu"},
  {"id": "vi-VN", "label": "Vietnamese (Tiếng Việt)", "instructionName": "Vietnamese"},
] as const;
export type OutputLanguageId = (typeof OUTPUT_LANGUAGES)[number]["id"];
/** Existing stored/runtime callers may still supply the pre-catalog English ID. */
export type ResponseLanguage = OutputLanguageId | "en";
export const RESPONSE_LANGUAGES = OUTPUT_LANGUAGES.map(language => language.id);
export const DEFAULT_OUTPUT_LANGUAGE: OutputLanguageId = "zh-CN";

export const CODE_LANGUAGES = [
  {"id": "python", "label": "Python", "instructionName": "Python", "highlightId": "python"},
  {"id": "javascript", "label": "JavaScript", "instructionName": "JavaScript", "highlightId": "javascript"},
  {"id": "typescript", "label": "TypeScript", "instructionName": "TypeScript", "highlightId": "typescript"},
  {"id": "java", "label": "Java", "instructionName": "Java", "highlightId": "java"},
  {"id": "php", "label": "PHP", "instructionName": "PHP", "highlightId": "php"},
  {"id": "golang", "label": "Golang", "instructionName": "Go", "highlightId": "go"},
  {"id": "r", "label": "R", "instructionName": "R", "highlightId": "r"},
  {"id": "ruby", "label": "Ruby", "instructionName": "Ruby", "highlightId": "ruby"},
  {"id": "c", "label": "C", "instructionName": "C", "highlightId": "c"},
  {"id": "cpp", "label": "C++", "instructionName": "C++", "highlightId": "cpp"},
  {"id": "csharp", "label": "C#", "instructionName": "C#", "highlightId": "csharp"},
  {"id": "rust", "label": "Rust", "instructionName": "Rust", "highlightId": "rust"},
  {"id": "kotlin", "label": "Kotlin", "instructionName": "Kotlin", "highlightId": "kotlin"},
  {"id": "swift", "label": "Swift", "instructionName": "Swift", "highlightId": "swift"},
  {"id": "dart", "label": "Dart", "instructionName": "Dart", "highlightId": "dart"},
  {"id": "sql", "label": "SQL", "instructionName": "SQL", "highlightId": "sql"},
] as const;
export type CodeLanguage = (typeof CODE_LANGUAGES)[number]["id"];
export const DEFAULT_CODE_LANGUAGE: CodeLanguage = "python";

export function getOutputLanguage(value: unknown): (typeof OUTPUT_LANGUAGES)[number] | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase();
  const legacy: Readonly<Record<string, string>> = { zh: "zh-cn", chinese: "zh-cn", "中文": "zh-cn", en: "en-us", english: "en-us", "英文": "en-us" };
  return OUTPUT_LANGUAGES.find(language => language.id.toLowerCase() === (legacy[key] || key)) || null;
}
export function getCodeLanguage(value: unknown): (typeof CODE_LANGUAGES)[number] | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase();
  const aliases: Readonly<Record<string, string>> = { go: "golang", "c++": "cpp", "c#": "csharp" };
  return CODE_LANGUAGES.find(language => language.id === (aliases[key] || key)) || null;
}
export function requireOutputLanguage(value: unknown = DEFAULT_OUTPUT_LANGUAGE): (typeof OUTPUT_LANGUAGES)[number] {
  const language = getOutputLanguage(value);
  if (!language) throw new Error("Unsupported output language. Choose a language in Settings.");
  return language;
}
export function requireCodeLanguage(value: unknown = DEFAULT_CODE_LANGUAGE): (typeof CODE_LANGUAGES)[number] {
  const language = getCodeLanguage(value);
  if (!language) throw new Error("Unsupported code language. Choose a language in Settings.");
  return language;
}
export function responseLanguageInstruction(value: unknown = DEFAULT_OUTPUT_LANGUAGE, allowExplicitQuestion = false): string {
  const language = requireOutputLanguage(value);
  return `Answer in ${language.instructionName} (${language.id}). All explanatory prose and code comments use this language; code syntax, identifiers, API names, commands and necessary technical terms may retain their original form. JSON property names must remain exactly as requested.${allowExplicitQuestion ? " Follow a different language only when the current explicit user question requests it." : ""}`;
}
export function codeLanguageInstruction(value: unknown = DEFAULT_CODE_LANGUAGE): string {
  const language = requireCodeLanguage(value);
  return `When the task calls for code, use ${language.instructionName} unless the current explicit user question requests a different programming language. This preference does not require generating code for non-programming questions.`;
}
