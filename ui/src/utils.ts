export function basePath() {
  const path = window.location.pathname
  const dir = path.replace(/[^/]+$/, "")
  return dir.replace(/\/+$/, "")
}

export function apiUrl( path: string ) {
  const base = (localStorage.getItem("api_base_url") || "/simplynote-api").replace(/\/$/, "");
  const tail = '/' + path.replace(/^\/+/, '')

  return `${base}${tail}`
}
