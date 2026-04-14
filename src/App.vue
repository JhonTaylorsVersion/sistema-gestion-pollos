<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch, watchEffect, computed } from "vue";
import { useSheets } from "./composables/useSheets";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import SyncIcon from "./components/SyncIcon.vue";

const isForceClosing = ref(false);
import { ask } from "@tauri-apps/plugin-dialog";

const handleConfigClick = async () => {
  // El panel ahora se abre inmediatamente. La sincronización puede ocurrir en segundo plano.
  const existing = await WebviewWindow.getByLabel("panel-config");

  if (existing) {
    // Si ya está abierta, la restauramos (por si está minimizada)
    await existing.unminimize();
    // La mostramos (por si estaba oculta)
    await existing.show();
    // Técnica de enfoque forzado para traerla al frente de todo
    await existing.setAlwaysOnTop(true);
    await existing.setAlwaysOnTop(false);
    // Finalmente le damos el foco
    await existing.setFocus();
    return;
  }

  const win = new WebviewWindow("panel-config", {
    title: "Panel de Control",
    url: "/admin.html",
    width: 1200,
    height: 800,
    center: true,
    resizable: true,
  });

  win.once("tauri://created", () => {
    console.log("✅ Ventana de panel creada");
  });

  win.once("tauri://error", (e) => {
    console.error("❌ Error al crear la ventana:", e);
  });
};

const vistaGalpon = ref("control"); // "control" | "consumo"
const tableWrapperRef = ref(null);

const unidadConsumo = ref("gr"); // "gr" | "kg"

const cambiarUnidadConsumo = () => {
  unidadConsumo.value = unidadConsumo.value === "gr" ? "kg" : "gr";
};

const formatearConsumo = (valor) => {
  const numero = Number(valor) || 0;

  if (unidadConsumo.value === "kg") {
    const enKg = numero / 1000;

    return enKg.toLocaleString("es-EC", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
    });
  }

  return numero.toLocaleString("es-EC", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
};

const formatearConsumoTotal = (valor) => {
  const numero = Number(valor) || 0;

  if (unidadConsumo.value === "kg") {
    const enKg = numero / 1000;

    return enKg.toLocaleString("es-EC", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2, // 👈 aquí lo limitas
    });
  }

  return numero.toLocaleString("es-EC", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
};

const etiquetaUnidadConsumo = () => {
  return unidadConsumo.value === "kg" ? "kg" : "gr";
};

const irATablaConsumo = () => {
  vistaGalpon.value = "consumo";
};

const volverATablaControl = () => {
  vistaGalpon.value = "control";
};

// 👈 Modifica esta función para recibir y pasar el evento
const cambiarASheet = (event, index) => {
  vistaGalpon.value = "control";
  irASheet(event, index);
};

const cambiarAEstadisticas = () => {
  vistaGalpon.value = "control";
  irAEstadisticas();
};

import { getCurrentWindow } from "@tauri-apps/api/window";

const {
  uploadBackup,
  isDirty,
  pasoExportacion,
  galponesAExportar,
  siguientePasoExportacion,
  todosGalponesSeleccionados,
  toggleTodosGalpones,
  selectedTabs,
  setTableWrapperRef,
  recalcularSheet,

  tablaConsumoActual,
  totalConsumoGrActual,
  totalFundasActual,
  estadoGuardado,
  esFormatoActivo,
  resetResizeCol,
  resetResizeRow,
  resizeTooltip,
  aplicarAjusteTexto,
  getEstiloTextoCelda,
  getEstiloEditorCelda,
  tablaExpandida,
  toggleTablaExpandida,
  getEstiloContenidoAlineacion,
  handleCellDoubleClick,
  bloquearSeleccionNativa,
  handleCellClick,
  editingCell,
  editingValue,
  isEditingCell,
  startCellEdit,
  handleEditableInput,
  commitCellEdit,
  cancelCellEdit,
  handleEditorKeydown,
  nuevoConjunto,
  conjunto,
  reiniciarConjunto,
  sheets,
  activeTab,
  contextMenu,
  esTabEstadisticas,
  currentSheet,
  puedeAgregarSheet,
  totalAlimentoActual,
  totalGasActual,
  totalMortalidadActual,
  mortalidadPorcentajeFinalActual,
  resumenGalpones,
  estadisticasGenerales,
  addSheet,
  irAEstadisticas,
  irASheet,
  abrirMenuContextual,
  eliminarSheet,
  handleCellMouseDown,
  handleCellMouseEnter,
  estaCeldaSeleccionada,
  obtenerClasesSeleccion,
  calcularAlimentoHasta,
  calcularGasHasta,
  calcularMortalidadHasta,
  onCantidadChange,
  guardar,
  mostrarMensaje,
  modalMensaje,
  cerrarMensaje,
  modalConfirmacion,
  confirmarAccion,
  cerrarConfirmacion,
  handleInputFocus,
  handleInputEdit,
  esCeldaUnicaSeleccionada,
  iniciarArrastreFill,
  colWidths,
  rowHeights,
  startResizeCol,
  startResizeRow,
  aplicarAlineacion,
  getEstiloAlineacion,
  modalExportacion,
  cerrarExportacion,
  abrirExportacion,
  exportarDatos,
  exportando,
  isCloudAuth,
  isCloudLoading,
  isOnline,
  syncError,
  abrirConfirmacion,
} = useSheets();

const syncStatus = computed(() => {
  if (isCloudLoading.value) return "loading";
  if (!isOnline.value) return "offline";
  if (!isCloudAuth.value) return "not-linked";
  if (syncError.value) return "error";
  return "connected";
});

const syncTooltip = computed(() => {
  if (isCloudLoading.value) return "Sincronizando con Google Drive...";
  if (!isOnline.value) return "Sin conexión a Internet";
  if (!isCloudAuth.value) return "Google Drive no vinculado";
  if (syncError.value) return `Error de sincronización: ${syncError.value}`;
  return "Sincronizado con Google Drive";
});


