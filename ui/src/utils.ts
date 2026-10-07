export function basePath() {
  const base = window.__SIMPLYNOTE_CONFIG__?.uiBasePath ?? document.baseURI;
  return new URL(base, window.location.origin).pathname.replace(/\/+$/, "");
}

export function defaultApiBaseUrl() {
  return window.__SIMPLYNOTE_CONFIG__?.apiBasePath ?? "/simplynote-api";
}

export function apiUrl(path: string) {
  const base = (localStorage.getItem("api_base_url") || defaultApiBaseUrl()).replace(/\/+$/, "");
  const tail = '/' + path.replace(/^\/+/, '');
  return `${base}${tail}`;
}
