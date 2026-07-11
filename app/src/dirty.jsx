import React, { createContext, useCallback, useContext, useState } from 'react';

// Tracks which tabs have unsaved edits so App can guard against silently
// discarding them when a conditionally-mounted tab is switched away from.
// Tabs call setDirty(tabId, bool) as their pending-change state changes and
// clear it (setDirty(tabId, false)) on save/re-read and on unmount.
const DirtyContext = createContext({
  setDirty: () => {},
  isDirty: () => false,
  isAnyDirty: false,
});

export function DirtyProvider({ children }) {
  const [dirty, setDirtyMap] = useState({}); // tabId -> true

  const setDirty = useCallback((tabId, value) => {
    setDirtyMap(m => {
      if (!!m[tabId] === !!value) return m; // no-op keeps identity stable
      const next = { ...m };
      if (value) next[tabId] = true; else delete next[tabId];
      return next;
    });
  }, []);

  const isDirty = useCallback((tabId) => !!dirty[tabId], [dirty]);
  const isAnyDirty = Object.keys(dirty).length > 0;

  return (
    <DirtyContext.Provider value={{ setDirty, isDirty, isAnyDirty }}>
      {children}
    </DirtyContext.Provider>
  );
}

export function useDirty() {
  return useContext(DirtyContext);
}