onMounted(async () => {
  setTableWrapperRef(tableWrapperRef);

  // Lógica de Sincronización al cerrar
  const appWindow = getCurrentWindow();
  await appWindow.onCloseRequested(async (event) => {
    if (isForceClosing.value) return;

    if (isDirty.value) {
      console.log(
        "⚠️ Cierre detectado con cambios pendientes. Sincronizando...",
      );
      event.preventDefault();

      // Mostramos una versión limpia con Spinner y sin botones
      mostrarMensaje(
        "Sincronizando con la nube",
        "El sistema se cerrará automáticamente al terminar.",
        true,
      );

      // Forzar el backup
      const success = await uploadBackup(false, true);

      if (success) {
        isDirty.value = false;
        // Mostramos el éxito antes de salir
        mostrarMensaje(
          "¡Datos asegurados!",
          "Sincronización completada con éxito. Cerrando...",
          true,
        );
        // Esperamos 0.5 segundos para que se vea el check verde
        await new Promise((resolve) => setTimeout(resolve, 500));
        cerrarMensaje();
        await appWindow.close();
      } else {
        cerrarMensaje();

        if (!isOnline.value) {
          // CASO: SIN INTERNET (Sintetizado)
          abrirConfirmacion(
            "Sin conexión a internet",
            "Datos guardados en PC.\n\nSincroniza luego abriendo la app con internet.\n\n¿Cerrar de todos modos?",
            async () => {
              isForceClosing.value = true;
              isDirty.value = false;
              await appWindow.close();
            },
            "Cerrar de todos modos",
            "Esperar conexión",
            "danger",
            false,
            "offline",
          );
        } else if (!isCloudAuth.value) {
          // CASO: SIN CUENTA VINCULADA
          abrirConfirmacion(
            "Copia de seguridad inactiva",
            "No has vinculado ninguna cuenta de Google Drive.\n\nTus datos se guardarán localmente, pero no habrá respaldo en la nube.\n\n¿Deseas cerrar el programa de todos modos?",
            async () => {
              isForceClosing.value = true;
              isDirty.value = false;
              await appWindow.close();
            },
            "Cerrar la aplicación",
            "Vincular cuenta ahora",
            "normal",
            false,
            "not-linked",
          );
        } else {
          // CASO: OTRO ERROR (Sistema/Drive)
          abrirConfirmacion(
            "Fallo de Sincronización",
            "No se pudo sincronizar la copia de seguridad en la nube debido a un error del sistema.\n\nSus cambios están guardados localmente.\n\n¿Deseas cerrar el programa de todos modos?",
            async () => {
              isForceClosing.value = true;
              isDirty.value = false;
              await appWindow.close();
            },
            "Cerrar de todos modos",
            "Reintentar luego",
            "danger",
          );
        }
      }
    }
  });

  // 🔄 RECURPERACIÓN AUTOMÁTICA (COLA DE SINCRONIZACIÓN)
  watch(isOnline, async (newOnline) => {
    // --- CASO ESPECIAL: Internet regresa mientras el modal de error offline está abierto ---
    if (
      newOnline &&
      modalConfirmacion.value.visible &&
      modalConfirmacion.value.icono === "offline"
    ) {
      console.log("🌐 Internet recuperado durante el cierre. Reintentando...");

      cerrarConfirmacion();
      mostrarMensaje(
        "¡De nuevo en línea!",
        "Sincronizando y cerrando sesión...",
        true,
      );

      const success = await uploadBackup(false, true);
      if (success) {
        isDirty.value = false;
        // Mostramos el éxito antes de salir
        mostrarMensaje(
          "¡Datos asegurados!",
          "Sincronización completada con éxito. Cerrando...",
          true,
        );
        // Esperamos 1.5 segundos para que se vea el check verde
        await new Promise((resolve) => setTimeout(resolve, 1500));
        cerrarMensaje();
        await appWindow.close();
      } else {
        cerrarMensaje();
        // Si fallara por otra razón, vuelve al error normal
      }
    }

    // --- CASO NORMAL: Cola de sync cuando internet regresa en sesión normal ---
    if (
      newOnline &&
      isDirty.value &&
      isCloudAuth.value &&
      !isCloudLoading.value &&
      !modalConfirmacion.value.visible // Que no se cruce con el caso anterior
    ) {
      console.log(
        "🌐 [Cola Sync] Internet restaurado. Sincronizando cambios pendientes...",
      );
      await uploadBackup(false);
    }
  });
});
</script>

