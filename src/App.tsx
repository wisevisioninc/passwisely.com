import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import SubscribedApp from "./_pages/SubscribedApp";
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
  const [currentLanguage, setCurrentLanguage] = useState<string>("python");
  const [currentQuery, setQuery] = useState<string>("");
  const [account, setAccount] = useState<DesktopAccountUser | null>(null);
  const [credits, setCredits] = useState(0);
  const [accountLoading, setAccountLoading] = useState(true);
  const [accountError, setAccountError] = useState("");

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

  if (accountLoading) {
    return (
      <div className="min-h-[320px] grid place-items-center bg-[#111018] text-white rounded-2xl border border-white/10">
        <div className="text-center">
          <div className="w-9 h-9 mx-auto rounded-xl bg-violet-500 grid place-items-center font-serif italic">P</div>
          <p className="mt-4 text-xs text-white/50">Connecting to PassWisely…</p>
        </div>
      </div>
    );
  }

  if (!account) {
    return (
      <AuthPage
        initialError={accountError}
        onAuthenticated={(user) => {
          setAccount(user);
          setCredits(user.credits);
          setAccountError("");
        }}
      />
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
            setLanguage={setCurrentLanguage}
            currentQuery={currentQuery}
            setQuery={setQuery}
          />
          <UpdateNotification />
          <Toast
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
