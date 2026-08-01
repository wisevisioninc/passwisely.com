export type ResumeSourceType = "doc" | "docx" | "pdf" | "html" | "url";

export interface ResumeDocument {
  name: string;
  sourceType: ResumeSourceType;
  source: string;
  text: string;
  characterCount: number;
}

export type ResumeAction = "optimize" | "interview" | "history";

export interface ResumeRequest {
  action: ResumeAction;
  resumeText: string;
  jobDescription?: string;
  company?: string;
  role?: string;
}

export interface ResumeResult {
  action: ResumeAction;
  content: string;
  provider: string;
  model: string;
  id?: string;
  version?: number;
  creditsCharged?: number;
  createdAt?: string;
  company?: string;
  role?: string;
  sources?: Array<{ title: string; url: string }>;
  resumeText?: string;
  jobDescription?: string;
}

export interface ResumeDocumentResponse {
  success: boolean;
  document?: ResumeDocument;
  canceled?: boolean;
  error?: string;
}

export interface ResumeProcessResponse {
  success: boolean;
  data?: ResumeResult;
  error?: string;
}
