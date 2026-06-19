/**
 * Minimal observable state store for the showcase.
 *
 * Vanilla-TS pattern (~45 lines): a `get / set / subscribe` surface with
 * synchronous fan-out to listeners. Sections subscribe to slices of state
 * and re-render their own canvas + snippet in response. No framework, no
 * reactivity graph, no batching — the showcase is small enough that the
 * synchronous fan-out is plenty fast.
 *
 * Mirrors the proposal §3 store pattern. Lives at the showcase layer (not
 * in the library) because this is presentation state, not simulation state.
 */

type Listener<T> = (state: T, prev: T) => void;

export interface Store<T> {
  /** Read the current state. The returned object is the live state — do not mutate. */
  get(): T;
  /** Merge a partial update into the state and synchronously notify listeners. */
  set(partial: Partial<T>): void;
  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(listener: Listener<T>): () => void;
}

/**
 * Create an observable store with shallow-merge updates.
 *
 * @param initial - starting state (a defensive shallow copy is taken)
 * @returns the store handle
 *
 * @example
 * ```ts
 * const store = createStore<{ seed: number }>({ seed: 1 });
 * const unsub = store.subscribe((s) => console.log('seed now', s.seed));
 * store.set({ seed: 2 }); // → "seed now 2"
 * unsub();
 * ```
 */
export function createStore<T extends object>(initial: T): Store<T> {
  let state = { ...initial };
  const listeners = new Set<Listener<T>>();

  return {
    get: () => state,
    set(partial) {
      const prev = state;
      state = { ...state, ...partial };
      for (const fn of listeners) fn(state, prev);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
