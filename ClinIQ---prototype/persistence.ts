import { useEffect, useRef } from 'react';

/**
 * Kör `fn` först när `deps` har varit stilla i `delay` ms (och bara om `enabled`).
 * Används för att spara ändringar i databasen utan att skicka ett anrop per knapptryck.
 */
export function useDebouncedEffect(fn: () => void, deps: unknown[], delay: number, enabled = true) {
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => latest.current(), delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled]);
}

/**
 * Kö som kör uppgifter en i taget i den ordning de lades till, så att t.ex. "ta bort läkare"
 * alltid hinner klart innan det omräknade schemat sparas. Ett fel stoppar inte kön.
 */
export function createQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return function enqueue(task: () => Promise<unknown>, onError: (e: unknown) => void) {
    tail = tail.then(task).catch(onError);
    return tail;
  };
}
