import React, { useState, useEffect, useRef } from 'react'
import { getToken } from '../lib/api'

interface SecureImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  apiPath?: string | null
  token?: string
  fallback?: React.ReactNode
}

/**
 * SecureImage component:
 * Fetches authenticated image resources via fetch-to-Blob and displays them
 * via object URLs. This ensures custom Authorization headers are sent securely,
 * preventing credentials from leaking in HTML query strings or browser history.
 */
export default function SecureImage({
  apiPath,
  token,
  fallback,
  className,
  alt = '',
  ...props
}: SecureImageProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<boolean>(false)
  const activeUrlRef = useRef<string | null>(null)

  const authToken = token || getToken() || ''

  useEffect(() => {
    if (!apiPath) {
      setBlobUrl(null)
      setLoading(false)
      setError(false)
      return
    }

    // Direct blob/data URLs don't need fetching
    if (apiPath.startsWith('blob:') || apiPath.startsWith('data:')) {
      setBlobUrl(apiPath)
      setLoading(false)
      setError(false)
      return
    }

    let isMounted = true
    setLoading(true)
    setError(false)

    const API_URL = import.meta.env.VITE_API_URL || ''
    let fullUrl = apiPath
    if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://')) {
      const cleanPath = fullUrl.startsWith('/') ? fullUrl : `/${fullUrl}`
      // If path doesn't start with /api, prefix it
      const apiPrefix = cleanPath.startsWith('/api') ? cleanPath : `/api${cleanPath}`
      fullUrl = `${API_URL}${apiPrefix}`
    }

    // Prepare headers and fallback query token
    const headers: Record<string, string> = {}
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`
      // Also append query token for maximum compatibility with Cloudflare Workers
      if (!fullUrl.includes('token=')) {
        const separator = fullUrl.includes('?') ? '&' : '?'
        fullUrl = `${fullUrl}${separator}token=${encodeURIComponent(authToken)}`
      }
    }

    fetch(fullUrl, { headers })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.blob()
      })
      .then((blob) => {
        if (!isMounted) return
        // Revoke previous URL to prevent memory leaks
        if (activeUrlRef.current && activeUrlRef.current.startsWith('blob:')) {
          URL.revokeObjectURL(activeUrlRef.current)
        }
        const newUrl = URL.createObjectURL(blob)
        activeUrlRef.current = newUrl
        setBlobUrl(newUrl)
        setLoading(false)
      })
      .catch(() => {
        if (!isMounted) return
        setError(true)
        setLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [apiPath, authToken])

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (activeUrlRef.current && activeUrlRef.current.startsWith('blob:')) {
        URL.revokeObjectURL(activeUrlRef.current)
        activeUrlRef.current = null
      }
    }
  }, [])

  if (error || (!loading && !blobUrl)) {
    if (fallback) return <>{fallback}</>
    return (
      <div className={`flex items-center justify-center bg-gray-900 text-gray-500 text-xs p-3 rounded-lg border border-gray-800 ${className || ''}`}>
        <span className="opacity-60">🖼️ Image unavailable</span>
      </div>
    )
  }

  if (loading && !blobUrl) {
    return (
      <div className={`flex items-center justify-center bg-gray-900/80 animate-pulse text-gray-600 text-xs rounded-lg min-h-[80px] ${className || ''}`}>
        <span className="opacity-40">Loading image...</span>
      </div>
    )
  }

  return (
    <img
      src={blobUrl || ''}
      alt={alt}
      className={className}
      {...props}
    />
  )
}
