export function getTokenFromRequestUrl(url: string | undefined): string {
  if (!url) return ''
  try {
    return new URL(url, 'ws://127.0.0.1').searchParams.get('token') ?? ''
  } catch {
    return ''
  }
}

export function isAuthorizedRequest(url: string | undefined, expectedToken: string | undefined): boolean {
  if (!expectedToken) return true
  return getTokenFromRequestUrl(url) === expectedToken
}
