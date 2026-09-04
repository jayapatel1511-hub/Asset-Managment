import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export interface Chrome {
  title?: string;
  subtitle?: string;
}

const PageChromeContext = createContext<{
  chrome: Chrome;
  setChrome: (next: Chrome) => void;
}>({ chrome: {}, setChrome: () => undefined });

export function PageChromeProvider({ children }: { children: ReactNode }) {
  const [chrome, setChrome] = useState<Chrome>({});
  const value = useMemo(() => ({ chrome, setChrome }), [chrome]);
  return <PageChromeContext.Provider value={value}>{children}</PageChromeContext.Provider>;
}

/** A screen publishes the header title/subtitle for as long as it is mounted. */
export function usePageChrome(chrome: Chrome): void {
  const { setChrome } = useContext(PageChromeContext);
  useEffect(() => {
    setChrome(chrome);
    return () => setChrome({});
  }, [chrome.title, chrome.subtitle, setChrome]);
}

export function useChrome(): Chrome {
  return useContext(PageChromeContext).chrome;
}
