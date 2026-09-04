import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { DevScanDialog, MOCK_STANDINS_INCLUDED } from "../devStandins";

const ScanContext = createContext<{ openScan: () => void }>({ openScan: () => undefined });

export function ScanProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const openScan = useCallback(() => {
    if (MOCK_STANDINS_INCLUDED) setOpen(true);
    else navigate("/search");
  }, [navigate]);

  const value = useMemo(() => ({ openScan }), [openScan]);

  return (
    <ScanContext.Provider value={value}>
      {children}
      {MOCK_STANDINS_INCLUDED && open && (
        <DevScanDialog
          open={open}
          onClose={() => setOpen(false)}
          onSubmit={(code) => {
            setOpen(false);
            navigate(`/search?q=${encodeURIComponent(code)}`);
          }}
        />
      )}
    </ScanContext.Provider>
  );
}

export function useScan(): { openScan: () => void } {
  return useContext(ScanContext);
}
