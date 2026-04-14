import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import './assets/styles.css'
// Bloquear menú contextual (clic derecho) solo en producción
if (!import.meta.env.DEV) {
  document.addEventListener('contextmenu', e => e.preventDefault());
}

createApp(App).mount('#app')
