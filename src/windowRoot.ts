export type WindowRoot = 'main' | 'pet'

export function resolveWindowRoot(search: string): WindowRoot {
  const requestedRoot = new URLSearchParams(search).get('window')
  return requestedRoot === 'pet' ? 'pet' : 'main'
}
