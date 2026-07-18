export const PET_STATES = ['coding', 'resting', 'thinking', 'walking'] as const

export type PetState = (typeof PET_STATES)[number]

export type PetDialogue = Record<PetState, readonly string[]>

export type PetDirectorSnapshot = {
  line: string
  lineVisible: boolean
  speechRevision: number
  state: PetState
  stateRevision: number
}

export type PetDirector = {
  getSnapshot(): PetDirectorSnapshot
  setState(state: PetState): void
  speak(): void
  start(): void
  stop(): void
  subscribe(listener: (snapshot: PetDirectorSnapshot) => void): () => void
}
