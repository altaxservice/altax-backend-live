import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/**
 * useState that survives leaving the page and coming back.
 *
 * List filters, sort and quick-tabs used to live in plain component state, so
 * opening a client and pressing Back rebuilt the list with DEFAULT filters — you
 * came back to a different list than the one you left, and the row you had been
 * working on often wasn't even in it. Storing that state per list (sessionStorage,
 * so it clears when the browser session ends rather than following the user
 * forever) means Back returns you to the list exactly as you had arranged it.
 *
 * Session-scoped on purpose: a filter you set this morning shouldn't still be
 * silently applied next week, hiding clients you expect to see.
 */
export function useStickyState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const storageKey = `altax_list:${key}`;

  const [value, setValue] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // Private mode / quota — remembering the filter isn't worth breaking the page.
    }
  }, [storageKey, value]);

  return [value, setValue];
}
