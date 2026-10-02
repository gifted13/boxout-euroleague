// ============================================================================
// Minimal hash router. Routes are registered as "/teams/:code" style patterns.
// ============================================================================

const routes = [];
let notFoundHandler = () => {};
let beforeEach = null;
let afterEach = null;

export function route(pattern, handler) {
  const paramNames = [];
  const regex = new RegExp('^' + pattern.replace(/:[^/]+/g, (m) => { paramNames.push(m.slice(1)); return '([^/]+)'; }) + '$');
  routes.push({ regex, paramNames, handler });
}
export function notFound(handler) { notFoundHandler = handler; }
export function onBeforeNavigate(fn) { beforeEach = fn; }
export function onAfterNavigate(fn) { afterEach = fn; }

function currentPath() {
  const hash = location.hash.slice(1) || '/';
  const [path] = hash.split('?');
  return path;
}
export function currentQuery() {
  const hash = location.hash.slice(1) || '/';
  const q = hash.split('?')[1];
  return new URLSearchParams(q || '');
}

async function dispatch() {
  const path = currentPath();
  if (beforeEach) beforeEach(path);
  for (const r of routes) {
    const m = path.match(r.regex);
    if (m) {
      const params = {};
      r.paramNames.forEach((name, i) => { params[name] = decodeURIComponent(m[i + 1]); });
      await r.handler(params, currentQuery());
      window.scrollTo(0, 0);
      if (afterEach) afterEach(path);
      return;
    }
  }
  notFoundHandler();
}

export function navigate(path) { location.hash = path; }
export function startRouter() {
  window.addEventListener('hashchange', dispatch);
  dispatch();
}
