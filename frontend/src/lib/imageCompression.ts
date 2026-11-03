/**
 * Client-side image compression and resizing utility for YoiKi.
 * Reduces Cloudflare R2 storage consumption and speeds up image transfers
 * without requiring server-side compute or paid Cloudflare services.
 */

export interface CompressionOptions {
  maxDimension: number
  quality?: number // 0 to 1 (default: 0.8)
  format?: 'image/webp' | 'image/png' | 'image/jpeg'
  preserveTransparency?: boolean
}

export const COMPRESSION_PROFILES = {
  character: {
    maxDimension: 1200,
    quality: 0.8,
    format: 'image/webp' as const,
    preserveTransparency: false,
  },
  hint: {
    maxDimension: 1000,
    quality: 0.8,
    format: 'image/webp' as const,
    preserveTransparency: false,
  },
  drawing: {
    maxDimension: 1600,
    quality: 0.9,
    format: 'image/webp' as const,
    preserveTransparency: true,
  },
}

/**
 * Check if the browser supports canvas export to WebP
 */
let webpSupported: boolean | null = null
export function isWebPSupported(): boolean {
  if (webpSupported !== null) return webpSupported
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const dataUrl = canvas.toDataURL('image/webp')
    webpSupported = dataUrl.startsWith('data:image/webp')
  } catch {
    webpSupported = false
  }
  return webpSupported
}

/**
 * Load an image File or Blob into an HTMLImageElement
 */
function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image for compression'))
    }
    img.src = url
  })
}

/**
 * Compress and resize an image file/blob.
 * 
 * Rules:
 * - Preserves aspect ratio.
 * - Does not upscale images smaller than maxDimension.
 * - If compressed file size is larger than original, returns original file.
 * - Falls back to JPEG or PNG if browser lacks WebP encoding support.
 */
export async function compressImage(
  file: File | Blob,
  options: CompressionOptions
): Promise<File> {
  const { maxDimension, quality = 0.8, preserveTransparency = false } = options
  const originalSize = file.size
  const originalName = file instanceof File ? file.name : 'image.png'
  const baseName = originalName.replace(/\.[^/.]+$/, '')

  // Load image
  let img: HTMLImageElement
  try {
    img = await loadImage(file)
  } catch {
    // If browser cannot decode image, return original file safely
    if (file instanceof File) return file
    return new File([file], originalName, { type: file.type || 'image/png' })
  }

  const { naturalWidth: width, naturalHeight: height } = img

  // Calculate new dimensions (never upscale)
  let targetWidth = width
  let targetHeight = height

  if (width > maxDimension || height > maxDimension) {
    const scale = Math.min(maxDimension / width, maxDimension / height)
    targetWidth = Math.max(1, Math.round(width * scale))
    targetHeight = Math.max(1, Math.round(height * scale))
  }

  // Determine target MIME type
  let targetMime: 'image/webp' | 'image/png' | 'image/jpeg' = options.format || 'image/webp'
  if (targetMime === 'image/webp' && !isWebPSupported()) {
    targetMime = preserveTransparency ? 'image/png' : 'image/jpeg'
  }

  // Draw onto canvas
  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    if (file instanceof File) return file
    return new File([file], originalName, { type: file.type || 'image/png' })
  }

  // For formats without transparency support, fill white background if transparent
  if (targetMime === 'image/jpeg') {
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, targetWidth, targetHeight)
  }

  // High quality image smoothing
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight)

  // Export to Blob
  const compressedBlob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob),
      targetMime,
      targetMime === 'image/png' ? undefined : quality
    )
  })

  // Cleanup canvas
  canvas.width = 0
  canvas.height = 0

  if (!compressedBlob) {
    if (file instanceof File) return file
    return new File([file], originalName, { type: file.type || 'image/png' })
  }

  // If compression resulted in larger file (e.g. tiny PNG converted to WebP), keep original!
  if (compressedBlob.size >= originalSize && targetWidth === width && targetHeight === height) {
    if (file instanceof File) return file
    return new File([file], originalName, { type: file.type || 'image/png' })
  }

  const ext = targetMime === 'image/webp' ? '.webp' : targetMime === 'image/jpeg' ? '.jpg' : '.png'
  return new File([compressedBlob], `${baseName}${ext}`, {
    type: targetMime,
    lastModified: Date.now(),
  })
}
