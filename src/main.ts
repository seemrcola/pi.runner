import { createApp } from 'vue'
import 'highlight.js/styles/github-dark.css'
import './assets/index.css'
import { resolveWindowRoot } from './windowRoot'

async function bootstrap() {
  const windowRoot = resolveWindowRoot(window.location.search)
  document.documentElement.dataset.window = windowRoot
  const rootComponent = windowRoot === 'pet'
    ? (await import('./features/desktop-pet/host/PetWindowApp.vue')).default
    : (await import('./App.vue')).default

  createApp(rootComponent).mount('#app')
}

void bootstrap()
