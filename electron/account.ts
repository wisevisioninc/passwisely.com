import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";

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

  private getToken(): string {
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
