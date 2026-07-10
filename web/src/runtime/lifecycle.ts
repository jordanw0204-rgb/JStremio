export function createLifecycle() {
  const reconcileCallbacks = new Set<() => void>();
  const routeCallbacks = new Set<(url: string) => void>();
  let scheduled = false;
  let lastUrl = location.href;

  const reconcile = () => {
    scheduled = false;
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      for (const callback of routeCallbacks) callback(lastUrl);
    }
    for (const callback of reconcileCallbacks) callback();
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    (window.requestAnimationFrame ?? ((callback: FrameRequestCallback) => window.setTimeout(callback, 16)))(reconcile);
  };

  const observer = new MutationObserver(schedule);
  const start = () => {
    if (document.documentElement) observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("hashchange", schedule);
    window.addEventListener("popstate", schedule);
    document.addEventListener("fullscreenchange", schedule);
    schedule();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  return {
    publicApi: {
      onReconcile(callback: () => void) {
        reconcileCallbacks.add(callback);
        schedule();
        return () => reconcileCallbacks.delete(callback);
      },
      onRouteChange(callback: (url: string) => void) {
        routeCallbacks.add(callback);
        return () => routeCallbacks.delete(callback);
      },
    },
    destroy() {
      observer.disconnect();
      window.removeEventListener("hashchange", schedule);
      window.removeEventListener("popstate", schedule);
      document.removeEventListener("fullscreenchange", schedule);
      reconcileCallbacks.clear();
      routeCallbacks.clear();
    },
  };
}
