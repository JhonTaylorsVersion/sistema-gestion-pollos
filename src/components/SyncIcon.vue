<script setup>
import { computed } from "vue";

/**
 * Componente centralizado para los iconos de estado de sincronización.
 * Garantiza que el diseño sea consistente en toda la aplicación.
 */
const props = defineProps({
  // 'not-linked' | 'offline' | 'loading' | 'error' | 'pending' | 'success'
  status: {
    type: String,
    required: true,
  },
  size: {
    type: [Number, String],
    default: 22,
  },
  showTooltip: {
    type: Boolean,
    default: false,
  },
  tooltipText: {
    type: String,
    default: "",
  },
});

const sizePx = computed(() => `${props.size}px`);
</script>

<template>
  <div
    class="sync-icon-container"
    :style="{ width: sizePx, height: sizePx }"
    :title="showTooltip ? tooltipText : null"
  >
    <!-- 1. NO VINCULADO (Drive con Slash) -->
    <svg
      v-if="status === 'not-linked'"
      class="sync-icon-status disconnected"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      :style="{ width: sizePx, height: sizePx }"
    >
      <path
        d="M12.01 1.485c-2.082 0-3.754.02-3.743.047.01.02 1.708 3.001 3.774 6.62l3.76 6.574h3.76c2.081 0 3.753-.02 3.742-.047-.005-.02-1.708-3.001-3.775-6.62l-3.76-6.574zm-4.76 1.73a789.828 789.861 0 0 0-3.63 6.319L0 15.868l1.89 3.298 1.885 3.297 3.62-6.335 3.618-6.33-1.88-3.287C8.1 4.704 7.255 3.22 7.25 3.214zm2.259 12.653-.203.348c-.114.198-.96 1.672-1.88 3.287a423.93 423.948 0 0 1-1.698 2.97c-.01.026 3.24.042 7.222.042h7.244l1.796-3.157c.992-1.734 1.85-3.23 1.906-3.323l.104-.167h-7.249z"
        fill="#94a3b8"
      />
      <line
        x1="2"
        y1="2"
        x2="22"
        y2="22"
        stroke="#64748b"
        :stroke-width="size > 40 ? 2 : 2.5"
        stroke-linecap="round"
      />
    </svg>

    <!-- 2. OFFLINE (Nube con Slash) -->
    <svg
      v-else-if="status === 'offline'"
      class="sync-icon-status offline"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      style="color: #64748b"
      :style="{ width: sizePx, height: sizePx }"
    >
      <path
        d="M22.61 16.95A5 5 0 0 0 18 10h-1.26a8 8 0 0 0-7.05-6M5 5a8 8 0 0 0 4 15h9a5 5 0 0 0 1.7-.3"
      ></path>
      <line x1="1" y1="1" x2="23" y2="23"></line>
    </svg>

    <!-- 3. LOADING (Giro) -->
    <svg
      v-else-if="status === 'loading'"
      class="sync-icon-status spin"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#3b82f6"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      :style="{ width: sizePx, height: sizePx }"
    >
      <polyline points="23 4 23 10 17 10"></polyline>
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
    </svg>

    <!-- 4. ERROR (Círculo Exclamación) -->
    <svg
      v-else-if="status === 'error'"
      class="sync-icon-status error"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#ef4444"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      :style="{ width: sizePx, height: sizePx }"
    >
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="12" y1="8" x2="12" y2="12"></line>
      <line x1="12" y1="16" x2="12.01" y2="16"></line>
    </svg>

    <!-- 5. PENDIENTE (Reloj) -->
    <svg
      v-else-if="status === 'pending'"
      class="sync-icon-status pending"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#f59e0b"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      :style="{ width: sizePx, height: sizePx }"
    >
      <circle cx="12" cy="12" r="10"></circle>
      <polyline points="12 6 12 12 16 14"></polyline>
    </svg>

    <!-- 6. ÉXITO (Check) -->
    <svg
      v-else
      class="sync-icon-status success"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#10b981"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      :style="{ width: sizePx, height: sizePx }"
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
      <polyline points="22 4 12 14.01 9 11.01"></polyline>
    </svg>
  </div>
</template>

<style scoped>
.sync-icon-container {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.spin {
  animation: sync-spin 1.5s linear infinite;
}

@keyframes sync-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
