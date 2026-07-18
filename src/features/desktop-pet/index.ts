export { default as DesktopPet } from './components/DesktopPet.vue'
export { default as PixelPetOrb } from './components/PixelPetOrb.vue'
export { createPetDirector, DEFAULT_PET_DIALOGUE } from './core/petDirector'
export { PET_STATES } from './core/petTypes'
export type {
  PetDialogue,
  PetDirector,
  PetDirectorSnapshot,
  PetState,
} from './core/petTypes'
