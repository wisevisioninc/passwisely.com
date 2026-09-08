import type { AiProviderId } from "../../electron/aiProviders"
import type {
  ResumeDocumentResponse,
  ResumeProcessResponse,
  ResumeRequest,
  ResumeResult,
} from "../../electron/resumeTypes"
import type {
  PublicSettings,
  SaveAiSettingsInput,
} from "../../electron/settings"

export interface ElectronAPI {
  accountGet: () => Promise<{
    success: boolean
    user?: {
      id: string
      email: string
      locale: "zh" | "en"
      credits: number
    }
    error?: string
  }>
  accountLogin: (input: {
    email: string
    password: string
  }) => Promise<{
    success: boolean
    user?: {
      id: string
      email: string
      locale: "zh" | "en"
      credits: number
    }
    error?: string
    errorCode?: string
  }>
  accountRegister: (input: {
    email: string
    password: string
    locale: "zh" | "en"
  }) => Promise<{
    success: boolean
    user?: {
      id: string
      email: string
      locale: "zh" | "en"
      credits: number
    }
    error?: string
    errorCode?: string
  }>
  accountForgotPassword: (email: string) => Promise<{
    success: boolean
    error?: string
  }>
  accountChangePassword: (input: {
    currentPassword: string
    newPassword: string
  }) => Promise<{
    success: boolean
    error?: string
  }>
  accountLogout: () => Promise<{ success: boolean }>
  quitApp: () => Promise<{ success: boolean }>
  setAuthWindow: (enabled: boolean) => Promise<void>
  minimizeWindow: () => Promise<{ success: boolean }>
  toggleMaximizeWindow: () => Promise<{ success: boolean; maximized?: boolean }>
  accountOpenPortal: () => Promise<void>
  openSubscriptionPortal: (authData: {
    id: string
    email: string
  }) => Promise<{ success: boolean; error?: string }>
  updateContentDimensions: (dimensions: {
    width: number
    height: number
  }) => Promise<void>
  clearStore: () => Promise<{ success: boolean; error?: string }>
  getScreenshots: () => Promise<Array<{ path: string; preview: string }>>
  deleteScreenshot: (
    path: string
  ) => Promise<{ success: boolean; error?: string }>
  onScreenshotTaken: (
    callback: (data: { path: string; preview: string }) => void
  ) => () => void
  onResetView: (callback: () => void) => () => void
  onSolutionStart: (callback: () => void) => () => void
  onDebugStart: (callback: () => void) => () => void
  onDebugSuccess: (callback: (data: any) => void) => () => void
  onSolutionError: (callback: (error: string) => void) => () => void
  onProcessingNoScreenshots: (callback: () => void) => () => void
  onProblemExtracted: (callback: (data: any) => void) => () => void
  onSolutionSuccess: (callback: (data: any) => void) => () => void
  onUnauthorized: (callback: () => void) => () => void
  onApiKeyInvalid: (callback: (error: string) => void) => () => void
  onDebugError: (callback: (error: string) => void) => () => void
  openExternal: (url: string) => void
  toggleMainWindow: () => Promise<{ success: boolean; error?: string }>
  triggerScreenshot: () => Promise<{ success: boolean; error?: string }>
  triggerProcessScreenshots: () => Promise<{ success: boolean; error?: string }>
  triggerReset: () => Promise<{ success: boolean; error?: string }>
  triggerMoveLeft: () => Promise<{ success: boolean; error?: string }>
  triggerMoveRight: () => Promise<{ success: boolean; error?: string }>
  triggerMoveUp: () => Promise<{ success: boolean; error?: string }>
  triggerMoveDown: () => Promise<{ success: boolean; error?: string }>
  onSubscriptionUpdated: (callback: () => void) => () => void
  onSubscriptionPortalClosed: (callback: () => void) => () => void
  startUpdate: () => Promise<{ success: boolean; error?: string }>
  installUpdate: () => void
  onUpdateAvailable: (callback: (info: any) => void) => () => void
  onUpdateDownloaded: (callback: (info: any) => void) => () => void

  decrementCredits: () => Promise<void>
  setInitialCredits: (credits: number) => Promise<void>
  onCreditsUpdated: (callback: (credits: number) => void) => () => void
  onOutOfCredits: (callback: () => void) => () => void
  openSettingsPortal: () => Promise<void>
  getPlatform: () => string
  onLanguageChange: (callback: (language: string) => void) => () => void
  onQueryChange: (callback: (query: string) => void) => () => void
  onReset: (callback: () => void) => () => void
  processInputText: (
    inputText: string
  ) => Promise<{ success: boolean; error?: string }>
  getAiSettings: () => Promise<PublicSettings>
  saveAiSettings: (input: SaveAiSettingsInput) => Promise<{
    success: boolean
    settings?: PublicSettings
    error?: string
  }>
  clearApiKey: (provider?: AiProviderId) => Promise<{
    success: boolean
    settings?: PublicSettings
    error?: string
  }>
  selectResumeFile: () => Promise<ResumeDocumentResponse>
  loadResumeUrl: (url: string) => Promise<ResumeDocumentResponse>
  processResume: (request: ResumeRequest) => Promise<ResumeProcessResponse>
  getResumeHistory: () => Promise<ResumeResult[]>
  saveResumeResult: (input: {
    content: string
    suggestedName?: string
  }) => Promise<{
    success: boolean
    path?: string
    canceled?: boolean
    error?: string
  }>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
    electron: {
      ipcRenderer: {
        on: (channel: string, func: (...args: any[]) => void) => void
        removeListener: (
          channel: string,
          func: (...args: any[]) => void
        ) => void
      }
    }
    __CREDITS__: number
    __LANGUAGE__: string
    __QUERY__: string
    __IS_INITIALIZED__: boolean
  }
}
