const BASE = '/api'

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  token?: string
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, { ...options, headers })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((err as any).error || res.statusText)
  }
  return res.json()
}

export async function apiUpload<T>(
  path: string,
  formData: FormData,
  token?: string
): Promise<T> {
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    body: formData,
    headers,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((err as any).error || res.statusText)
  }
  return res.json()
}

export function getWsUrl(sessionId: string, token: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = window.location.host
  return `${protocol}//${host}/api/ws/${sessionId}?token=${encodeURIComponent(token)}`
}

export function getToken(): string | null {
  return sessionStorage.getItem('gd_token')
}

export function setToken(token: string): void {
  sessionStorage.setItem('gd_token', token)
}

export function getRole(): string | null {
  return sessionStorage.getItem('gd_role')
}

export function setRole(role: string): void {
  sessionStorage.setItem('gd_role', role)
}

export function getSessionId(): string | null {
  return sessionStorage.getItem('gd_session')
}

export function setSessionId(id: string): void {
  sessionStorage.setItem('gd_session', id)
}
