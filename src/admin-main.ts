import { createApp } from "vue";
import AdminApp from "./AdminApp.vue";
import "./style.css";

// Bloquear menú contextual (clic derecho) solo en producción
if (!import.meta.env.DEV) {
  document.addEventListener("contextmenu", (e) => e.preventDefault());
}

createApp(AdminApp).mount("#app");
