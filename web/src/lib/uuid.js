// crypto.randomUUID() is only exposed in secure contexts (HTTPS or
// localhost). This app is served plain HTTP over the LAN, so on every real
// device that's a false. crypto.getRandomValues() has no such restriction --
// it works in any context -- so it's the fallback everywhere.
export function uuid() {
  if (typeof crypto.randomUUID === 'function' && (typeof isSecureContext === 'undefined' || isSecureContext)) {
    return crypto.randomUUID()
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`
}
