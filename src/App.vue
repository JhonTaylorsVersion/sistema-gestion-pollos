<script setup>
import { ref } from "vue";
import { useSheets } from "../composables/useSheets";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

const handleConfigClick = async () => {
  const existing = await WebviewWindow.getByLabel("panel-config");

  if (existing) {
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

const {
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
} = useSheets();
</script>

<template>
  <div class="page">
    <div class="tabs-bar">
      <button
        v-for="(sheet, index) in sheets"
        :key="sheet.id"
        class="tab-btn"
        :class="{ active: activeTab === index }"
        @click="irASheet(index)"
        @contextmenu="abrirMenuContextual($event, index)"
      >
        {{ sheet.nombre }}
      </button>

      <button
        class="tab-btn add-btn"
        :disabled="!puedeAgregarSheet"
        @click="addSheet"
      >
        +
      </button>

      <button
        class="tab-btn stats-btn"
        :class="{ active: activeTab === 'stats' }"
        @click="irAEstadisticas"
      >
        Estadísticas
      </button>

      <div class="tabs-actions-right">
        <button class="tab-config" @click="handleConfigClick">⚙️</button>
        <button class="tab-new-set" @click="nuevoConjunto">
          Nuevo conjunto
        </button>
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
        Eliminar hoja
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
            <strong>Código Conjunto:</strong> {{ conjunto.id }}
          </p>
          <p class="sheet-id">
            <strong>Código Galpón:</strong> {{ currentSheet.id }}
          </p>
        </div>
      </div>

      <div v-show="!tablaExpandida" class="info-grid">
        <div class="field">
          <label>Nombre del conjunto:</label>
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
          <input v-model="currentSheet.form.galpon" />
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

      <div class="actions" style="justify-content: space-between">
        <div class="format-toolbar">
          <div class="toolbar-group">
            <button
              class="tool-btn"
              @click.stop="aplicarAlineacion('h', 'left')"
              title="Alinear Izquierda"
            >
              ⫷
            </button>
            <button
              class="tool-btn"
              @click.stop="aplicarAlineacion('h', 'center')"
              title="Centrar"
            >
              ≡
            </button>
            <button
              class="tool-btn"
              @click.stop="aplicarAlineacion('h', 'right')"
              title="Alinear Derecha"
            >
              ⫸
            </button>
          </div>

          <div class="toolbar-separator"></div>

          <div class="toolbar-group">
            <button
              class="tool-btn"
              @click.stop="aplicarAlineacion('v', 'top')"
              title="Alinear Arriba"
            >
              ↑
            </button>
            <button
              class="tool-btn"
              @click.stop="aplicarAlineacion('v', 'middle')"
              title="Medio"
            >
              ↕
            </button>
            <button
              class="tool-btn"
              @click.stop="aplicarAlineacion('v', 'bottom')"
              title="Alinear Abajo"
            >
              ↓
            </button>
          </div>

          <div class="toolbar-separator"></div>

          <div class="toolbar-group">
            <button
              class="tool-btn tool-btn-wrap"
              @click.stop="aplicarAjusteTexto()"
              title="Ajustar texto"
            >
              ↵
            </button>
          </div>
        </div>

        <div style="display: flex; gap: 8px">
          <button
            type="button"
            class="btn-expand-table"
            @click="toggleTablaExpandida"
          >
            {{ tablaExpandida ? "Contraer tabla" : "Expandir tabla" }}
          </button>

          <button type="button" @click="abrirExportacion">Exportar</button>

          <button @click="guardar">Calcular / Guardar</button>
        </div>
      </div>

      <div class="table-wrapper">
        <table class="control-table">
          <thead>
            <tr>
              <th
                rowspan="2"
                data-col="semanas"
                :style="{
                  width: colWidths['semanas']
                    ? colWidths['semanas'] + 'px'
                    : 'auto',
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
                :style="{ width: colWidths[4] ? colWidths[4] + 'px' : 'auto' }"
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
                  width: colWidths[10] ? colWidths[10] + 'px' : 'auto',
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

      <div v-show="!tablaExpandida" class="summary">
        <div class="summary-left">
          <p>
            <strong>Kilos alimento consumidos:</strong>
            {{ totalAlimentoActual }}
          </p>
          <p><strong>Consumo total de gas:</strong> {{ totalGasActual }}</p>
          <p><strong>Mortalidad total:</strong> {{ totalMortalidadActual }}</p>
          <p>
            <strong>Mortalidad %:</strong>
            {{ mortalidadPorcentajeFinalActual }}%
          </p>
        </div>

        <div class="summary-right">
          <p><strong>Valor venta de los pollos:</strong> ________</p>
          <p><strong>Costo del alimento:</strong> ________</p>
          <p><strong>Costo de vacunas y medicinas:</strong> ________</p>
          <p><strong>Utilidad obtenida:</strong> ________</p>
        </div>
      </div>
    </div>

    <div v-else class="sheet stats-sheet">
      <div v-show="!tablaExpandida" class="header-top">
        <div class="logo">AVÍTALSA</div>
        <div class="title-block">
          <h1>ESTADÍSTICAS GENERALES</h1>
          <p class="sheet-id">
            <strong>Código Conjunto:</strong> {{ conjunto.id }}
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
    <div class="modal-box">
      <h3>{{ modalMensaje.titulo }}</h3>
      <p>{{ modalMensaje.texto }}</p>
      <div class="modal-actions">
        <button class="btn-primary" @click="cerrarMensaje">Aceptar</button>
      </div>
    </div>
  </div>

  <div v-if="modalConfirmacion.visible" class="modal-overlay">
    <div class="modal-box">
      <h3>{{ modalConfirmacion.titulo }}</h3>
      <p style="white-space: pre-line">{{ modalConfirmacion.texto }}</p>
      <div class="modal-actions">
        <button class="btn-secondary" @click="cerrarConfirmacion">
          Cancelar
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
    <div class="modal-box" style="position: relative">
      <h3>Exportar conjunto</h3>
      <p v-if="!exportando">
        Escoge el formato en el que deseas exportar la información del conjunto.
      </p>
      <p v-else>Se está generando el archivo, espera un momento...</p>

      <div class="modal-actions" style="flex-wrap: wrap; gap: 10px">
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
