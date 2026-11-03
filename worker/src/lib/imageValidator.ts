/**
 * Server-side image validator inspecting binary magic bytes / file signatures.
 * Prevents disguised files from being stored in Cloudflare R2 and guarantees
 * correct Content-Type headers upon retrieval.
 */

export interface ValidationResult {
  valid: boolean
  mimeType: string
  error?: string
}

export async function validateImageFile(file: File, maxBytes = 10 * 1024 * 1024): Promise<ValidationResult> {
  if (!file) {
    return { valid: false, mimeType: '', error: 'No image provided' }
  }

  if (file.size > maxBytes) {
    const maxMb = Math.round(maxBytes / (1024 * 1024))
    return { valid: false, mimeType: '', error: `File too large (max ${maxMb}MB)` }
  }

  if (file.size < 12) {
    return { valid: false, mimeType: '', error: 'File too small to be a valid image' }
  }

  // Inspect the first 16 bytes for magic numbers
  const headerBuffer = await file.slice(0, 16).arrayBuffer()
  const bytes = new Uint8Array(headerBuffer)

  // 1. JPEG: FF D8 FF
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
    return { valid: true, mimeType: 'image/jpeg' }
  }

  // 2. PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47 &&
    bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A
  ) {
    return { valid: true, mimeType: 'image/png' }
  }

  // 3. WebP: 'RIFF' (bytes 0-3) and 'WEBP' (bytes 8-11)
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return { valid: true, mimeType: 'image/webp' }
  }

  // 4. GIF: 'GIF87a' or 'GIF89a' (bytes 0-3: 47 49 46 38)
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return { valid: true, mimeType: 'image/gif' }
  }

  return {
    valid: false,
    mimeType: '',
    error: 'Invalid file signature (must be a valid JPEG, PNG, WebP, or GIF image)',
  }
}
