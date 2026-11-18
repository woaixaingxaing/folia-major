// src/services/offlineGuard.ts
//
// [local-only] This build never talks to the network. Rather than trusting every call site to
// stay quiet, the four browser ways out are replaced before the app starts: fetch, XHR,
// WebSocket and sendBeacon all fail immediately. The main process blocks http(s) as well
// (electron/main.cjs), so an IPC-side request cannot slip out either.

const REASON = '[local-only] network access is disabled in this build';

type AnyFn = (...args: unknown[]) => unknown;

const blocked = (what: string) =>
  function blockedCall(this: unknown, ...args: unknown[]) {
    console.warn(REASON, what, args[0]);
    return Promise.reject(new Error(REASON));
  };

export const installOfflineGuard = (): void => {
  if (typeof window === 'undefined') return;

  // fetch
  try {
    Object.defineProperty(window, 'fetch', {
      configurable: true,
      writable: true,
      value: blocked('fetch') as unknown as typeof window.fetch,
    });
  } catch {
    /* already pinned; the main process still blocks the request */
  }

  // XMLHttpRequest
  try {
    const P = window.XMLHttpRequest?.prototype;
    if (P) {
      P.open = function offlineOpen(this: XMLHttpRequest) {
        console.warn(REASON, 'xhr', arguments[0]);
        throw new Error(REASON);
      } as AnyFn as typeof P.open;
      P.send = function offlineSend(this: XMLHttpRequest) {
        console.warn(REASON, 'xhr-send');
        throw new Error(REASON);
      } as AnyFn as typeof P.send;
    }
  } catch {
    /* ignore */
  }

  // WebSocket
  try {
    const RealWebSocket = window.WebSocket;
    if (RealWebSocket) {
      window.WebSocket = function OfflineWebSocket(this: unknown, url: string | URL) {
        console.warn(REASON, 'websocket', String(url));
        throw new Error(REASON);
      } as unknown as typeof WebSocket;
      Object.assign(window.WebSocket, RealWebSocket);
    }
  } catch {
    /* ignore */
  }

  // EventSource
  try {
    if (window.EventSource) {
      window.EventSource = function OfflineEventSource(this: unknown, url: string | URL) {
        console.warn(REASON, 'eventsource', String(url));
        throw new Error(REASON);
      } as unknown as typeof EventSource;
    }
  } catch {
    /* ignore */
  }

  // sendBeacon
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon = function offlineBeacon(url?: string | URL) {
        console.warn(REASON, 'beacon', String(url));
        return false;
      } as typeof navigator.sendBeacon;
    }
  } catch {
    /* ignore */
  }
};