<template>
  <div class="page">
    <div class="tabs-bar">
      <button
        v-for="(sheet, index) in sheets"
        :key="sheet.id"
        class="tab-btn"
        :class="{
          active: activeTab === index,
          'tab-selected': selectedTabs.includes(index),
        }"
        @click="cambiarASheet($event, index)"
        @contextmenu="abrirMenuContextual($event, index)"
      >
        {{ sheet.nombre }}
      </button>

      <button
        class="tab-btn add-btn"
        :disabled="!puedeAgregarSheet"
        @click="addSheet"
        title="Agregar Lote"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="3"
          style="width: 18px; height: 18px"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>

      <button
        class="tab-btn stats-btn"
        :class="{ active: activeTab === 'stats' }"
        @click="cambiarAEstadisticas"
      >
        Estadísticas
      </button>

      <div class="tabs-actions-right">
        <!-- INDICADOR DE SINCRONIZACIÓN -->
        <div class="sync-status">
          <SyncIcon 
            :status="syncStatus" 
            :size="22" 
            show-tooltip 
            :tooltip-text="syncTooltip" 
          />
        </div>

        <button
          class="tab-config"
          @click="abrirExportacion"
          title="Exportar Información"
          style="
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 0 12px;
            width: auto;
          "
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="tab-config-icon"
          >
            <path d="M12 3v11" />
            <path d="M8 10l4 4 4-4" />
            <path d="M4 17v3h16v-3" />
          </svg>
          <span style="font-size: 14px; font-weight: 500">Exportar</span>
        </button>

        <button
          class="tab-config"
          @click="handleConfigClick"
          title="Configuración"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="tab-config-icon"
          >
            <circle cx="12" cy="12" r="3"></circle>
            <path
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83
           2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33
           1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09
           a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06
           a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06
           a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3
           a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1
           1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83
           2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33h.01
           a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09
           a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06
           a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06
           a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21
           a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
            ></path>
          </svg>
        </button>

        <button class="tab-new-set" @click="nuevoConjunto">Nuevo lote</button>
      </div>
    </div>

    <div
      v-if="contextMenu.visible && sheets.length > 1"
      class="context-menu"
      :style="{
        left: `${contextMenu.x}px`,
        top: `${contextMenu.y}px`,
      }"
      @click.stop
    >
      <button class="context-menu-item danger" @click="eliminarSheet">
        Eliminar hoja{{
          selectedTabs.length > 1 && selectedTabs.includes(contextMenu.index)
            ? "s (" + selectedTabs.length + ")"
            : ""
        }}
      </button>
    </div>

    <div
      v-if="!esTabEstadisticas && currentSheet"
      class="sheet"
      :class="{ 'tabla-expandida': tablaExpandida }"
    >
      <div v-show="!tablaExpandida" class="header-top">
        <div class="logo">AVÍTALSA</div>

        <div class="title-block">
          <h1>CONTROL PARA POLLOS DE CARNE</h1>
          <p class="sheet-id">
            <strong>Código Lote:</strong> {{ conjunto.id }}
          </p>
          <p class="sheet-id">
            <strong>Código Galpón:</strong> {{ currentSheet.id }}
          </p>
        </div>
      </div>

      <div
        v-if="!tablaExpandida && vistaGalpon !== 'consumo'"
        class="info-grid"
      >
        <div class="field">
          <label>Nombre del lote:</label>
          <input v-model="conjunto.nombre" />
        </div>

        <div class="field">
          <label>Descripción del conjunto:</label>
          <input v-model="conjunto.descripcion" />
        </div>

        <div class="field">
          <label>Granja:</label>
          <input v-model="currentSheet.form.granja" />
        </div>

        <div class="field">
          <label>Fecha de ingreso:</label>
          <input v-model="currentSheet.form.fechaIngreso" type="date" />
        </div>

        <div class="field">
          <label>Lote N°:</label>
          <input v-model="currentSheet.form.lote" />
        </div>

        <div class="field">
          <label>Procedencia:</label>
          <input v-model="currentSheet.form.procedencia" />
        </div>

        <div class="field">
          <label>Galpón #:</label>
          <input v-model="currentSheet.form.galpon" class="readonly" readonly />
        </div>

        <div class="field">
          <label>Cantidad:</label>
          <input
            v-model="currentSheet.form.cantidad"
            type="number"
            @input="onCantidadChange(currentSheet)"
          />
        </div>
      </div>

      <div class="actions">
        <div class="actions-left">
          <div v-if="vistaGalpon !== 'consumo'" class="format-toolbar">
            <div class="toolbar-group">
              <button
                class="tool-btn"
                :class="{ active: esFormatoActivo('h', 'left') }"
                @click.stop="aplicarAlineacion('h', 'left')"
                title="Alinear izquierda"
                type="button"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <line x1="4" y1="6" x2="14" y2="6" />
                  <line x1="4" y1="10" x2="20" y2="10" />
                  <line x1="4" y1="14" x2="14" y2="14" />
                  <line x1="4" y1="18" x2="20" y2="18" />
                </svg>
              </button>

              <button
                class="tool-btn"
                :class="{ active: esFormatoActivo('h', 'center') }"
                @click.stop="aplicarAlineacion('h', 'center')"
                title="Centrar"
                type="button"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <line x1="7" y1="6" x2="17" y2="6" />
                  <line x1="4" y1="10" x2="20" y2="10" />
                  <line x1="7" y1="14" x2="17" y2="14" />
                  <line x1="4" y1="18" x2="20" y2="18" />
                </svg>
              </button>

              <button
                class="tool-btn"
                :class="{ active: esFormatoActivo('h', 'right') }"
                @click.stop="aplicarAlineacion('h', 'right')"
                title="Alinear derecha"
                type="button"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <line x1="10" y1="6" x2="20" y2="6" />
                  <line x1="4" y1="10" x2="20" y2="10" />
                  <line x1="10" y1="14" x2="20" y2="14" />
                  <line x1="4" y1="18" x2="20" y2="18" />
                </svg>
              </button>
            </div>

            <div class="toolbar-separator"></div>

            <div class="toolbar-group">
              <button
                class="tool-btn"
                :class="{ active: esFormatoActivo('v', 'top') }"
                @click.stop="aplicarAlineacion('v', 'top')"
                title="Alinear arriba"
                type="button"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <line x1="5" y1="5" x2="19" y2="5" />
                  <line x1="8" y1="9" x2="8" y2="17" />
                  <line x1="12" y1="9" x2="12" y2="17" />
                  <line x1="16" y1="9" x2="16" y2="17" />
                </svg>
              </button>

              <button
                class="tool-btn"
                :class="{ active: esFormatoActivo('v', 'middle') }"
                @click.stop="aplicarAlineacion('v', 'middle')"
                title="Alinear medio"
                type="button"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <line x1="8" y1="7" x2="8" y2="17" />
                  <line x1="12" y1="7" x2="12" y2="17" />
                  <line x1="16" y1="7" x2="16" y2="17" />
                </svg>
              </button>

              <button
                class="tool-btn"
                :class="{ active: esFormatoActivo('v', 'bottom') }"
                @click.stop="aplicarAlineacion('v', 'bottom')"
                title="Alinear abajo"
                type="button"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <line x1="5" y1="19" x2="19" y2="19" />
                  <line x1="8" y1="7" x2="8" y2="15" />
                  <line x1="12" y1="7" x2="12" y2="15" />
                  <line x1="16" y1="7" x2="16" y2="15" />
                </svg>
              </button>
            </div>

            <div class="toolbar-separator"></div>

            <div class="toolbar-group">
              <button
                class="tool-btn tool-btn-wrap"
                :class="{ active: esFormatoActivo('wrap') }"
                @click.stop="aplicarAjusteTexto()"
                title="Ajustar texto"
                type="button"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <line x1="4" y1="7" x2="20" y2="7" />
                  <line x1="4" y1="11" x2="14" y2="11" />
                  <path d="M14 11h2a3 3 0 0 1 0 6h-4" />
                  <polyline points="13,15 10,17 13,19" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div class="actions-right">
          <div
            v-if="estadoGuardado.tipo !== 'idle'"
            class="save-status"
            :class="estadoGuardado.tipo"
          >
            <span
              v-if="estadoGuardado.tipo.includes('exito')"
              class="icon-success"
            >
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M5 13l4 4L19 7"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </span>

            <span
              v-if="estadoGuardado.tipo.includes('error')"
              class="icon-error"
            >
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M6 6l12 12M18 6l-12 12"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                />
              </svg>
            </span>

            <span class="status-msg">{{ estadoGuardado.mensaje }}</span>
          </div>

          <button
            v-if="estadoGuardado.tipo.includes('error')"
            type="button"
            class="btn-manual-save"
            @click="guardar(true)"
          >
            Guardar
          </button>

          <div class="table-actions">
            <button
              type="button"
              class="action-btn action-btn-secondary"
              :class="{ 'is-active': tablaExpandida }"
              @click="toggleTablaExpandida"
            >
              <span class="action-btn-icon">
                <svg
                  v-if="!tablaExpandida"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path d="M8 3H3v5" />
                  <path d="M16 3h5v5" />
                  <path d="M21 16v5h-5" />
                  <path d="M3 16v5h5" />
                </svg>

                <svg v-else viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 3H3v6" />
                  <path d="M15 3h6v6" />
                  <path d="M21 15v6h-6" />
                  <path d="M3 15v6h6" />
                </svg>
              </span>

              <span>
                {{ tablaExpandida ? "Contraer tabla" : "Expandir tabla" }}
              </span>
            </button>
          </div>
        </div>
      </div>

      <div
        v-if="vistaGalpon === 'control'"
        class="table-wrapper"
        ref="tableWrapperRef"
      >
        <table class="control-table">
          <thead>
            <tr>
              <th
                rowspan="2"
                data-col="semanas"
                :style="{
                  width: colWidths['semanas']
                    ? colWidths['semanas'] + 'px'
                    : '80px',
                }"
              >
                Semanas
                <div
                  class="resizer-col"
                  @mousedown.stop.prevent="startResizeCol($event, 'semanas')"
                  @dblclick.stop.prevent="resetResizeCol('semanas')"
                ></div>
              </th>
              <th
                rowspan="2"
                data-col="dia"
                :style="{
                  width: colWidths['dia'] ? colWidths['dia'] + 'px' : 'auto',
                }"
              >
                Día
                <div
                  class="resizer-col"
                  @mousedown.stop.prevent="startResizeCol($event, 'dia')"
                  @dblclick.stop.prevent="resetResizeCol('dia')"
                ></div>
              </th>
              <th
                rowspan="2"
                data-col="0"
                :style="{ width: colWidths[0] ? colWidths[0] + 'px' : 'auto' }"
              >
                Fecha
                <div
                  class="resizer-col"
                  @mousedown.stop.prevent="startResizeCol($event, 0)"
                  @dblclick.stop.prevent="resetResizeCol(0)"
                ></div>
              </th>
              <th colspan="3">Alimentos</th>
              <th
                rowspan="2"
                data-col="4"
                :style="{ width: colWidths[4] ? colWidths[4] + 'px' : '130px' }"
              >
                Medicinas / Vacunas
                <div
                  class="resizer-col"
                  @mousedown.stop.prevent="startResizeCol($event, 4)"
                  @dblclick.stop.prevent="resetResizeCol(4)"
                ></div>
              </th>
              <th colspan="2">Consumo Gas</th>
              <th colspan="3">Mortalidad</th>
              <th
                rowspan="2"
                data-col="10"
                :style="{
                  width: colWidths[10] ? colWidths[10] + 'px' : '130px',
                }"
              >
                Observac. y Peso
                <div
                  class="resizer-col"
                  @mousedown.stop.prevent="startResizeCol($event, 10)"
                  @dblclick.stop.prevent="resetResizeCol(10)"
                ></div>
              </th>
            </tr>
            <tr>
              <th
                data-col="1"
                :style="{ width: colWidths[1] ? colWidths[1] + 'px' : 'auto' }"
              >
                Cant.
                <div
                  class="resizer-col"
                  @mousedown.stop.prevent="startResizeCol($event, 1)"
                  @dblclick.stop.prevent="resetResizeCol(1)"
                ></div>
              </th>
              <th
                data-col="2"
                :style="{ width: colWidths[2] ? colWidths[2] + 'px' : 'auto' }"
              >
                Diario
                <div
                  class="resizer-col"
                  @mousedown.stop.prevent="startResizeCol($event, 2)"
                  @dblclick.stop.prevent="resetResizeCol(2)"
                ></div>
              </th>
              <th
                data-col="3"
                :style="{ width: colWidths[3] ? colWidths[3] + 'px' : 'auto' }"
              >
                Acum.
                <div
                  class="resizer-col"
                  @mousedown.stop.prevent="startResizeCol($event, 3)"
                  @dblclick.stop.prevent="resetResizeCol(3)"
                ></div>
              </th>
              <th
                data-col="5"
                :style="{ width: colWidths[5] ? colWidths[5] + 'px' : 'auto' }"
              >
                Diario
                <div
                  class="resizer-col"
                  @mousedown.stop.prevent="startResizeCol($event, 5)"
                  @dblclick.stop.prevent="resetResizeCol(5)"
                ></div>
              </th>
              <th
                data-col="6"
                :style="{ width: colWidths[6] ? colWidths[6] + 'px' : 'auto' }"
              >
                Acum.
                <div
                  class="resizer-col"
                  @mousedown.stop.prevent="startResizeCol($event, 6)"
                  @dblclick.stop.prevent="resetResizeCol(6)"
                ></div>
              </th>
              <th
                data-col="7"
                :style="{ width: colWidths[7] ? colWidths[7] + 'px' : 'auto' }"
              >
                Diario
                <div
                  class="resizer-col"
                  @mousedown.stop.prevent="startResizeCol($event, 7)"
                  @dblclick.stop.prevent="resetResizeCol(7)"
                ></div>
              </th>
              <th
                data-col="8"
                :style="{ width: colWidths[8] ? colWidths[8] + 'px' : 'auto' }"
              >
                Acum.
                <div
                  class="resizer-col"
                  @mousedown.stop.prevent="startResizeCol($event, 8)"
                  @dblclick.stop.prevent="resetResizeCol(8)"
                ></div>
              </th>
              <th
                data-col="9"
                :style="{ width: colWidths[9] ? colWidths[9] + 'px' : 'auto' }"
              >
                %
                <div
                  class="resizer-col"
                  @mousedown.stop.prevent="startResizeCol($event, 9)"
                  @dblclick.stop.prevent="resetResizeCol(9)"
                ></div>
              </th>
            </tr>
          </thead>

          <tbody>
            <tr
              v-for="(fila, index) in currentSheet.filas"
              :key="`${currentSheet.id}-${fila.dia}`"
              :style="{
                height: rowHeights[index] ? rowHeights[index] + 'px' : 'auto',
              }"
            >
              <td v-if="fila.dia % 7 === 1" :rowspan="7">
                {{ fila.semana }}
              </td>

              <td style="position: relative">
                {{ fila.dia }}
                <div
                  class="resizer-row"
                  @mousedown.stop.prevent="startResizeRow($event, index)"
                  @dblclick.stop.prevent="resetResizeRow(index)"
                ></div>
              </td>

              <!-- FECHA -->
              <td
                :class="obtenerClasesSeleccion(index, 0)"
                :style="getEstiloAlineacion(index, 0)"
                @mousedown.left="handleCellMouseDown($event, index, 0)"
                @dblclick.left="handleCellDoubleClick($event, index, 0)"
                @mouseenter="handleCellMouseEnter($event, index, 0)"
                style="position: relative"
              >
                <div
                  class="cell-content"
                  :style="getEstiloContenidoAlineacion(index, 0)"
                >
                  <template v-if="isEditingCell(index, 0)">
                    <div
                      ref="activeEditor"
                      class="cell-editor"
                      :style="getEstiloEditorCelda(index, 0)"
                      contenteditable="true"
                      spellcheck="false"
                      @input="handleEditableInput($event, index, 0)"
                      @blur="commitCellEdit(index, 0)"
                      @keydown="handleEditorKeydown($event, index, 0)"
                    >
                      {{ fila.fecha }}
                    </div>
                  </template>
                  <template v-else>
                    <div
                      class="cell-display"
                      :style="getEstiloTextoCelda(index, 0)"
                    >
                      {{ fila.fecha }}
                    </div>
                  </template>
                </div>

                <div
                  v-if="esCeldaUnicaSeleccionada(index, 0)"
                  class="fill-handle-square"
                  @mousedown.stop.prevent="
                    iniciarArrastreFill($event, index, 0)
                  "
                ></div>
              </td>

              <!-- CANT -->
              <td
                :class="obtenerClasesSeleccion(index, 1)"
                :style="getEstiloAlineacion(index, 1)"
                @mousedown.left="handleCellMouseDown($event, index, 1)"
                @dblclick.left="handleCellDoubleClick($event, index, 1)"
                @mouseenter="handleCellMouseEnter($event, index, 1)"
                style="position: relative"
              >
                <div
                  class="cell-content"
                  :style="getEstiloContenidoAlineacion(index, 1)"
                >
                  <template v-if="isEditingCell(index, 1)">
                    <div
                      ref="activeEditor"
                      class="cell-editor"
                      :style="getEstiloEditorCelda(index, 1)"
                      contenteditable="true"
                      spellcheck="false"
                      @input="handleEditableInput($event, index, 1)"
                      @blur="commitCellEdit(index, 1)"
                      @keydown="handleEditorKeydown($event, index, 1)"
                    >
                      {{ fila.alimentoCant }}
                    </div>
                  </template>
                  <template v-else>
                    <div
                      class="cell-display"
                      :style="getEstiloTextoCelda(index, 1)"
                    >
                      {{ fila.alimentoCant }}
                    </div>
                  </template>
                </div>

                <div
                  v-if="esCeldaUnicaSeleccionada(index, 1)"
                  class="fill-handle-square"
                  @mousedown.stop.prevent="
                    iniciarArrastreFill($event, index, 1)
                  "
                ></div>
              </td>

              <!-- ALIMENTO DIARIO -->
              <td
                :class="obtenerClasesSeleccion(index, 2)"
                :style="getEstiloAlineacion(index, 2)"
                @mousedown.left="handleCellMouseDown($event, index, 2)"
                @dblclick.left="handleCellDoubleClick($event, index, 2)"
                @mouseenter="handleCellMouseEnter($event, index, 2)"
                style="position: relative"
              >
                <div
                  class="cell-content"
                  :style="getEstiloContenidoAlineacion(index, 2)"
                >
                  <template v-if="isEditingCell(index, 2)">
                    <div
                      ref="activeEditor"
                      class="cell-editor"
                      :style="getEstiloEditorCelda(index, 2)"
                      contenteditable="true"
                      spellcheck="false"
                      @input="handleEditableInput($event, index, 2)"
                      @blur="
                        commitCellEdit(index, 2, () =>
                          calcularAlimentoHasta(currentSheet, index),
                        )
                      "
                      @keydown="handleEditorKeydown($event, index, 2)"
                    >
                      {{ fila.alimentoDiario }}
                    </div>
                  </template>
                  <template v-else>
                    <div
                      class="cell-display"
                      :style="getEstiloTextoCelda(index, 2)"
                    >
                      {{ fila.alimentoDiario }}
                    </div>
                  </template>
                </div>

                <div
                  v-if="esCeldaUnicaSeleccionada(index, 2)"
                  class="fill-handle-square"
                  @mousedown.stop.prevent="
                    iniciarArrastreFill($event, index, 2)
                  "
                ></div>
              </td>

              <!-- ALIMENTO ACUM -->
              <td
                :class="obtenerClasesSeleccion(index, 3)"
                :style="getEstiloAlineacion(index, 3)"
                @mousedown.left="handleCellMouseDown($event, index, 3)"
                @mouseenter="handleCellMouseEnter($event, index, 3)"
              >
                <div
                  class="cell-content readonly-cell"
                  :style="getEstiloContenidoAlineacion(index, 3)"
                >
                  <div
                    class="cell-display"
                    :style="getEstiloTextoCelda(index, 3)"
                  >
                    {{ fila.alimentoAcum }}
                  </div>
                </div>
              </td>

              <!-- MEDICINA -->
              <td
                :class="obtenerClasesSeleccion(index, 4)"
                :style="getEstiloAlineacion(index, 4)"
                @mousedown.left="handleCellMouseDown($event, index, 4)"
                @dblclick.left="handleCellDoubleClick($event, index, 4)"
                @mouseenter="handleCellMouseEnter($event, index, 4)"
                style="position: relative"
              >
                <div
                  class="cell-content"
                  :style="getEstiloContenidoAlineacion(index, 4)"
                >
                  <template v-if="isEditingCell(index, 4)">
                    <div
                      ref="activeEditor"
                      class="cell-editor"
                      :style="getEstiloEditorCelda(index, 4)"
                      contenteditable="true"
                      spellcheck="false"
                      @input="handleEditableInput($event, index, 4)"
                      @blur="commitCellEdit(index, 4)"
                      @keydown="handleEditorKeydown($event, index, 4)"
                    >
                      {{ fila.medicina }}
                    </div>
                  </template>
                  <template v-else>
                    <div
                      class="cell-display"
                      :style="getEstiloTextoCelda(index, 4)"
                    >
                      {{ fila.medicina }}
                    </div>
                  </template>
                </div>

                <div
                  v-if="esCeldaUnicaSeleccionada(index, 4)"
                  class="fill-handle-square"
                  @mousedown.stop.prevent="
                    iniciarArrastreFill($event, index, 4)
                  "
                ></div>
              </td>

              <!-- GAS DIARIO -->
              <td
                :class="obtenerClasesSeleccion(index, 5)"
                :style="getEstiloAlineacion(index, 5)"
                @mousedown.left="handleCellMouseDown($event, index, 5)"
                @dblclick.left="handleCellDoubleClick($event, index, 5)"
                @mouseenter="handleCellMouseEnter($event, index, 5)"
                style="position: relative"
              >
                <div
                  class="cell-content"
                  :style="getEstiloContenidoAlineacion(index, 5)"
                >
                  <template v-if="isEditingCell(index, 5)">
                    <div
                      ref="activeEditor"
                      class="cell-editor"
                      :style="getEstiloEditorCelda(index, 5)"
                      contenteditable="true"
                      spellcheck="false"
                      @input="handleEditableInput($event, index, 5)"
                      @blur="
                        commitCellEdit(index, 5, () =>
                          calcularGasHasta(currentSheet, index),
                        )
                      "
                      @keydown="handleEditorKeydown($event, index, 5)"
                    >
                      {{ fila.gasDiario }}
                    </div>
                  </template>
                  <template v-else>
                    <div
                      class="cell-display"
                      :style="getEstiloTextoCelda(index, 5)"
                    >
                      {{ fila.gasDiario }}
                    </div>
                  </template>
                </div>

                <div
                  v-if="esCeldaUnicaSeleccionada(index, 5)"
                  class="fill-handle-square"
                  @mousedown.stop.prevent="
                    iniciarArrastreFill($event, index, 5)
                  "
                ></div>
              </td>

              <!-- GAS ACUM -->
              <td
                :class="obtenerClasesSeleccion(index, 6)"
                :style="getEstiloAlineacion(index, 6)"
                @mousedown.left="handleCellMouseDown($event, index, 6)"
                @mouseenter="handleCellMouseEnter($event, index, 6)"
              >
                <div
                  class="cell-content readonly-cell"
                  :style="getEstiloContenidoAlineacion(index, 6)"
                >
                  <div
                    class="cell-display"
                    :style="getEstiloTextoCelda(index, 6)"
                  >
                    {{ fila.gasAcum }}
                  </div>
                </div>
              </td>

              <!-- MORT DIARIA -->
              <td
                :class="obtenerClasesSeleccion(index, 7)"
                :style="getEstiloAlineacion(index, 7)"
                @mousedown.left="handleCellMouseDown($event, index, 7)"
                @dblclick.left="handleCellDoubleClick($event, index, 7)"
                @mouseenter="handleCellMouseEnter($event, index, 7)"
                style="position: relative"
              >
                <div
                  class="cell-content"
                  :style="getEstiloContenidoAlineacion(index, 7)"
                >
                  <template v-if="isEditingCell(index, 7)">
                    <div
                      ref="activeEditor"
                      class="cell-editor"
                      :style="getEstiloEditorCelda(index, 7)"
                      contenteditable="true"
                      spellcheck="false"
                      @input="handleEditableInput($event, index, 7)"
                      @blur="
                        commitCellEdit(index, 7, () =>
                          calcularMortalidadHasta(currentSheet, index),
                        )
                      "
                      @keydown="handleEditorKeydown($event, index, 7)"
                    >
                      {{ fila.mortDiaria }}
                    </div>
                  </template>
                  <template v-else>
                    <div
                      class="cell-display"
                      :style="getEstiloTextoCelda(index, 7)"
                    >
                      {{ fila.mortDiaria }}
                    </div>
                  </template>
                </div>

                <div
                  v-if="esCeldaUnicaSeleccionada(index, 7)"
                  class="fill-handle-square"
                  @mousedown.stop.prevent="
                    iniciarArrastreFill($event, index, 7)
                  "
                ></div>
              </td>

              <!-- MORT ACUM -->
              <td
                :class="obtenerClasesSeleccion(index, 8)"
                :style="getEstiloAlineacion(index, 8)"
                @mousedown.left="handleCellMouseDown($event, index, 8)"
                @mouseenter="handleCellMouseEnter($event, index, 8)"
              >
                <div
                  class="cell-content readonly-cell"
                  :style="getEstiloContenidoAlineacion(index, 8)"
                >
                  <div
                    class="cell-display"
                    :style="getEstiloTextoCelda(index, 8)"
                  >
                    {{ fila.mortAcum }}
                  </div>
                </div>
              </td>

              <!-- MORT % -->
              <td
                :class="obtenerClasesSeleccion(index, 9)"
                :style="getEstiloAlineacion(index, 9)"
                @mousedown.left="handleCellMouseDown($event, index, 9)"
                @mouseenter="handleCellMouseEnter($event, index, 9)"
              >
                <div
                  class="cell-content readonly-cell"
                  :style="getEstiloContenidoAlineacion(index, 9)"
                >
                  <div
                    class="cell-display"
                    :style="getEstiloTextoCelda(index, 9)"
                  >
                    {{ fila.mortPorcentaje }}
                  </div>
                </div>
              </td>

              <!-- OBSERVACION -->
              <td
                :class="obtenerClasesSeleccion(index, 10)"
                :style="getEstiloAlineacion(index, 10)"
                @mousedown.left="handleCellMouseDown($event, index, 10)"
                @dblclick.left="handleCellDoubleClick($event, index, 10)"
                @mouseenter="handleCellMouseEnter($event, index, 10)"
                style="position: relative"
              >
                <div
                  class="cell-content"
                  :style="getEstiloContenidoAlineacion(index, 10)"
                >
                  <template v-if="isEditingCell(index, 10)">
                    <div
                      ref="activeEditor"
                      class="cell-editor"
                      :style="getEstiloEditorCelda(index, 10)"
                      contenteditable="true"
                      spellcheck="false"
                      @input="handleEditableInput($event, index, 10)"
                      @blur="commitCellEdit(index, 10)"
                      @keydown="handleEditorKeydown($event, index, 10)"
                    >
                      {{ fila.observacion }}
                    </div>
                  </template>
                  <template v-else>
                    <div
                      class="cell-display"
                      :style="getEstiloTextoCelda(index, 10)"
                    >
                      {{ fila.observacion }}
                    </div>
                  </template>
                </div>

                <div
                  v-if="esCeldaUnicaSeleccionada(index, 10)"
                  class="fill-handle-square"
                  @mousedown.stop.prevent="
                    iniciarArrastreFill($event, index, 10)
                  "
                ></div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div
        v-if="!tablaExpandida && vistaGalpon === 'control'"
        class="view-nav-actions"
      >
        <button
          type="button"
          class="action-btn action-btn-primary"
          @click="irATablaConsumo"
        >
          Siguiente: Tabla de consumo
        </button>
      </div>

      <div v-if="vistaGalpon === 'consumo'" class="food-table-section">
        <div class="food-table-header">
          <div class="food-table-header-left">
            <h3>Tabla de consumo de alimento</h3>

            <div class="unit-switcher">
              <span class="unit-label">Unidad:</span>
              <button
                type="button"
                class="unit-btn"
                @click="cambiarUnidadConsumo"
              >
                {{ etiquetaUnidadConsumo() }}
              </button>
            </div>
          </div>

          <button
            type="button"
            class="action-btn action-btn-secondary"
            @click="volverATablaControl"
          >
            Anterior: Tabla del galpón
          </button>
        </div>

        <div class="table-wrapper food-table-wrapper food-table-wrapper--fit">
          <table class="control-table food-table">
            <thead>
              <tr>
                <th>Semana</th>
                <th>Día</th>
                <th>Fecha</th>
                <th>Cantidad de Pollos</th>
                <th>Consumo Individual [{{ etiquetaUnidadConsumo() }}]</th>
                <th>Consumo Total [{{ etiquetaUnidadConsumo() }}]</th>
                <th>Fundas</th>
              </tr>
            </thead>

            <tbody>
              <tr
                v-for="(fila, index) in tablaConsumoActual"
                :key="`consumo-${currentSheet.id}-${fila.dia}`"
              >
                <td
                  v-if="fila.dia % 7 === 1"
                  :rowspan="7"
                  style="vertical-align: middle"
                >
                  {{ fila.semana }}
                </td>

                <td>
                  <div
                    class="cell-content readonly-cell"
                    style="justify-content: center"
                  >
                    <div class="cell-display" style="justify-content: center">
                      {{ fila.dia }}
                    </div>
                  </div>
                </td>

                <td>
                  <div
                    class="cell-content readonly-cell"
                    style="justify-content: center"
                  >
                    <div class="cell-display" style="justify-content: center">
                      {{ fila.fecha }}
                    </div>
                  </div>
                </td>

                <td>
                  <div
                    class="cell-content readonly-cell"
                    style="justify-content: center"
                  >
                    <div class="cell-display" style="justify-content: center">
                      {{ fila.cantidadPollos }}
                    </div>
                  </div>
                </td>

                <td
                  :class="obtenerClasesSeleccion(index, 2)"
                  :style="getEstiloAlineacion(index, 2)"
                  @mousedown.left="handleCellMouseDown($event, index, 2)"
                  @dblclick.left="handleCellDoubleClick($event, index, 2)"
                  @mouseenter="handleCellMouseEnter($event, index, 2)"
                  style="position: relative; padding: 0"
                >
                  <div
                    class="cell-content"
                    :style="getEstiloContenidoAlineacion(index, 2)"
                  >
                    <template v-if="isEditingCell(index, 2)">
                      <div
                        ref="activeEditor"
                        class="cell-editor"
                        :style="getEstiloEditorCelda(index, 2)"
                        contenteditable="true"
                        spellcheck="false"
                        @input="handleEditableInput($event, index, 2)"
                        @blur="
                          commitCellEdit(index, 2, () =>
                            calcularAlimentoHasta(currentSheet, index),
                          )
                        "
                        @keydown="handleEditorKeydown($event, index, 2)"
                      >
                        {{ fila.consumoIndividualGr }}
                      </div>
                    </template>

                    <template v-else>
                      <div
                        class="cell-display"
                        :style="getEstiloTextoCelda(index, 2)"
                      >
                        {{ formatearConsumo(fila.consumoIndividualGr) }}
                      </div>
                    </template>
                  </div>

                  <div
                    v-if="esCeldaUnicaSeleccionada(index, 2)"
                    class="fill-handle-square"
                    @mousedown.stop.prevent="
                      iniciarArrastreFill($event, index, 2)
                    "
                  ></div>
                </td>

                <td>
                  <div
                    class="cell-content readonly-cell"
                    style="justify-content: center"
                  >
                    <div class="cell-display" style="justify-content: center">
                      {{ formatearConsumoTotal(fila.consumoTotalGr) }}
                    </div>
                  </div>
                </td>

                <td>
                  <div
                    class="cell-content readonly-cell"
                    style="justify-content: center"
                  >
                    <div class="cell-display" style="justify-content: center">
                      {{ fila.fundas }}
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- ✅ AHORA EL RESUMEN ABAJO -->
        <div v-if="!tablaExpandida" class="summary">
          <div class="summary-left">
            <p>
              <strong>Total consumo individual acumulado:</strong>
              {{ totalAlimentoActual }}
            </p>
            <p><strong>Consumo total de gas:</strong> {{ totalGasActual }}</p>
            <p>
              <strong>Mortalidad total:</strong> {{ totalMortalidadActual }}
            </p>
            <p>
              <strong>Mortalidad %:</strong>
              {{ mortalidadPorcentajeFinalActual }}%
            </p>
            <p>
              <strong
                >Consumo total alimento [{{ etiquetaUnidadConsumo() }}]:</strong
              >
              {{ formatearConsumo(totalConsumoGrActual) }}
            </p>
            <p>
              <strong>Total fundas:</strong>
              {{ totalFundasActual }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="sheet stats-sheet">
      <div v-show="!tablaExpandida" class="header-top">
        <div class="logo">AVÍTALSA</div>
        <div class="title-block">
          <h1>ESTADÍSTICAS GENERALES</h1>
          <p class="sheet-id">
            <strong>Código Lote:</strong> {{ conjunto.id }}
          </p>
          <p class="sheet-id"><strong>Nombre:</strong> {{ conjunto.nombre }}</p>
          <p class="sheet-id">
            <strong>Resumen consolidado de hasta 5 galpones</strong>
          </p>
        </div>
      </div>

      <div class="stats-cards">
        <div class="stat-card">
          <h3>Total galpones</h3>
          <p>{{ estadisticasGenerales.totalGalpones }}</p>
        </div>

        <div class="stat-card">
          <h3>Total pollos ingresados</h3>
          <p>{{ estadisticasGenerales.totalCantidad }}</p>
        </div>

        <div class="stat-card">
          <h3>Total alimento</h3>
          <p>{{ estadisticasGenerales.totalAlimento }}</p>
        </div>

        <div class="stat-card">
          <h3>Total gas</h3>
          <p>{{ estadisticasGenerales.totalGas }}</p>
        </div>

        <div class="stat-card">
          <h3>Total mortalidad</h3>
          <p>{{ estadisticasGenerales.totalMortalidad }}</p>
        </div>

        <div class="stat-card">
          <h3>% mortalidad general</h3>
          <p>{{ estadisticasGenerales.porcentajeMortalidad }}%</p>
        </div>
      </div>

      <div class="table-wrapper">
        <table class="control-table stats-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Código Galpón</th>
              <th>Galpón</th>
              <th>Lote</th>
              <th>Cantidad</th>
              <th>Total Alimento</th>
              <th>Total Gas</th>
              <th>Total Mortalidad</th>
              <th>% Mortalidad</th>
            </tr>
          </thead>

          <tbody>
            <tr v-for="item in resumenGalpones" :key="item.id">
              <td>{{ item.numero }}</td>
              <td>{{ item.id }}</td>
              <td>{{ item.galpon }}</td>
              <td>{{ item.lote }}</td>
              <td>{{ item.cantidad }}</td>
              <td>{{ item.alimento }}</td>
              <td>{{ item.gas }}</td>
              <td>{{ item.mortalidad }}</td>
              <td>{{ item.porcentaje }}%</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
  <div v-if="modalMensaje.visible" class="modal-overlay">
    <div class="modal-box" style="text-align: center; max-width: 350px">
      <h3 style="margin-bottom: 20px">{{ modalMensaje.titulo }}</h3>

      <!-- ESTADO DE CARGA / SINCRONIZACIÓN -->
      <div
        v-if="modalMensaje.cargando"
        style="
          margin: 20px 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 15px;
        "
      >
        <!-- ICONO DINÁMICO SEGÚN EL TEXTO O ESTADO -->
        <SyncIcon
          v-if="modalMensaje.titulo.includes('línea') || modalMensaje.titulo.includes('nube')"
          status="loading"
          :size="56"
        />
        <SyncIcon
          v-else-if="modalMensaje.titulo.includes('éxito') || modalMensaje.titulo.includes('asegurados')"
          status="success"
          :size="56"
        />
        <SyncIcon
          v-else
          status="pending"
          :size="56"
        />

        <p style="font-weight: 500; color: #666; font-size: 1.1em">
          {{ modalMensaje.texto }}
        </p>
      </div>

      <!-- MENSAJE NORMAL -->
      <p v-else style="margin-bottom: 25px; font-size: 1.1em">
        {{ modalMensaje.texto }}
      </p>

      <div v-if="!modalMensaje.cargando" class="modal-actions">
        <button class="btn-primary" @click="cerrarMensaje">Aceptar</button>
      </div>
    </div>
  </div>

  <div v-if="modalConfirmacion.visible" class="modal-overlay">
    <div class="modal-box">
      <h3>{{ modalConfirmacion.titulo }}</h3>

      <!-- ICONO DE OFFLINE (Nube gris tachada) -->
      <div
        v-if="modalConfirmacion.icono === 'offline'"
        style="display: flex; justify-content: center; margin: 15px 0"
      >
        <SyncIcon status="offline" :size="56" />
      </div>

      <!-- ICONO DE DRIVE NO VINCULADO (NUEVO) -->
      <div
        v-if="modalConfirmacion.icono === 'not-linked'"
        style="display: flex; justify-content: center; margin: 15px 0"
      >
        <SyncIcon status="not-linked" :size="64" />
      </div>

      <p style="white-space: pre-line">{{ modalConfirmacion.texto }}</p>

      <div
        v-if="modalConfirmacion.mostrarEstadoGuardado"
        style="
          margin: 15px 0;
          padding: 12px;
          background: #f8f9fa;
          border-radius: 6px;
          border: 1px solid #ddd;
        "
      >
        <p style="margin: 0 0 10px 0; font-size: 0.9em; color: #555">
          Estado del lote actual:
        </p>

        <div
          style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap"
        >
          <div
            class="save-status"
            :class="estadoGuardado.tipo"
            style="margin: 0; position: static"
          >
            <span
              v-if="
                estadoGuardado.tipo.includes('exito') ||
                estadoGuardado.tipo === 'idle'
              "
              class="icon-success"
              style="color: #2e7d32"
            >
              <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
                <path
                  d="M5 13l4 4L19 7"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </span>

            <span
              v-if="estadoGuardado.tipo.includes('error')"
              class="icon-error"
              style="color: #d32f2f"
            >
              <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
                <path
                  d="M6 6l12 12M18 6l-12 12"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                />
              </svg>
            </span>

            <span
              class="status-msg"
              style="font-weight: bold"
              :style="{
                color: estadoGuardado.tipo.includes('error')
                  ? '#d32f2f'
                  : '#2e7d32',
              }"
            >
              {{
                estadoGuardado.tipo === "idle"
                  ? "Trabajo guardado correctamente"
                  : estadoGuardado.mensaje
              }}
            </span>
          </div>

          <button
            v-if="estadoGuardado.tipo.includes('error')"
            type="button"
            class="btn-manual-save"
            @click="guardar(true)"
            style="margin-left: auto"
          >
            Guardar manual
          </button>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn-secondary" @click="cerrarConfirmacion">
          {{ modalConfirmacion.textoCancelar }}
        </button>

        <button
          :class="[
            modalConfirmacion.tipo === 'danger' ? 'btn-danger' : 'btn-primary',
          ]"
          @click="confirmarAccion"
        >
          {{ modalConfirmacion.textoConfirmar }}
        </button>
      </div>
    </div>
  </div>

  <div v-if="modalExportacion.visible" class="modal-overlay">
    <div class="modal-box" style="position: relative; min-width: 400px">
      <h3>Exportar conjunto</h3>

      <div v-if="pasoExportacion === 1">
        <p>Selecciona los galpones que deseas incluir en el reporte:</p>

        <div
          style="
            max-height: 200px;
            overflow-y: auto;
            margin: 15px 0;
            border: 1px solid #ddd;
            padding: 15px;
            border-radius: 6px;
            background: #fafafa;
          "
        >
          <label
            style="
              display: flex;
              align-items: center;
              gap: 8px;
              margin-bottom: 10px;
              cursor: pointer;
            "
          >
            <input
              type="checkbox"
              @change="toggleTodosGalpones"
              :checked="todosGalponesSeleccionados"
            />
            <strong>Todo el Lote</strong>
          </label>
          <hr style="border: 0; border-top: 1px solid #ddd; margin: 10px 0" />
          <label
            v-for="(sheet, index) in sheets"
            :key="sheet.id"
            style="
              display: flex;
              align-items: center;
              gap: 8px;
              margin-bottom: 8px;
              cursor: pointer;
            "
          >
            <input type="checkbox" v-model="galponesAExportar" :value="index" />
            {{ sheet.nombre }} ({{ sheet.id }})
          </label>
        </div>

        <div class="modal-actions">
          <button class="btn-secondary" @click="cerrarExportacion">
            Cancelar
          </button>
          <button
            class="btn-primary"
            :disabled="galponesAExportar.length === 0"
            @click="siguientePasoExportacion"
          >
            Siguiente
          </button>
        </div>
      </div>

      <div v-else-if="pasoExportacion === 2">
        <p v-if="!exportando">
          Se exportarán
          <strong>{{ galponesAExportar.length }}</strong> galpón(es). Escoge el
          formato:
        </p>
        <p v-else>Se está generando el archivo, espera un momento...</p>

        <div
          class="modal-actions"
          style="flex-wrap: wrap; gap: 10px; margin-top: 20px"
        >
          <button
            class="btn-primary"
            :disabled="exportando"
            @click="exportarDatos('pdf')"
          >
            {{ exportando ? "Exportando..." : "PDF" }}
          </button>

          <button
            class="btn-primary"
            :disabled="exportando"
            @click="exportarDatos('excel')"
          >
            {{ exportando ? "Exportando..." : "Excel" }}
          </button>

          <button
            class="btn-primary"
            :disabled="exportando"
            @click="exportarDatos('ambas')"
          >
            {{ exportando ? "Exportando..." : "PDF + Excel (ZIP)" }}
          </button>

          <div style="flex-basis: 100%; height: 0"></div>
          <button
            class="btn-secondary"
            :disabled="exportando"
            @click="pasoExportacion = 1"
          >
            Atrás
          </button>

          <button
            class="btn-secondary"
            :disabled="exportando"
            @click="cerrarExportacion"
          >
            Cancelar
          </button>
        </div>

        <div v-if="exportando" class="export-loading-overlay">
          <div class="export-loading-box">
            <div class="export-spinner"></div>
            <p>Exportando archivo...</p>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div
    v-if="resizeTooltip.visible"
    :style="{
      position: 'fixed',
      left: resizeTooltip.x + 'px',
      top: resizeTooltip.y + 'px',
      backgroundColor: '#333',
      color: '#fff',
      padding: '4px 8px',
      borderRadius: '4px',
      fontSize: '12px',
      fontWeight: 'bold',
      pointerEvents: 'none',
      zIndex: 9999,
      boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
    }"
  >
    {{ resizeTooltip.text }}
  </div>
</template>
