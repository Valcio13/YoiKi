import { nanoid } from 'nanoid'

export function newId(): string {
  return nanoid(16)
}

export function now(): number {
  return Math.floor(Date.now() / 1000)
}

export function newToken(): string {
  // 32-byte hex token
  const arr = new Uint8Array(32)
  crypto.getRandomValues(arr)
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('')
}
