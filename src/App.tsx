import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import SubscribedApp from "./_pages/SubscribedApp";
import { accountBalanceRefresh } from "./lib/accountBalanceRefresh";
import AuthPage, { DesktopAccountUser } from "./_pages/AuthPage";
import {
  Toast,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "./components/ui/toast";
import { UpdateNotification } from "./components/UpdateNotification";
import { ToastContext } from "./contexts/toast";
import { WindowControls } from "./components/shared/WindowControls";
import { CaptureRecovery } from "./components/Live/CaptureRecovery";
import { readCodeLanguagePreference, saveCodeLanguage } from "./components/Live/livePreferences";
import { getCodeLanguage } from "../electron/languages";

// Create a React Query client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      gcTime: Infinity,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 1,
    },
  },
});

type ToastVariant = "neutral" | "success" | "error";

interface ToastState {
  open: boolean;
  title: string;
  description: string;
  variant: ToastVariant;
}

// Root component without any authentication or subscription logic
function App() {
  // Toast state for notifications
  const [toastState, setToastState] = useState<ToastState>({
    open: false,
    title: "",
    description: "",
    variant: "neutral",
  });
  // Default language (can be updated from within SubscribedApp)
  const [languagePreference] = useState(() => readCodeLanguagePreference());
  const [currentLanguage, setCurrentLanguage] = useState<string>(languagePreference.language ?? "");
  const [currentQuery, setQuery] = useState<string>("");
  const [account, setAccount] = useState<DesktopAccountUser | null>(null);
  const [credits, setCredits] = useState(0);
  const [accountLoading, setAccountLoading] = useState(true);
  const [accountError, setAccountError] = useState("");

  useLayoutEffect(() => {
    void window.electronAPI.setAuthWindow(!account).catch(console.error);
  }, [Boolean(account)]);

  useEffect(() => {
    let active = true;
    void window.electronAPI.accountGet().then((result) => {
      if (!active) return;
      if (result.success && result.user) {
        setAccount(result.user);
        setCredits(result.user.credits);
      } else {
        setAccountError(result.error || "");
      }
      setAccountLoading(false);
    });
    const removeCreditsListener = window.electronAPI.onCreditsUpdated(
      (nextCredits) => {
        setCredits(nextCredits);
        setAccount((current) =>
          current ? { ...current, credits: nextCredits } : current,
        );
      },
    );
    const removeUnauthorizedListener = window.electronAPI.onUnauthorized(() => {
      setAccount(null);
      setCredits(0);
    });
    return () => {
      active = false;
      removeCreditsListener();
      removeUnauthorizedListener();
    };
  }, []);

  useEffect(() => {
    if (!account) return;
    const refresh = accountBalanceRefresh({ userId: account.id,
      read: () => window.electronAPI.accountGet(),
      accept: user => {
        setCredits(user.credits);
        setAccount(current => current?.id === user.id ? { ...current, ...user } : current);
      },
    });
    refresh.observe(account);
    const update = () => { void refresh.refresh(); };
    const visible = () => { if (document.visibilityState === "visible") update(); };
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", visible);
    const removeTasks = [
      window.electronAPI.onSolutionSuccess(update), window.electronAPI.onDebugSuccess(update),
      window.electronAPI.onSolutionError(update), window.electronAPI.onDebugError(update),
      window.electronAPI.onProcessingCancelled(update),
    ];
    const terminalAnswers = new Set<string>();
    const removeLive = window.electronAPI.onLiveSnapshot(snapshot => {
      // Keep only the bounded current answer set; transcript revisions do not
      // create repeated account requests.
      const present = new Set(snapshot.answers.map(answer => answer.id));
      for (const id of terminalAnswers) if (!present.has(id)) terminalAnswers.delete(id);
      let changed = false;
      for (const answer of snapshot.answers) {
        if (["completed", "cancelled", "error"].includes(answer.status) && !terminalAnswers.has(answer.id)) {
          terminalAnswers.add(answer.id); changed = true;
        }
      }
      if (changed) update();
    });
    return () => {
      refresh.dispose();
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", visible);
      for (const remove of removeTasks) remove();
      removeLive();
    };
  }, [account?.id]);

  useEffect(() => {
    window.__LANGUAGE__ = currentLanguage;
    window.__QUERY__ = currentQuery;
    window.__CREDITS__ = credits;
    window.__IS_INITIALIZED__ = true;
  }, [currentLanguage, currentQuery, credits]);
  // Show toast method for notifications
  const showToast = useCallback(
    (
      title: string,
      description: string,
      variant: ToastVariant, // now correctly typed
    ) => {
      setToastState({
        open: true,
        title,
        description,
        variant,
      });
    },
    [],
  );

  useEffect(() => {
    if (languagePreference.error) showToast("代码语言设置", languagePreference.error, "error");
  }, [languagePreference, showToast]);
  const setLanguage = useCallback((value: string) => {
    const language = getCodeLanguage(value);
    if (!language) { showToast("代码语言设置", "请选择有效的代码语言。", "error"); return; }
    const saved = saveCodeLanguage(language.id);
    // This App owns both the active preference and the compatibility bridge.
    // A blocked localStorage write does not prevent an explicit session choice.
    window.__LANGUAGE__ = language.id;
    setCurrentLanguage(language.id);
    if (!saved.success) showToast("代码语言未保存", `本次会话已使用所选语言。${saved.error}重新打开后需再次选择。`, "error");
  }, [showToast]);

  if (accountLoading) {
    return (
      <div className="h-screen relative grid place-items-center bg-[#111018] text-white rounded-2xl border border-white/10">
        <CaptureRecovery />
        <div className="absolute inset-x-0 top-0"><WindowControls /></div>
        <div className="text-center">
          <img
            src="./logo512.png"
            alt="PassWisely"
            className="w-9 h-9 mx-auto rounded-xl"
          />
          <p className="mt-4 text-xs text-white/50">Connecting to PassWisely…</p>
        </div>
      </div>
    );
  }

  if (!account) {
    return (
      <><CaptureRecovery /><AuthPage
        initialError={accountError}
        onAuthenticated={(user) => {
          setAccount(user);
          setCredits(user.credits);
          setAccountError("");
        }}
      /></>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ToastContext.Provider value={{ showToast }}>
          {/* Directly render the main UI; provide a default credits value */}
          <SubscribedApp
            credits={credits}
            currentLanguage={currentLanguage}
            setLanguage={setLanguage}
            currentQuery={currentQuery}
            setQuery={setQuery}
          />
          <div data-overlay-global><UpdateNotification /></div>
          <Toast
            data-overlay-interactive
            open={toastState.open}
            onOpenChange={(open) =>
              setToastState((prev) => ({ ...prev, open }))
            }
            variant={toastState.variant}
            duration={1500}
          >
            <ToastTitle>{toastState.title}</ToastTitle>
            <ToastDescription>{toastState.description}</ToastDescription>
          </Toast>
          <ToastViewport />
        </ToastContext.Provider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

export default App;
