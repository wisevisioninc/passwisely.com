import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import type {
  ResumeProcessResponse,
  ResumeRequest,
  ResumeResult,
} from "./resumeTypes";

export interface AccountUser {
  id: string;
  email: string;
  locale: "zh" | "en";
  credits: number;
}

export interface AccountResult {
  success: boolean;
  user?: AccountUser;
  token?: string;
  error?: string;
}

interface StoredAccount {
  encryptedToken?: string;
  plainToken?: string;
}

export class AccountService {
  private readonly apiBase =
    process.env.PASSWISELY_API_URL?.replace(/\/+$/, "") ||
    "https://passwisely.com/api";
  private readonly filePath = path.join(app.getPath("userData"), "account.json");
  private readonly resumeHistoryPath = path.join(
    app.getPath("userData"),
    "resume-agent-history.json",
  );

  private read(): StoredAccount {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    } catch {
      return {};
    }
  }

  private write(value: StoredAccount): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(value), {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.chmodSync(this.filePath, 0o600);
  }

  public getToken(): string {
    const stored = this.read();
    if (stored.encryptedToken && safeStorage.isEncryptionAvailable()) {
      try {
        return safeStorage.decryptString(
          Buffer.from(stored.encryptedToken, "base64"),
        );
      } catch {
        return "";
      }
    }
    return stored.plainToken || "";
  }

  private setToken(token: string): void {
    if (safeStorage.isEncryptionAvailable()) {
      this.write({
        encryptedToken: safeStorage.encryptString(token).toString("base64"),
      });
    } else {
      this.write({ plainToken: token });
    }
  }

  private async request<T>(
    endpoint: string,
    init: RequestInit = {},
    authenticated = false,
  ): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.body) headers.set("content-type", "application/json");
    if (authenticated) {
      const token = this.getToken();
      if (!token) throw new Error("Please sign in.");
      headers.set("authorization", `Bearer ${token}`);
    }
    const response = await fetch(`${this.apiBase}${endpoint}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(20_000),
    });
    const payload = (await response.json().catch(() => ({}))) as T & {
      error?: string;
    };
    if (!response.ok) {
      if (response.status === 401) this.clear();
      throw new Error(payload.error || `Account service error (${response.status}).`);
    }
    return payload;
  }

  private async authenticate(
    endpoint: "login" | "register",
    email: string,
    password: string,
    locale: "zh" | "en",
  ): Promise<AccountResult> {
    try {
      const result = await this.request<AccountResult>(`/auth/${endpoint}`, {
        method: "POST",
        body: JSON.stringify({ email, password, locale, client: "desktop" }),
      });
      if (!result.token || !result.user) throw new Error("Invalid account response.");
      this.setToken(result.token);
      return { success: true, user: result.user };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Account request failed.",
      };
    }
  }

  public login(email: string, password: string): Promise<AccountResult> {
    return this.authenticate("login", email, password, "en");
  }

  public register(
    email: string,
    password: string,
    locale: "zh" | "en",
  ): Promise<AccountResult> {
    return this.authenticate("register", email, password, locale);
  }

  public async getAccount(): Promise<AccountResult> {
    try {
      const result = await this.request<{ user: AccountUser }>(
        "/account",
        {},
        true,
      );
      return { success: true, user: result.user };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Please sign in.",
      };
    }
  }

  public async consumeCredits(
    action: string,
    requestId: string,
  ): Promise<AccountResult> {
    try {
      const result = await this.request<{ credits: number }>(
        "/credits/consume",
        {
          method: "POST",
          body: JSON.stringify({ action, requestId }),
        },
        true,
      );
      const account = await this.getAccount();
      if (account.success && account.user) {
        account.user.credits = result.credits;
      }
      return account;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Could not use credits.",
      };
    }
  }

  private readResumeHistory(): ResumeResult[] {
    try {
      const value = JSON.parse(fs.readFileSync(this.resumeHistoryPath, "utf8"));
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  private async saveResumeHistory(result: ResumeResult): Promise<void> {
    const history = [
      result,
      ...this.readResumeHistory().filter((item) => item.id !== result.id),
    ].slice(0, 100);
    await fs.promises.writeFile(
      this.resumeHistoryPath,
      JSON.stringify(history, null, 2),
      { encoding: "utf8", mode: 0o600 },
    );
  }

  public getLocalResumeHistory(): ResumeResult[] {
    return this.readResumeHistory();
  }

  public async runResumeAgent(
    input: ResumeRequest,
  ): Promise<ResumeProcessResponse> {
    const agent = {
      optimize: "resume_opt_agent",
      interview: "interview_question_agent",
      history: "history_interview_agent",
    }[input.action];
    try {
      const response = await this.request<{
        run: {
          id: string;
          version: number;
          result_content: string;
          model: string;
          credits_charged: number;
          created_at: string;
          company?: string;
          role?: string;
          sources?: Array<{ title: string; url: string }>;
        };
        credits: number;
      }>(
        "/resume/agents",
        {
          method: "POST",
          body: JSON.stringify({
            agent,
            resumeText: input.resumeText,
            jobDescription: input.jobDescription,
            company: input.company,
            role: input.role,
          }),
        },
        true,
      );
      const run = response.run;
      const result: ResumeResult = {
        action: input.action,
        content: run.result_content,
        provider: "Wise Agent",
        model: run.model,
        id: run.id,
        version: run.version,
        creditsCharged: run.credits_charged,
        createdAt: run.created_at,
        company: run.company,
        role: run.role,
        sources: run.sources || [],
        resumeText: input.resumeText,
        jobDescription: input.jobDescription,
      };
      await this.saveResumeHistory(result);
      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Agent request failed.",
      };
    }
  }

  public clear(): void {
    try {
      fs.unlinkSync(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  public getAccountUrl(): string {
    return this.apiBase.replace(/\/api$/, "/#account");
  }
}
