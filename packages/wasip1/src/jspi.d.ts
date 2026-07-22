// Ambient declarations for WebAssembly JSPI (JS Promise Integration).
// Available at runtime in Chromium 126+ (new API) and Firefox 139+; the TS lib
// doesn't ship these yet, so we declare them here.
declare namespace WebAssembly {
  /** Wraps a JS import function whose return value may be a Promise. If the
   *  wrapped function returns a Promise at call time, the calling wasm suspends
   *  until the Promise resolves; if it returns a non-Promise, no suspension
   *  occurs and the value is returned directly (JSPI proposal, suspending
   *  algorithm step 5). */
  // biome-ignore lint/suspicious/noExplicitAny: JSPI generic constraint requires any[]
  const Suspending: new <T extends (...args: any[]) => unknown>(fn: T) => T;
  /** Wraps a wasm export so it returns a Promise. Paired with `Suspending`
   *  imports; the export's Promise resolves when the wrapped wasm computation
   *  finishes (which may involve one or more suspensions). */
  // biome-ignore lint/suspicious/noExplicitAny: JSPI generic constraint requires any[]
  function promising<T extends (...args: any[]) => unknown>(
    fn: T,
  ): (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>>;
}
