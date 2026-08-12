/**
 * Generic Dva/UMI Redux Store Injector via React 17 Fiber Tree Traversal
 *
 * Works with ANY React app that wraps react-redux <Provider store={...}> at
 * the root level — all Dva, UMI, and ant-design-pro apps are supported.
 * Only the dispatch action, state check predicate, and redirect patterns
 * are app-specific (configured via DvaInjectConfig).
 *
 * Core mechanism:
 *   1. Walk React 17 fiber tree from #root._reactContainer$xxx via BFS
 *   2. Find the react-redux Provider's memoizedProps.store
 *   3. Dispatch the configured Dva effect via store.dispatch()
 *   4. Poll store.getState() until auth state meets the ready predicate
 */

import { Page } from "playwright";

// ── Types ────────────────────────────────────────────────────────────────

interface ReduxStore {
  dispatch(action: { type: string; payload?: unknown }): Promise<unknown>;
  getState(): Record<string, unknown>;
}

export interface DvaInjectConfig {
  /** Namespace/effect to dispatch, e.g. "user/fetchCurrentUser" */
  dispatchType: string;
  /** getState() path segments to the auth value, e.g. ["user","currentUser","id"] */
  authStatePath: string[];
  /** Returns true when the auth leaf value means "authenticated" */
  authReady: (value: unknown) => boolean;
  /** URL substrings that the auth guard redirects to (will be blocked) */
  redirectPatterns: string[];
  /** Max ms to wait for auth state */
  timeoutMs?: number;
}

// ── Presets ──────────────────────────────────────────────────────────────

export const APIFOX_INJECT_CONFIG: DvaInjectConfig = {
  dispatchType: "user/fetchCurrentUser",
  authStatePath: ["user", "currentUser", "id"],
  authReady: (v) => (v as number) > 0,
  redirectPatterns: ["/user/login", "/user/register"],
};

export const ANT_DESIGN_PRO_CONFIG: DvaInjectConfig = {
  dispatchType: "user/fetchCurrent",
  authStatePath: ["user", "currentUser", "userid"],
  authReady: (v) => typeof v === "string" && v !== "",
  redirectPatterns: ["/user/login", "/user/login-result"],
};

// ── Init script: blocks auth-guard redirects ─────────────────────────────

export function buildRedirectBlockScript(patterns: string[]): string {
  const json = JSON.stringify(patterns);
  return `
(function() {
  var P = ${json};
  var B = function(u) {
    if (!u) return false;
    var s = typeof u === 'string' ? u : String(u);
    return P.some(function(p) { return s.indexOf(p) !== -1; });
  };

  var op = history.pushState;
  history.pushState = function(s,t,u) { if (!B(u)) return op.apply(this,arguments); };

  var or_ = history.replaceState;
  history.replaceState = function(s,t,u) { if (!B(u)) return or_.apply(this,arguments); };

  var d = Object.getOwnPropertyDescriptor(Location.prototype, 'href');
  if (d&&d.set) Object.defineProperty(Location.prototype,'href',{
    set:function(u){ if(!B(u)) d.set.call(this,u); },
    get:d.get, configurable:true
  });

  var oa = Location.prototype.assign;
  Location.prototype.assign = function(u) { if(!B(u)) return oa.call(this,u); };

  var or2 = Location.prototype.replace;
  Location.prototype.replace = function(u) { if(!B(u)) return or2.call(this,u); };
})();
`;
}

// ── In-page scripts (strings sent to page.evaluate) ──────────────────────

const FIND_STORE_SCRIPT = `
(function() {
  var K = '__dva_store__';
  if (window[K]) return true;
  var root = document.getElementById('root');
  if (!root) return false;

  // React 17 stores the HostRoot fiber directly on __reactContainer$xxx
  var rk = Object.keys(root).find(function(k) {
    return k.startsWith('__reactContainer');
  });
  if (!rk) return false;

  var hostFiber = root[rk];
  if (!hostFiber) return false;

  var q = [hostFiber];
  while (q.length) {
    var f = q.shift();
    if (f.memoizedProps && f.memoizedProps.store) {
      window[K] = f.memoizedProps.store;
      return true;
    }
    if (f.child) q.push(f.child);
    if (f.sibling) q.push(f.sibling);
  }
  return false;
})();
`;

const OVERRIDE_GET_STATE_SCRIPT = `
(function() {
  var store = window.__dva_store__;
  if (!store || store.__getStateHooked) return;

  store.__origGetState = store.getState.bind(store);
  store.getState = function() {
    var state = store.__origGetState();
    if (state['@@initialState']) return state;
    var user = state.user;
    var next = {};
    for (var k in state) if (state.hasOwnProperty(k)) next[k] = state[k];
    next['@@initialState'] = {
      currentUser: user ? user.currentUser : null,
      settings: {}
    };
    return next;
  };
  store.__getStateHooked = true;
})();
`;

