export type ResumeSourceType = "doc" | "docx" | "pdf" | "html" | "url";

export interface ResumeDocument {
  name: string;
  sourceType: ResumeSourceType;
  source: string;
  text: string;
  characterCount: number;
}

export type ResumeAction = "review" | "optimize" | "interview";

export interface ResumeRequest {
  action: ResumeAction;
  resumeText: string;
  jobDescription?: string;
}

export interface ResumeResult {
  action: ResumeAction;
  content: string;
  provider: string;
  model: string;
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
