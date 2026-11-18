import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { certApi } from "./api.js";

const TemplatesCtx = createContext(null);
export const useTemplates = () => useContext(TemplatesCtx);

// One shared list so the sidebar, gallery and pages always agree.
export function TemplatesProvider({ children }) {
  const [templates, setTemplates] = useState(null);
  const [error, setError] = useState("");

  const reload = useCallback(
    () => certApi.templates().then((t) => { setTemplates(t); setError(""); }).catch((e) => setError(e.message)),
    []
  );
  useEffect(() => { reload(); }, [reload]);

  return <TemplatesCtx.Provider value={{ templates, error, reload }}>{children}</TemplatesCtx.Provider>;
}