function buildInjectModelContextScript(user: Record<string, unknown>): string {
  const userJSON = JSON.stringify(user);
  return `
(function() {
  var USER = ${userJSON};
  var root = document.getElementById("root");
  if (!root) return JSON.stringify({ error: "no_root" });

  var rk = Object.keys(root).find(function(k) {
    return k.startsWith("__reactFiber") || k.startsWith("__reactContainer");
  });
  if (!rk) return JSON.stringify({ error: "no_fiber_key" });

  var matches = [];

  function walk(fiber, depth) {
    if (!fiber || depth > 40) return;

    var hook = fiber.memoizedState;
    var hookIdx = 0;
    while (hook) {
      var val = hook.memoizedState;
      if (val && typeof val === "object" && "initialState" in val) {
        var hasSetInit = typeof val.setInitialState === "function";
        var hasRefresh = typeof val.refresh === "function";
        var beforeInit = val.initialState;
        var beforeKeys = beforeInit ? Object.keys(beforeInit) : [];
        matches.push({
          depth: depth, hookIdx: hookIdx,
          hasSetInit: hasSetInit, hasRefresh: hasRefresh,
          hasInit: !!val.initialState, loading: val.loading,
          beforeKeys: beforeKeys,
        });

        if (hasSetInit) {
          try {
            val.setInitialState({ currentUser: USER, settings: {} });
            matches[matches.length - 1].called = true;
            // Try to verify state changed
            try {
              var afterVal = hook.memoizedState;
              var afterInit = afterVal.initialState;
              matches[matches.length - 1].afterKeys = afterInit ? Object.keys(afterInit) : [];
            } catch(vf) {
              matches[matches.length - 1].verifyError = vf.message;
            }
          } catch(e) {
            matches[matches.length - 1].error = e.message;
          }
        }

        // Also try calling refresh() to trigger getInitialState() re-fetch
        if (hasRefresh) {
          try {
            val.refresh();
            matches[matches.length - 1].refreshed = true;
          } catch(re) {
            matches[matches.length - 1].refreshError = re.message;
          }
        }
      }
      hook = hook.next;
      hookIdx++;
    }

    walk(fiber.child, depth + 1);
    walk(fiber.sibling, depth + 1);
  }

  walk(root[rk], 0);
  return JSON.stringify({
    matches: matches,
    called: matches.some(function(m) { return m.called; }),
    refreshed: matches.some(function(m) { return m.refreshed; }),
  });
})();
`;
}

function buildStateCheckScript(config: DvaInjectConfig): string {
  const pathExpr = config.authStatePath.map((s) => `["${s}"]`).join("");
  const check = config.authReady.toString();
  return `
(function() {
  var s = window.__dva_store__;
  if (!s) return false;
  var state = s.getState();
  try {
    var v = state${pathExpr};
    return (${check})(v);
  } catch(e) { return false; }
})();
`;
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Inject Dva auth state on an already-loaded page.
 *
 * Flow:
 *   1. Find Redux store via React 17 fiber tree
 *   2. Dispatch the Dva effect (e.g. "user/fetchCurrentUser")
 *   3. Wait for user state to be populated
 *   4. Override store.getState() to inject @@initialState
 *   5. Walk fiber tree to find UMI model Provider, call setInitialState
 *      on the @@initialState model's React Context (where the auth guard
 *      actually reads from, via useModel)
 *   6. Dispatch saveCurrentUser + login/changeLoginSucceeded to trigger
 *      React re-render
 */
export async function injectDvaAuth(
  page: Page,
  config: DvaInjectConfig,
  user?: Record<string, unknown>,
): Promise<boolean> {
  const timeout = config.timeoutMs ?? 15000;

  try {
    await page.waitForFunction(
      () => typeof (window as unknown as Record<string, unknown>).React !== "undefined",
      { timeout },
    );
  } catch {
    console.warn("[dva-inject] window.React not found");
    return false;
  }

  try {
    await page.waitForFunction(FIND_STORE_SCRIPT, { timeout: 5000 });
  } catch {
    console.warn("[dva-inject] Redux store not found in fiber tree");
    return false;
  }

  await page.evaluate(
    (type) => {
      const store = (window as unknown as Record<string, unknown>)
        .__dva_store__ as ReduxStore;
      store?.dispatch({ type });
    },
    config.dispatchType,
  );

  try {
    await page.waitForFunction(buildStateCheckScript(config), {
      timeout,
      polling: 200,
    });
  } catch {
    console.warn("[dva-inject] Timed out waiting for auth state");
    return false;
  }

  // Override store.getState() to inject @@initialState into Redux
  await page.evaluate(OVERRIDE_GET_STATE_SCRIPT);

  // Inject into UMI React Context (the auth guard reads from useModel, not Redux)
  if (user) {
    const contextResult = await page.evaluate(buildInjectModelContextScript(user));
    console.log("[dva-inject] Model context injection:", JSON.stringify(contextResult));
  }

  // Dispatch saveCurrentUser + login/changeLoginSucceeded to trigger re-render
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const store = w.__dva_store__ as { getState(): Record<string, unknown>; dispatch(a: { type: string; payload?: unknown }): unknown } | null;
    if (!store) return;
    const state = store.getState();
    const currentUser = (state as Record<string, unknown>).user && ((state as Record<string, unknown>).user as Record<string, unknown>).currentUser;
    store.dispatch({ type: "user/saveCurrentUser", payload: currentUser });
    store.dispatch({ type: "login/changeLoginSucceeded", payload: true });
  });

  return true;
}

/**
 * Full flow: block login redirects via addInitScript, load page, inject
 * auth state. After this, the page renders the authenticated app layout.
 */
export async function injectDvaAuthComplete(
  page: Page,
  config: DvaInjectConfig,
  user?: Record<string, unknown>,
): Promise<boolean> {
  await page.addInitScript({
    content: buildRedirectBlockScript(config.redirectPatterns),
  });

  return injectDvaAuth(page, config, user);
}
