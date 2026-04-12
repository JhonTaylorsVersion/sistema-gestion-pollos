import {
  ref,
  computed,
  onMounted,
  onBeforeUnmount,
  nextTick,
  watch,
} from "vue";
import Database from "@tauri-apps/plugin-sql";
import ExcelJS from "exceljs";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import JSZip from "jszip";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

export function useSheets() {
  let db = null;

  const initDB = async () => {
    if (db) return db;

    db = await Database.load("sqlite:pollos.db");

    await db.execute(`
  CREATE TABLE IF NOT EXISTS conjuntos (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    descripcion TEXT
  )
`);

    await db.execute(`
  CREATE TABLE IF NOT EXISTS sheets (
    id TEXT PRIMARY KEY,
    conjunto_id TEXT NOT NULL,
    nombre TEXT NOT NULL,
    granja TEXT,
    lote TEXT,
    galpon TEXT,
    fecha_ingreso TEXT,
    procedencia TEXT,
    cantidad INTEGER,
    FOREIGN KEY (conjunto_id) REFERENCES conjuntos(id)
  )
`);

    await db.execute(`
    CREATE TABLE IF NOT EXISTS filas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sheet_id TEXT NOT NULL,
      dia INTEGER NOT NULL,
      semana INTEGER NOT NULL,
      fecha TEXT,
      alimento_cant TEXT,
      alimento_diario REAL,
      alimento_acum REAL,
      medicina TEXT,
      gas_diario REAL,
      gas_acum REAL,
      mort_diaria REAL,
      mort_acum REAL,
      mort_porcentaje REAL,
      observacion TEXT,
      FOREIGN KEY (sheet_id) REFERENCES sheets(id)
    )
  `);

    return db;
  };

  const modalMensaje = ref({
    visible: false,
    titulo: "",
    texto: "",
  });

  const mostrarMensaje = (titulo, texto) => {
    modalMensaje.value = {
      visible: true,
      titulo,
      texto,
    };
  };

  const cerrarMensaje = () => {
    modalMensaje.value.visible = false;
  };

  const modalConfirmacion = ref({
    visible: false,
    titulo: "",
    texto: "",
    onConfirm: null,
    textoConfirmar: "Aceptar",
    tipo: "normal",
    mostrarEstadoGuardado: false,
  });

  const abrirConfirmacion = (
    titulo,
    texto,
    onConfirm,
    textoConfirmar = "Aceptar",
    tipo = "normal",
    mostrarEstadoGuardado = false,
  ) => {
    modalConfirmacion.value = {
      visible: true,
      titulo,
      texto,
      onConfirm,
      textoConfirmar,
      tipo,
      mostrarEstadoGuardado,
    };
  };

  const confirmarAccion = () => {
    if (modalConfirmacion.value.onConfirm) {
      modalConfirmacion.value.onConfirm();
    }
    cerrarConfirmacion();
  };

  const cerrarConfirmacion = () => {
    modalConfirmacion.value = {
      visible: false,
      titulo: "",
      texto: "",
      onConfirm: null,
      textoConfirmar: "Aceptar",
      tipo: "normal",
      mostrarEstadoGuardado: false,
    };
  };

  const modalExportacion = ref({
    visible: false,
  });

  const exportando = ref(false);
  const pasoExportacion = ref(1);
  const galponesAExportar = ref([]);

const abrirExportacion = () => {
    pasoExportacion.value = 1;
    // Por defecto, marcamos todos los galpones para exportar
    galponesAExportar.value = sheets.value.map((_, i) => i);
    modalExportacion.value.visible = true;
  };

  const cerrarExportacion = () => {
    if (exportando.value) return;
    modalExportacion.value.visible = false;
  };

  const siguientePasoExportacion = () => {
    if (galponesAExportar.value.length > 0) {
      pasoExportacion.value = 2;
    }
  };

  const todosGalponesSeleccionados = computed(() => {
    return sheets.value.length > 0 && galponesAExportar.value.length === sheets.value.length;
  });

  const toggleTodosGalpones = (e) => {
    if (e.target.checked) {
      galponesAExportar.value = sheets.value.map((_, i) => i);
    } else {
      galponesAExportar.value = [];
    }
  };

  const sanitizarNombreArchivo = (texto) => {
    return (texto || "exportacion")
      .toString()
      .trim()
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, "_");
  };

  const sanitizarNombreHojaExcel = (texto, fallback = "Hoja") => {
    const limpio = (texto || fallback)
      .toString()
      .replace(/[\\/*?:[\]]/g, "")
      .trim();

    return (limpio || fallback).slice(0, 31);
  };

  const descargarBlob = (contenido, nombreArchivo, mimeType) => {
    const blob = new Blob([contenido], { type: mimeType });
    saveAs(blob, nombreArchivo);
  };

  const formatearNumero = (valor) => {
    const num = Number(valor);
    return Number.isFinite(num) ? num : 0;
  };

  const recalcularTodasLasHojas = () => {
    sheets.value.forEach((sheet) => {
      recalcularSheet(sheet);
    });
  };

  const MAX_SHEETS = 6;
  const TOTAL_DIAS = 56;

  const GRAMOS_POR_FUNDA = 45000;
  const USAR_MORTALIDAD_EN_CONSUMO = false;

  const crearIdLote = (numero = 1) => {
    const fecha = new Date();

    const year = fecha.getFullYear();

    const meses = [
      "ENE",
      "FEB",
      "MAR",
      "ABR",
      "MAY",
      "JUN",
      "JUL",
      "AGO",
      "SEP",
      "OCT",
      "NOV",
      "DIC",
    ];

    const mes = meses[fecha.getMonth()];

    const numeroFormateado = String(numero).padStart(2, "0");

    return `LOTE${numeroFormateado}:${mes}-${year}`;
  };

  const conjunto = ref({
    id: crearIdLote(),
    nombre: "Lote 1",
    descripcion: "",
  });

  const crearId = (numero) => {
    const fecha = new Date();

    const year = fecha.getFullYear();

    const meses = [
      "ENE",
      "FEB",
      "MAR",
      "ABR",
      "MAY",
      "JUN",
      "JUL",
      "AGO",
      "SEP",
      "OCT",
      "NOV",
      "DIC",
    ];

    const mes = meses[fecha.getMonth()];

    const numeroFormateado = String(numero).padStart(2, "0");

    return `GAL${numeroFormateado}:${mes}-${year}`;
  };

  const crearFilasVacias = () =>
    Array.from({ length: TOTAL_DIAS }, (_, i) => ({
      dia: i + 1,
      semana: Math.floor(i / 7) + 1,
      fecha: "",
      alimentoCant: "",
      alimentoDiario: "",
      alimentoAcum: "",
      medicina: "",
      gasDiario: "",
      gasAcum: "",
      mortDiaria: "",
      mortAcum: "",
      mortPorcentaje: "",
      observacion: "",
    }));

  const crearSheetVacia = (numero) => ({
    id: crearId(numero),
    conjuntoId: conjunto.value.id,
    nombre: `Galpón ${numero}`,
    form: {
      granja: "",
      lote: "",
      galpon: numero.toString(),
      fechaIngreso: "",
      procedencia: "",
      cantidad: "",
    },
    filas: crearFilasVacias(),
  });

  const sheets = ref([crearSheetVacia(1)]);
  const activeTab = ref(0);
  const selectedTabs = ref([0]); // 👈 NUEVA VARIABLE PARA SELECCIÓN MÚLTIPLE

  const contextMenu = ref({
    visible: false,
    x: 0,
    y: 0,
    index: null,
  });

  const seleccion = ref({
    activa: false,
    arrastrando: false,
    inicio: null,
    fin: null,
  });

  const operacionPortapapeles = ref(null);
  const destinoPegado = ref(null);
  const cortePendiente = ref(null);
  const rangoPortapapeles = ref(null); // <--- ¡NUEVA VARIABLE!
  const historialDeshacer = ref([]);
  const pegadoDesdeCorte = ref(false);
  const ultimoPegado = ref(null);
  const originalSinFondo = ref(false);
  const editingCell = ref(null);
  const ventanaPerdioFoco = ref(false);
  const tablaExpandida = ref(false);
  const tableWrapperRef = ref(null);

  let fillAutoScrollFrame = null;
  let fillScrollDirection = 0; // -1 arriba, 1 abajo, 0 detenido

  const toggleTablaExpandida = () => {
    tablaExpandida.value = !tablaExpandida.value;
  };

  const setTableWrapperRef = (wrapperRef) => {
    tableWrapperRef.value = wrapperRef?.value || null;
  };

  const iniciarAutoScrollFill = () => {
    if (fillAutoScrollFrame !== null) return;

    const step = () => {
      const wrapper = tableWrapperRef.value;

      if (wrapper && fillScrollDirection !== 0) {
        wrapper.scrollTop += fillScrollDirection * 10;
      }

      fillAutoScrollFrame = requestAnimationFrame(step);
    };

    fillAutoScrollFrame = requestAnimationFrame(step);
  };

  const detenerAutoScrollFill = () => {
    fillScrollDirection = 0;

    if (fillAutoScrollFrame !== null) {
      cancelAnimationFrame(fillAutoScrollFrame);
      fillAutoScrollFrame = null;
    }
  };

  const handleMouseMoveGlobal = (event) => {
    if (!fillEstado.value.arrastrando) return;

    actualizarAutoScrollFill(event);
  };

  const actualizarAutoScrollFill = (event) => {
    const wrapper = tableWrapperRef.value;
    if (!wrapper) return;

    const rect = wrapper.getBoundingClientRect();

    const margen = 50; // zona sensible
    const velocidadMax = 25;

    let velocidad = 0;

    // 🔼 SCROLL HACIA ARRIBA (MEJORADO)
    if (event.clientY < rect.top + margen) {
      const distancia = rect.top + margen - event.clientY;
      velocidad = -Math.min(velocidadMax, distancia);
    }

    // 🔽 SCROLL HACIA ABAJO
    else if (event.clientY > rect.bottom - margen) {
      const distancia = event.clientY - (rect.bottom - margen);
      velocidad = Math.min(velocidadMax, distancia);
    }

    if (velocidad !== 0) {
      fillScrollDirection = velocidad / 10; // suaviza
      iniciarAutoScrollFill();
    } else {
      detenerAutoScrollFill();
    }
  };

  const marcarBlurVentana = () => {
    ventanaPerdioFoco.value = true;
  };

  const marcarFocusVentana = async () => {
    if (ventanaPerdioFoco.value && editingCell.value) {
      await nextTick();

      const editor = document.querySelector(".cell-editor");
      if (editor) {
        editor.focus();

        const range = document.createRange();
        const sel = window.getSelection();
        range.selectNodeContents(editor);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }

    ventanaPerdioFoco.value = false;
  };

  const editingValue = ref("");

  // --- NUEVO ESTADO PARA EL AUTORELLENO (FILL) ---
  const fillEstado = ref({
    arrastrando: false,
    origen: null, // celda donde está el cuadrito
    destino: null,
    rangoOrigen: null, // rango completo seleccionado que servirá de patrón
  });

  const iniciarArrastreFill = (event, fila, col) => {
    event.stopPropagation();
    event.preventDefault();

    // Si hay una celda en edición, la guardamos antes de iniciar el fill
    // para que el arrastre tome el valor actual y no el valor viejo/vacío.
    if (editingCell.value) {
      commitCellEdit(editingCell.value.fila, editingCell.value.col);
    }

    const rangoSeleccion = getRangoSeleccion();

    fillEstado.value.arrastrando = true;
    fillEstado.value.origen = { fila, col };
    fillEstado.value.destino = { fila, col };
    fillEstado.value.rangoOrigen = rangoSeleccion
      ? clonarRango(rangoSeleccion)
      : {
          minFila: fila,
          maxFila: fila,
          minCol: col,
          maxCol: col,
        };

    // Mantener la selección visual estable
    seleccion.value.activa = true;
    seleccion.value.arrastrando = false;
    seleccion.value.inicio = { fila, col };
    seleccion.value.fin = { fila, col };

    window.getSelection()?.removeAllRanges();
  };

  const esCeldaUnicaSeleccionada = (fila, col) => {
    const rango = getRangoSeleccion();
    if (!rango) return false;

    //  CAMBIO: Ya no exigimos que minFila y maxFila sean iguales.
    // Ahora el cuadrito aparecerá siempre en la esquina inferior derecha de TODA la selección.
    return (
      seleccion.value.activa && rango.maxFila === fila && rango.maxCol === col
    );
  };

  const ejecutarFill = () => {
    const sheet = currentSheet.value;
    const destino = fillEstado.value.destino;
    const rangoOrigen = fillEstado.value.rangoOrigen;

    if (!sheet || !destino || !rangoOrigen) return;

    const altoOrigen = rangoOrigen.maxFila - rangoOrigen.minFila + 1;
    const anchoOrigen = rangoOrigen.maxCol - rangoOrigen.minCol + 1;

    const arrastreVertical =
      destino.fila !== fillEstado.value.origen.fila &&
      destino.col === fillEstado.value.origen.col;

    const arrastreHorizontal =
      destino.col !== fillEstado.value.origen.col &&
      destino.fila === fillEstado.value.origen.fila;

    // Tomamos snapshot del bloque origen (VALOR + FORMATO)
    const bloqueOrigen = [];
    for (let f = rangoOrigen.minFila; f <= rangoOrigen.maxFila; f++) {
      const filaDatos = [];

      for (let c = rangoOrigen.minCol; c <= rangoOrigen.maxCol; c++) {
        const valor = obtenerValorActualCelda(sheet, f, c);

        //  ESTO ES LO ÚNICO QUE CAMBIA
        const formato = { ...getFormatoCelda(f, c) };

        filaDatos.push({
          valor,
          formato,
        });
      }

      bloqueOrigen.push(filaDatos);
    }

    // Fill vertical
    if (arrastreVertical) {
      const haciaAbajo = destino.fila > rangoOrigen.maxFila;
      const haciaArriba = destino.fila < rangoOrigen.minFila;

      if (haciaAbajo) {
        for (let f = rangoOrigen.maxFila + 1; f <= destino.fila; f++) {
          const offsetFila = (f - (rangoOrigen.maxFila + 1)) % altoOrigen;

          for (let c = rangoOrigen.minCol; c <= rangoOrigen.maxCol; c++) {
            if (COLUMNAS_SOLO_LECTURA.includes(c)) continue;

            const offsetCol = c - rangoOrigen.minCol;
            const celdaOrigen = bloqueOrigen[offsetFila][offsetCol];
            const valor = celdaOrigen.valor;
            const formato = celdaOrigen.formato;

            if (
              esColumnaNumerica(c) &&
              valor !== "" &&
              Number.isNaN(Number(valor))
            ) {
              continue;
            }

            const propiedad = COLUMNAS_MAP[c];
            if (propiedad) {
              sheet.filas[f][propiedad] = valor;
              cellFormats.value[`${f}-${c}`] = { ...formato };
            }
          }
        }
      }

      if (haciaArriba) {
        for (let f = destino.fila; f < rangoOrigen.minFila; f++) {
          const distanciaDesdeOrigen = rangoOrigen.minFila - 1 - f;
          const offsetFila =
            (altoOrigen - 1 - (distanciaDesdeOrigen % altoOrigen)) % altoOrigen;

          for (let c = rangoOrigen.minCol; c <= rangoOrigen.maxCol; c++) {
            if (COLUMNAS_SOLO_LECTURA.includes(c)) continue;

            const offsetCol = c - rangoOrigen.minCol;
            const celdaOrigen = bloqueOrigen[offsetFila][offsetCol];
            const valor = celdaOrigen.valor;
            const formato = celdaOrigen.formato;

            if (
              esColumnaNumerica(c) &&
              valor !== "" &&
              Number.isNaN(Number(valor))
            ) {
              continue;
            }

            const propiedad = COLUMNAS_MAP[c];
            if (propiedad) {
              sheet.filas[f][propiedad] = valor;
              cellFormats.value[`${f}-${c}`] = { ...formato };
            }
          }
        }
      }
    }

    // Fill horizontal
    if (arrastreHorizontal) {
      const haciaDerecha = destino.col > rangoOrigen.maxCol;
      const haciaIzquierda = destino.col < rangoOrigen.minCol;

      if (haciaDerecha) {
        for (let c = rangoOrigen.maxCol + 1; c <= destino.col; c++) {
          if (COLUMNAS_SOLO_LECTURA.includes(c)) continue;

          const offsetCol = (c - (rangoOrigen.maxCol + 1)) % anchoOrigen;

          for (let f = rangoOrigen.minFila; f <= rangoOrigen.maxFila; f++) {
            const offsetFila = f - rangoOrigen.minFila;
            const celdaOrigen = bloqueOrigen[offsetFila][offsetCol];
            const valor = celdaOrigen.valor;
            const formato = celdaOrigen.formato;

            if (
              esColumnaNumerica(c) &&
              valor !== "" &&
              Number.isNaN(Number(valor))
            ) {
              continue;
            }

            const propiedad = COLUMNAS_MAP[c];
            if (propiedad) {
              sheet.filas[f][propiedad] = valor;
              cellFormats.value[`${f}-${c}`] = { ...formato };
            }
          }
        }
      }

      if (haciaIzquierda) {
        for (let c = destino.col; c < rangoOrigen.minCol; c++) {
          if (COLUMNAS_SOLO_LECTURA.includes(c)) continue;

          const distanciaDesdeOrigen = rangoOrigen.minCol - 1 - c;
          const offsetCol =
            (anchoOrigen - 1 - (distanciaDesdeOrigen % anchoOrigen)) %
            anchoOrigen;

          for (let f = rangoOrigen.minFila; f <= rangoOrigen.maxFila; f++) {
            const offsetFila = f - rangoOrigen.minFila;
            const celdaOrigen = bloqueOrigen[offsetFila][offsetCol];
            const valor = celdaOrigen.valor;
            const formato = celdaOrigen.formato;

            if (
              esColumnaNumerica(c) &&
              valor !== "" &&
              Number.isNaN(Number(valor))
            ) {
              continue;
            }

            const propiedad = COLUMNAS_MAP[c];
            if (propiedad) {
              sheet.filas[f][propiedad] = valor;
              cellFormats.value[`${f}-${c}`] = { ...formato };
            }
          }
        }
      }
    }

    recalcularSheet(sheet);
  };

  const COLUMNAS_MAP = {
    0: "fecha",
    1: "alimentoCant",
    2: "alimentoDiario",
    3: "alimentoAcum",
    4: "medicina",
    5: "gasDiario",
    6: "gasAcum",
    7: "mortDiaria",
    8: "mortAcum",
    9: "mortPorcentaje",
    10: "observacion",
  };

  const COLUMNAS_SOLO_LECTURA = [3, 6, 8, 9];

  const COLUMNAS_NUMERICAS = [2, 5, 7];

  const getPropiedadColumna = (col) => COLUMNAS_MAP[col];

  const esColumnaEditable = (col) => {
    return col >= 0 && col < 11 && !COLUMNAS_SOLO_LECTURA.includes(col);
  };

  const esColumnaNumerica = (col) => COLUMNAS_NUMERICAS.includes(col);

  const clonarRango = (rango) => {
    if (!rango) return null;
    return {
      minFila: rango.minFila,
      maxFila: rango.maxFila,
      minCol: rango.minCol,
      maxCol: rango.maxCol,
    };
  };

  const obtenerDatosDeRango = (sheet, rango) => {
    const datos = [];

    for (let f = rango.minFila; f <= rango.maxFila; f++) {
      const fila = [];
      for (let c = rango.minCol; c <= rango.maxCol; c++) {
        const propiedad = COLUMNAS_MAP[c];
        fila.push(propiedad ? (sheet.filas[f][propiedad] ?? "") : "");
      }
      datos.push(fila);
    }

    return datos;
  };

  const restaurarDatosEnRango = (sheet, filaInicio, colInicio, datos) => {
    for (let i = 0; i < datos.length; i++) {
      const filaSheet = filaInicio + i;
      if (filaSheet >= sheet.filas.length) continue;

      for (let j = 0; j < datos[i].length; j++) {
        const colSheet = colInicio + j;
        if (COLUMNAS_SOLO_LECTURA.includes(colSheet)) continue;

        const propiedad = COLUMNAS_MAP[colSheet];
        if (propiedad) {
          sheet.filas[filaSheet][propiedad] = datos[i][j];
        }
      }
    }
  };

  const limpiarRango = (
    sheet,
    filaInicio,
    colInicio,
    totalFilas,
    totalCols,
  ) => {
    for (let i = 0; i < totalFilas; i++) {
      const filaSheet = filaInicio + i;
      if (filaSheet >= sheet.filas.length) continue;

      for (let j = 0; j < totalCols; j++) {
        const colSheet = colInicio + j;
        if (COLUMNAS_SOLO_LECTURA.includes(colSheet)) continue;

        const propiedad = COLUMNAS_MAP[colSheet];
        if (propiedad) {
          sheet.filas[filaSheet][propiedad] = "";
        }
      }
    }
  };

  const pushHistorial = (item) => {
    historialDeshacer.value.push(item);

    if (historialDeshacer.value.length > 50) {
      historialDeshacer.value.shift();
    }
  };

  const renombrarSheets = () => {
    sheets.value.forEach((sheet, index) => {
      sheet.nombre = `Galpón ${index + 1}`;
      if (!sheet.form.galpon || /^\d+$/.test(sheet.form.galpon)) {
        sheet.form.galpon = String(index + 1);
      }
    });
  };

  const getRangoSeleccion = () => {
    if (!seleccion.value.inicio || !seleccion.value.fin) return null;

    return {
      minFila: Math.min(seleccion.value.inicio.fila, seleccion.value.fin.fila),
      maxFila: Math.max(seleccion.value.inicio.fila, seleccion.value.fin.fila),
      minCol: Math.min(seleccion.value.inicio.col, seleccion.value.fin.col),
      maxCol: Math.max(seleccion.value.inicio.col, seleccion.value.fin.col),
    };
  };

  const convertirUltimoPegadoASeleccion = () => {
    if (!ultimoPegado.value) return false;

    seleccion.value.activa = true;
    seleccion.value.arrastrando = false;
    seleccion.value.inicio = {
      fila: ultimoPegado.value.minFila,
      col: ultimoPegado.value.minCol,
    };
    seleccion.value.fin = {
      fila: ultimoPegado.value.maxFila,
      col: ultimoPegado.value.maxCol,
    };

    return true;
  };

  const limpiarSeleccion = () => {
    seleccion.value.activa = false;
    seleccion.value.arrastrando = false;
    seleccion.value.inicio = null;
    seleccion.value.fin = null;
    destinoPegado.value = null;

    if (!pegadoDesdeCorte.value) {
      rangoPortapapeles.value = null; // <--- LIMPIAR AQUÍ
      operacionPortapapeles.value = null;
      cortePendiente.value = null;
    }
  };

  const cancelarPortapapeles = () => {
    operacionPortapapeles.value = null;
    destinoPegado.value = null;
    cortePendiente.value = null;
    rangoPortapapeles.value = null;
    pegadoDesdeCorte.value = false;
    originalSinFondo.value = false;

    // 🔥 ELIMINA O COMENTA ESTAS 4 LÍNEAS:
    // seleccion.value.activa = false;
    // seleccion.value.arrastrando = false;
    // seleccion.value.inicio = null;
    // seleccion.value.fin = null;
  };

  const estaCeldaDentroDeSeleccion = (fila, col) => {
    const rango = getRangoSeleccion();
    if (!rango) return false;

    return (
      fila >= rango.minFila &&
      fila <= rango.maxFila &&
      col >= rango.minCol &&
      col <= rango.maxCol
    );
  };

  const limpiarSeleccionSiEditaFuera = (fila, col) => {
    if (!seleccion.value.activa) return;

    if (!estaCeldaDentroDeSeleccion(fila, col)) {
      limpiarSeleccion();
    }
  };

  const handleCellMouseDown = (event, fila, col) => {
    if (event.button !== 0) return;

    // Si el usuario está editando texto dentro del editor,
    // dejamos el comportamiento nativo para mover cursor o seleccionar texto
    if (
      event.target.closest(".cell-editor") ||
      event.target.isContentEditable
    ) {
      return;
    }

    bloquearSeleccionNativa(event);

    // Si estaba editando otra celda, guardamos antes de cambiar
    if (editingCell.value && !isEditingCell(fila, col)) {
      commitCellEdit(editingCell.value.fila, editingCell.value.col);
    }

    ultimoPegado.value = null;

    // Si hay copiar/cortar activo, esta celda pasa a ser el destino visual,
    // pero el portapapeles sigue apuntando al rango original
    if (operacionPortapapeles.value) {
      destinoPegado.value = { fila, col };
    }

    // IMPORTANTE:
    // apenas hace mousedown ya queda enfocada/seleccionada,
    // sin esperar a soltar el click
    seleccion.value.activa = true;
    seleccion.value.arrastrando = true;
    seleccion.value.inicio = { fila, col };
    seleccion.value.fin = { fila, col };

    window.getSelection()?.removeAllRanges();
  };

  const handleCellMouseEnter = (event, fila, col) => {
    // CONTROL DEL ARRASTRE DEL CUADRITO (FILL)
    if (fillEstado.value.arrastrando && event.buttons === 1) {
      actualizarAutoScrollFill(event);

      const origen = fillEstado.value.origen;
      let destFila = fila;
      let destCol = col;

      // Restringir a un solo sentido
      if (Math.abs(fila - origen.fila) > Math.abs(col - origen.col)) {
        destCol = origen.col;
      } else {
        destFila = origen.fila;
      }

      fillEstado.value.destino = { fila: destFila, col: destCol };
      return;
    }

    // Selección normal por arrastre
    if (!seleccion.value.arrastrando) return;
    if (event.buttons !== 1) return;

    seleccion.value.fin = { fila, col };
  };

  const finalizarSeleccionCeldas = () => {
    detenerAutoScrollFill();

    if (
      fillEstado.value.arrastrando &&
      fillEstado.value.origen &&
      fillEstado.value.destino &&
      fillEstado.value.rangoOrigen
    ) {
      const destino = fillEstado.value.destino;
      const rangoOrigen = fillEstado.value.rangoOrigen;

      ejecutarFill();

      const minFila = Math.min(rangoOrigen.minFila, destino.fila);
      const maxFila = Math.max(rangoOrigen.maxFila, destino.fila);
      const minCol = Math.min(rangoOrigen.minCol, destino.col);
      const maxCol = Math.max(rangoOrigen.maxCol, destino.col);

      seleccion.value.activa = true;
      seleccion.value.arrastrando = false;
      seleccion.value.inicio = { fila: minFila, col: minCol };
      seleccion.value.fin = { fila: maxFila, col: maxCol };

      ultimoPegado.value = {
        minFila,
        maxFila,
        minCol,
        maxCol,
      };

      fillEstado.value.arrastrando = false;
      fillEstado.value.origen = null;
      fillEstado.value.destino = null;
      fillEstado.value.rangoOrigen = null;
      return;
    }

    if (seleccion.value.arrastrando) {
      seleccion.value.arrastrando = false;
    }
  };

  const estaCeldaSeleccionada = (fila, col) => {
    if (!seleccion.value.activa) return false;

    const rango = getRangoSeleccion();
    if (!rango) return false;

    return (
      fila >= rango.minFila &&
      fila <= rango.maxFila &&
      col >= rango.minCol &&
      col <= rango.maxCol
    );
  };

  const bloquearSeleccionNativa = (event) => {
    // ✅ NUEVO: Si el evento ocurre dentro de una celda que se está editando,
    // NO bloqueamos la selección. Permitimos que el navegador haga su trabajo.
    if (
      event.target.closest(".cell-editor") ||
      event.target.isContentEditable
    ) {
      return;
    }

    event.preventDefault();
    window.getSelection()?.removeAllRanges();
  };
  const obtenerClasesSeleccion = (fila, col) => {
    const clases = {};

    const rangoSeleccion = getRangoSeleccion();
    const dentroSeleccion =
      seleccion.value.activa &&
      rangoSeleccion &&
      fila >= rangoSeleccion.minFila &&
      fila <= rangoSeleccion.maxFila &&
      col >= rangoSeleccion.minCol &&
      col <= rangoSeleccion.maxCol;

    const rangoUltimoPegado = ultimoPegado.value;
    const dentroUltimoPegado =
      rangoUltimoPegado &&
      fila >= rangoUltimoPegado.minFila &&
      fila <= rangoUltimoPegado.maxFila &&
      col >= rangoUltimoPegado.minCol &&
      col <= rangoUltimoPegado.maxCol;

    // ==========================================
    // 1. SELECCIÓN ORIGINAL (Cuadro azul sólido)
    // ==========================================
    if (dentroSeleccion && !dentroUltimoPegado) {
      clases["celda-seleccionada"] = true;
      clases["borde-arriba"] = fila === rangoSeleccion.minFila;
      clases["borde-abajo"] = fila === rangoSeleccion.maxFila;
      clases["borde-izq"] = col === rangoSeleccion.minCol;
      clases["borde-der"] = col === rangoSeleccion.maxCol;
    }

    // ==========================================
    // 2. PORTAPAPELES (Líneas entrecortadas como Excel)
    // ==========================================
    const rangoPort = rangoPortapapeles.value;
    const dentroPortapapeles =
      rangoPort &&
      rangoPort.sheetIndex === activeTab.value &&
      fila >= rangoPort.rango.minFila &&
      fila <= rangoPort.rango.maxFila &&
      col >= rangoPort.rango.minCol &&
      col <= rangoPort.rango.maxCol;

    if (dentroPortapapeles && operacionPortapapeles.value !== null) {
      clases["en-portapapeles"] = true;
      clases["portapapeles-arriba"] = fila === rangoPort.rango.minFila;
      clases["portapapeles-abajo"] = fila === rangoPort.rango.maxFila;
      clases["portapapeles-izq"] = col === rangoPort.rango.minCol;
      clases["portapapeles-der"] = col === rangoPort.rango.maxCol;

      if (originalSinFondo.value) {
        clases["sin-fondo-seleccion"] = true;
      }
    }

    // ==========================================
    // 3. ÚLTIMO PEGADO
    // ==========================================
    if (dentroUltimoPegado) {
      clases["ultimo-pegado"] = true;
      clases["borde-arriba"] = fila === rangoUltimoPegado.minFila;
      clases["borde-abajo"] = fila === rangoUltimoPegado.maxFila;
      clases["borde-izq"] = col === rangoUltimoPegado.minCol;
      clases["borde-der"] = col === rangoUltimoPegado.maxCol;
    }

    // ==========================================
    // 4. PREVISUALIZACIÓN DEL FILL (Cuadrito azul)
    // ==========================================
    if (
      fillEstado.value.arrastrando &&
      fillEstado.value.origen &&
      fillEstado.value.destino
    ) {
      const rangoOrigen = fillEstado.value.rangoOrigen;

      const minFila = Math.min(
        rangoOrigen.minFila,
        fillEstado.value.destino.fila,
      );
      const maxFila = Math.max(
        rangoOrigen.maxFila,
        fillEstado.value.destino.fila,
      );
      const minCol = Math.min(rangoOrigen.minCol, fillEstado.value.destino.col);
      const maxCol = Math.max(rangoOrigen.maxCol, fillEstado.value.destino.col);

      if (
        fila >= minFila &&
        fila <= maxFila &&
        col >= minCol &&
        col <= maxCol
      ) {
        clases["celda-en-fill"] = true;
        clases["fill-top"] = fila === minFila;
        clases["fill-bottom"] = fila === maxFila;
        clases["fill-left"] = col === minCol;
        clases["fill-right"] = col === maxCol;
      }
    }

    return clases;
  };

  const esTabEstadisticas = computed(() => activeTab.value === "stats");

  const currentSheet = computed(() =>
    typeof activeTab.value === "number" ? sheets.value[activeTab.value] : null,
  );

  const puedeAgregarSheet = computed(() => sheets.value.length < MAX_SHEETS);

  const addSheet = () => {
    if (!puedeAgregarSheet.value) return;

    const nuevoNumero = sheets.value.length + 1;
    sheets.value.push(crearSheetVacia(nuevoNumero));
    activeTab.value = sheets.value.length - 1;
    selectedTabs.value = [activeTab.value];
  };

  const irAEstadisticas = () => {
    cerrarMenuContextual();
    activeTab.value = "stats";
    selectedTabs.value = [];
  };

  const irASheet = (event, index) => {
    cerrarMenuContextual();

    // Si presionamos Ctrl (Windows) o Cmd (Mac)
    if (event && (event.ctrlKey || event.metaKey)) {
      if (selectedTabs.value.includes(index)) {
        // Si ya estaba seleccionado, lo quitamos
        selectedTabs.value = selectedTabs.value.filter((i) => i !== index);

        // Si quitamos todos, por seguridad volvemos a dejar el actual
        if (selectedTabs.value.length === 0) {
          selectedTabs.value = [index];
          activeTab.value = index;
        } else if (activeTab.value === index) {
          // Si quitamos la pestaña que estábamos viendo, mostramos la última del grupo
          activeTab.value = selectedTabs.value[selectedTabs.value.length - 1];
        }
      } else {
        // Agregamos a la selección múltiple
        selectedTabs.value.push(index);
        activeTab.value = index; // Mostramos esta nueva en pantalla
      }
    } else {
      // Clic normal: limpiamos el grupo y seleccionamos solo esta
      selectedTabs.value = [index];
      activeTab.value = index;
    }
  };

  const abrirMenuContextual = (event, index) => {
    if (sheets.value.length === 1) {
      cerrarMenuContextual();
      return;
    }

    event.preventDefault();

    // 👈 NUEVO: Si damos clic derecho en una pestaña que NO está en nuestro grupo
    // limpiamos el grupo y seleccionamos solo esa.
    if (!selectedTabs.value.includes(index)) {
      selectedTabs.value = [index];
      activeTab.value = index;
    }

    contextMenu.value = {
      visible: true,
      x: event.clientX,
      y: event.clientY,
      index,
    };
  };

  const eliminarSheet = () => {
    const index = contextMenu.value.index;
    if (index === null || index === undefined) return;

    // Tomamos todos los que están seleccionados
    let toDelete = [...selectedTabs.value];

    // Validar que no dejemos el sistema sin hojas
    if (sheets.value.length === toDelete.length) {
      mostrarMensaje("No permitido", "Debe existir al menos un galpón/hoja.");
      cerrarMenuContextual();
      return;
    }

    const isMultiple = toDelete.length > 1;
    // Extraemos los nombres para la confirmación
    const sheetNames = toDelete.map((i) => sheets.value[i].nombre).join(", ");

    abrirConfirmacion(
      isMultiple ? "Eliminar hojas" : "Eliminar hoja",
      isMultiple
        ? `¿Seguro que deseas eliminar las ${toDelete.length} hojas seleccionadas?\n(${sheetNames})`
        : `¿Seguro que deseas eliminar la hoja "${sheets.value[index].nombre}"?\nID: ${sheets.value[index].id}`,
      () => {
        // Filtramos para quedarnos con las hojas que NO están en la lista de borrado
        sheets.value = sheets.value.filter((_, i) => !toDelete.includes(i));
        renombrarSheets();

        // Reseteamos qué hoja ver y nuestra selección
        if (activeTab.value === "stats") {
          selectedTabs.value = [];
        } else {
          activeTab.value = Math.max(0, sheets.value.length - 1);
          selectedTabs.value = [activeTab.value];
        }

        cerrarMenuContextual();
      },
    );
  };

  const cerrarMenuContextual = () => {
    contextMenu.value.visible = false;
    contextMenu.value.index = null;
  };

  const handleInputFocus = (fila, col) => {
    // No hacemos nada al enfocar.
    // Solo queremos limpiar si realmente empieza a escribir fuera.
  };

  const isEditingCell = (fila, col) => {
    return editingCell.value?.fila === fila && editingCell.value?.col === col;
  };

  const obtenerValorActualCelda = (sheet, fila, col) => {
    const propiedad = getPropiedadColumna(col);
    if (!propiedad) return "";

    // Si justo esa celda está en edición, usamos el valor temporal actual
    if (isEditingCell(fila, col)) {
      let valor = editingValue.value ?? "";
      return typeof valor === "string" ? valor.replace(/\r/g, "") : valor;
    }

    return sheet.filas[fila]?.[propiedad] ?? "";
  };

  const startCellEdit = async (fila, col) => {
    if (!currentSheet.value) return;
    if (!esColumnaEditable(col)) return;

    limpiarSeleccionSiEditaFuera(fila, col);

    const propiedad = getPropiedadColumna(col);
    if (!propiedad) return;

    editingCell.value = { fila, col };
    editingValue.value = currentSheet.value.filas[fila][propiedad] ?? "";

    seleccion.value.activa = true;
    seleccion.value.arrastrando = false;
    seleccion.value.inicio = { fila, col };
    seleccion.value.fin = { fila, col };

    await nextTick();

    const editor = document.querySelector(".cell-editor");
    if (editor) {
      editor.focus();

      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(editor);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  };

  const handleCellClick = (event, fila, col) => {
    // ✅ NUEVO: Evitamos resetear la selección si ya estamos editando la celda
    if (isEditingCell(fila, col)) {
      event.stopPropagation();
      return;
    }

    event.preventDefault();
    window.getSelection()?.removeAllRanges();

    if (!esColumnaEditable(col)) return;

    if (editingCell.value && !isEditingCell(fila, col)) {
      commitCellEdit(editingCell.value.fila, editingCell.value.col);
    }

    ultimoPegado.value = null;

    // Si hay algo copiado/cortado, esta celda pasa a ser la seleccionada
    // visualmente y también el destino de pegado, PERO NO se cancela
    // el portapapeles original.
    if (operacionPortapapeles.value) {
      destinoPegado.value = { fila, col };

      seleccion.value.activa = true;
      seleccion.value.arrastrando = false;
      seleccion.value.inicio = { fila, col };
      seleccion.value.fin = { fila, col };

      return;
    }

    seleccion.value.activa = true;
    seleccion.value.arrastrando = false;
    seleccion.value.inicio = { fila, col };
    seleccion.value.fin = { fila, col };
  };

  const handleEditableInput = (event, fila, col) => {
    if (!isEditingCell(fila, col)) return;
    if (!currentSheet.value) return;

    const propiedad = getPropiedadColumna(col);
    if (!propiedad) return;

    let valorActual = event.target.innerText ?? "";

    // 🔥 NUEVO: Limpiar si el usuario pega texto con letras
    if (esColumnaNumerica(col)) {
      const valorLimpio = valorActual.replace(/[^0-9.,]/g, "");
      if (valorActual !== valorLimpio) {
        event.target.innerText = valorLimpio;
        valorActual = valorLimpio;

        // Restaurar cursor al final
        const range = document.createRange();
        const sel = window.getSelection();
        range.selectNodeContents(event.target);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }

    valorActual =
      typeof valorActual === "string" ? valorActual.replace(/\r/g, "") : "";

    // SOLO guardamos el valor temporal.
    editingValue.value = valorActual;

    if (operacionPortapapeles.value) {
      cancelarPortapapeles();
    }
  };

  const commitCellEdit = (fila, col, callback = null) => {
    //  SI EL BLUR VIENE DE MINIMIZAR → NO CERRAR EDICIÓN
    if (ventanaPerdioFoco.value) return;

    if (!currentSheet.value) return;
    if (!isEditingCell(fila, col)) return;

    const propiedad = getPropiedadColumna(col);
    if (!propiedad) return;

    let valorFinal = editingValue.value ?? "";
    valorFinal =
      typeof valorFinal === "string"
        ? valorFinal.replace(/\r/g, "")
        : valorFinal;

    if (esColumnaNumerica(col)) {
      valorFinal = valorFinal.trim();

      if (valorFinal === "") {
        currentSheet.value.filas[fila][propiedad] = "";
      } else {
        // 🔥 Reemplazamos coma por punto para que Javascript entienda que es decimal
        const numero = Number(valorFinal.replace(",", "."));

        if (Number.isNaN(numero)) {
          // Ya no mostramos el mensaje, simplemente ignoramos o limpiamos el campo
          currentSheet.value.filas[fila][propiedad] = "";
        } else {
          currentSheet.value.filas[fila][propiedad] = valorFinal;
        }
      }
    } else {
      currentSheet.value.filas[fila][propiedad] = valorFinal;
    }

    recalcularSheet(currentSheet.value);

    editingCell.value = null;
    editingValue.value = "";

    if (typeof callback === "function") {
      callback();
    }
  };

  const cancelCellEdit = () => {
    editingCell.value = null;
    editingValue.value = "";
  };

  const moveSelectionToCell = (fila, col) => {
    if (!currentSheet.value) return;

    const maxFila = currentSheet.value.filas.length - 1;
    const maxCol = 10;

    const nuevaFila = Math.max(0, Math.min(fila, maxFila));
    const nuevaCol = Math.max(0, Math.min(col, maxCol));

    seleccion.value.activa = true;
    seleccion.value.arrastrando = false;
    seleccion.value.inicio = { fila: nuevaFila, col: nuevaCol };
    seleccion.value.fin = { fila: nuevaFila, col: nuevaCol };
  };

  const handleEditorKeydown = (event, fila, col) => {
    if (!isEditingCell(fila, col)) return;

    // 🔥 NUEVO: Bloquear teclas no numéricas directamente
    if (esColumnaNumerica(col)) {
      // Permitimos teclas de navegación y borrado
      const isControlKey = [
        "Backspace",
        "Tab",
        "Escape",
        "Enter",
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Delete",
        "Home",
        "End",
      ].includes(event.key);
      // Permitimos combinaciones como Ctrl+C, Ctrl+V
      const isShortcut =
        (event.ctrlKey || event.metaKey) &&
        ["a", "c", "v", "x", "A", "C", "V", "X", "z", "Z"].includes(event.key);
      // Permitimos números, puntos y comas
      const isNumeric = /^[0-9.,]$/.test(event.key);

      if (!isControlKey && !isShortcut && !isNumeric) {
        event.preventDefault(); // Detiene la escritura de la letra
        return;
      }
    }

    if (event.key === "Escape") {
      event.preventDefault();
      cancelCellEdit();
      moveSelectionToCell(fila, col);
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();

      const callback =
        col === 2
          ? () => calcularAlimentoHasta(currentSheet.value, fila)
          : col === 5
            ? () => calcularGasHasta(currentSheet.value, fila)
            : col === 7
              ? () => calcularMortalidadHasta(currentSheet.value, fila)
              : null;

      commitCellEdit(fila, col, callback);
      moveSelectionToCell(fila + 1, col);
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();

      const callback =
        col === 2
          ? () => calcularAlimentoHasta(currentSheet.value, fila)
          : col === 5
            ? () => calcularGasHasta(currentSheet.value, fila)
            : col === 7
              ? () => calcularMortalidadHasta(currentSheet.value, fila)
              : null;

      commitCellEdit(fila, col, callback);
      moveSelectionToCell(fila, event.shiftKey ? col - 1 : col + 1);
    }
  };

  const handleInputEdit = (fila, col) => {
    // cualquier escritura cancela copiar/cortar
    if (operacionPortapapeles.value) {
      cancelarPortapapeles();
    }

    limpiarSeleccionSiEditaFuera(fila, col);
  };

  const calcularAlimentoHasta = (sheet, index) => {
    let alimentoAcum = 0;

    for (let i = 0; i <= index; i++) {
      const fila = sheet.filas[i];
      alimentoAcum += Number(fila.alimentoDiario) || 0;
      fila.alimentoAcum = alimentoAcum || "";
    }

    for (let i = index + 1; i < sheet.filas.length; i++) {
      sheet.filas[i].alimentoAcum = "";
    }
  };

  const calcularGasHasta = (sheet, index) => {
    let gasAcum = 0;

    for (let i = 0; i <= index; i++) {
      const fila = sheet.filas[i];
      gasAcum += Number(fila.gasDiario) || 0;
      fila.gasAcum = gasAcum || "";
    }

    for (let i = index + 1; i < sheet.filas.length; i++) {
      sheet.filas[i].gasAcum = "";
    }
  };

  const calcularMortalidadHasta = (sheet, index) => {
    let mortAcum = 0;
    const cantidadInicial = Number(sheet.form.cantidad) || 0;

    for (let i = 0; i <= index; i++) {
      const fila = sheet.filas[i];
      const mortDiaria = Number(fila.mortDiaria) || 0;

      mortAcum += mortDiaria;

      fila.mortAcum = mortAcum || "";
      fila.mortPorcentaje = cantidadInicial
        ? ((mortAcum / cantidadInicial) * 100).toFixed(2)
        : "";
    }

    for (let i = index + 1; i < sheet.filas.length; i++) {
      sheet.filas[i].mortAcum = "";
      sheet.filas[i].mortPorcentaje = "";
    }
  };

  const recalcularSheet = (sheet) => {
    const ultimaFilaAlimento = sheet.filas.reduce(
      (ultimo, fila, index) => (fila.alimentoDiario ? index : ultimo),
      -1,
    );

    const ultimaFilaGas = sheet.filas.reduce(
      (ultimo, fila, index) => (fila.gasDiario ? index : ultimo),
      -1,
    );

    const ultimaFilaMort = sheet.filas.reduce(
      (ultimo, fila, index) => (fila.mortDiaria ? index : ultimo),
      -1,
    );

    if (ultimaFilaAlimento >= 0) {
      calcularAlimentoHasta(sheet, ultimaFilaAlimento);
    } else {
      sheet.filas.forEach((fila) => {
        fila.alimentoAcum = "";
      });
    }

    if (ultimaFilaGas >= 0) {
      calcularGasHasta(sheet, ultimaFilaGas);
    } else {
      sheet.filas.forEach((fila) => {
        fila.gasAcum = "";
      });
    }

    if (ultimaFilaMort >= 0) {
      calcularMortalidadHasta(sheet, ultimaFilaMort);
    } else {
      sheet.filas.forEach((fila) => {
        fila.mortAcum = "";
        fila.mortPorcentaje = "";
      });
    }
  };

  const getCantidadPollosParaConsumo = (sheet, fila) => {
    const cantidadInicial = Number(sheet.form.cantidad) || 0;

    if (!USAR_MORTALIDAD_EN_CONSUMO) {
      return cantidadInicial;
    }

    const mortAcum = Number(fila.mortAcum) || 0;
    return Math.max(0, cantidadInicial - mortAcum);
  };

  // 1. Pegamos tus valores fijos aquí para que el composable los conozca
  const valoresConsumoFijos = [
    11, 14, 18, 21, 27, 30, 33, 35, 38, 42, 46, 50, 54, 58, 62, 69, 75, 78, 86,
    93, 99, 106, 114, 120, 127, 130, 134, 138, 140, 143, 144, 145, 147, 148,
    150, 155, 160, 170, 180, 185, 191, 197, 200, 210, 215, 218, 221, 224, 228,
    230, 234,
  ];

  // 2. Reemplazamos la función original por tu función inteligente
  const getConsumoIndividualGr = (fila) => {
    if (
      fila.alimentoDiario !== undefined &&
      fila.alimentoDiario !== null &&
      fila.alimentoDiario !== ""
    ) {
      return Number(fila.alimentoDiario);
    }

    const indiceDia = (fila.dia || 1) - 1;
    return valoresConsumoFijos[indiceDia] || 0;
  };

  const getConsumoTotalGrFila = (sheet, fila) => {
    const cantidadPollos = getCantidadPollosParaConsumo(sheet, fila);
    const consumoIndividualGr = getConsumoIndividualGr(fila);

    return cantidadPollos * consumoIndividualGr;
  };

  const getFundasFila = (sheet, fila) => {
    const consumoTotalGr = getConsumoTotalGrFila(sheet, fila);

    if (!consumoTotalGr) return 0;

    return Math.round(consumoTotalGr / GRAMOS_POR_FUNDA);
  };

  const getTablaConsumoSheet = (sheet) => {
    return sheet.filas.map((fila) => {
      const cantidadPollos = getCantidadPollosParaConsumo(sheet, fila);
      const consumoIndividualGr = getConsumoIndividualGr(fila);
      const consumoTotalGr = getConsumoTotalGrFila(sheet, fila);
      const fundas = getFundasFila(sheet, fila);

      return {
        dia: fila.dia,
        semana: fila.semana,
        fecha: fila.fecha || "",
        cantidadPollos,
        consumoIndividualGr,
        consumoTotalGr,
        fundas,
      };
    });
  };

  const getTotalConsumoGrSheet = (sheet) => {
    return getTablaConsumoSheet(sheet).reduce(
      (acc, fila) => acc + fila.consumoTotalGr,
      0,
    );
  };

  const getTotalFundasSheet = (sheet) => {
    return getTablaConsumoSheet(sheet).reduce(
      (acc, fila) => acc + fila.fundas,
      0,
    );
  };

const crearExcelBuffer = async () => {
    recalcularTodasLasHojas();

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Sistema Gestión Pollos";
    workbook.created = new Date();
    workbook.calcProperties.fullCalcOnLoad = true;

    // Filtramos las hojas para exportar solo las que el usuario seleccionó
    const hojasAExportar = sheets.value.filter((_, i) => galponesAExportar.value.includes(i));

    hojasAExportar.forEach((sheet, index) => {
      // =========================================================
      // 1. CREACIÓN DE LA HOJA DEL GALPÓN
      // =========================================================
      const nombreGalpon = sheet.nombre || `Galpon ${index + 1}`;
      const ws = workbook.addWorksheet(sanitizarNombreHojaExcel(nombreGalpon));

      const cantidadInicial = Number(sheet.form.cantidad) || 0;

      ws.columns = [
        { key: "semana", width: 12 },
        { key: "dia", width: 10 },
        { key: "fecha", width: 16 },
        { key: "alimentoCant", width: 14 },
        { key: "alimentoDiario", width: 14 },
        { key: "alimentoAcum", width: 14 },
        { key: "medicina", width: 24 },
        { key: "gasDiario", width: 14 },
        { key: "gasAcum", width: 14 },
        { key: "mortDiaria", width: 14 },
        { key: "mortAcum", width: 14 },
        { key: "mortPorcentaje", width: 14 },
        { key: "observacion", width: 28 },
      ];

      ws.mergeCells("A1:M1");
      ws.getCell("A1").value = "CONTROL PARA POLLOS DE CARNE";
      ws.getCell("A1").font = { bold: true, size: 14 };
      ws.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };

      ws.mergeCells("A2:M2");
      ws.getCell("A2").value =
        `Lote: ${conjunto.value.nombre || ""} | Código Lote: ${conjunto.value.id || ""}`;
      ws.getCell("A2").alignment = { horizontal: "center" };

      ws.getCell("A4").value = "Código Galpón:";
      ws.getCell("B4").value = sheet.id || "";
      ws.getCell("D4").value = "Granja:";
      ws.getCell("E4").value = sheet.form.granja || "";
      ws.getCell("G4").value = "Lote:";
      ws.getCell("H4").value = sheet.form.lote || "";
      ws.getCell("J4").value = "Galpón:";
      ws.getCell("K4").value = sheet.form.galpon || "";

      ws.getCell("A5").value = "Fecha ingreso:";
      ws.getCell("B5").value = sheet.form.fechaIngreso || "";
      ws.getCell("D5").value = "Procedencia:";
      ws.getCell("E5").value = sheet.form.procedencia || "";
      ws.getCell("G5").value = "Cantidad:";
      ws.getCell("H5").value = cantidadInicial;

      const headerRow = 7;
      const dataStartRow = 8;

      const headers = [
        "Semanas",
        "Día",
        "Fecha",
        "Cant.",
        "Diario",
        "Acum.",
        "Medicinas / Vacunas",
        "Gas Diario",
        "Gas Acum.",
        "Mort. Diaria",
        "Mort. Acum.",
        "Mort. %",
        "Observac. y Peso",
      ];

      ws.getRow(headerRow).values = headers;
      ws.getRow(headerRow).font = { bold: true };
      ws.getRow(headerRow).alignment = {
        horizontal: "center",
        vertical: "middle",
        wrapText: true,
      };

      ws.getRow(headerRow).eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFD9EAD3" },
        };
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        };
      });

      sheet.filas.forEach((fila, i) => {
        const excelRow = dataStartRow + i;

        ws.getCell(`A${excelRow}`).value = fila.semana;
        ws.getCell(`B${excelRow}`).value = fila.dia;
        ws.getCell(`C${excelRow}`).value = fila.fecha || "";
        ws.getCell(`D${excelRow}`).value = fila.alimentoCant || "";
        ws.getCell(`E${excelRow}`).value =
          fila.alimentoDiario === "" ? "" : Number(fila.alimentoDiario);
        ws.getCell(`G${excelRow}`).value = fila.medicina || "";
        ws.getCell(`H${excelRow}`).value =
          fila.gasDiario === "" ? "" : Number(fila.gasDiario);
        ws.getCell(`J${excelRow}`).value =
          fila.mortDiaria === "" ? "" : Number(fila.mortDiaria);
        ws.getCell(`M${excelRow}`).value = fila.observacion || "";

        ws.getCell(`F${excelRow}`).value = {
          formula: `IF(E${excelRow}="","",SUM($E$${dataStartRow}:E${excelRow}))`,
        };

        ws.getCell(`I${excelRow}`).value = {
          formula: `IF(H${excelRow}="","",SUM($H$${dataStartRow}:H${excelRow}))`,
        };

        ws.getCell(`K${excelRow}`).value = {
          formula: `IF(J${excelRow}="","",SUM($J$${dataStartRow}:J${excelRow}))`,
        };

        ws.getCell(`L${excelRow}`).value = {
          formula: `IF(OR(K${excelRow}="",${cantidadInicial}=0),"",ROUND((K${excelRow}/${cantidadInicial})*100,2))`,
        };

        for (let col = 1; col <= 13; col++) {
          const cell = ws.getRow(excelRow).getCell(col);

          let alignH = "center";
          let alignV = "middle";
          let wrap = true;

          // Excel empieza en columna 1 y las 2 primeras son Semana y Día.
          // Restamos 3 para sincronizar con nuestro índice de columnas de la UI (0 a 10)
          const uiColIndex = col - 3;

          if (uiColIndex >= 0 && uiColIndex <= 10) {
            const formato = getFormatoCelda(i, uiColIndex);
            alignH = formato.h;
            alignV = formato.v;
            wrap = formato.wrap;
          }

          cell.alignment = {
            horizontal: alignH,
            vertical: alignV,
            wrapText: wrap,
          };

          cell.border = {
            top: { style: "thin" },
            left: { style: "thin" },
            bottom: { style: "thin" },
            right: { style: "thin" },
          };
        }

        ws.getCell(`L${excelRow}`).numFmt = "0.00";
      });

      for (let inicio = dataStartRow; inicio < dataStartRow + 70; inicio += 7) {
        const fin = Math.min(inicio + 6, dataStartRow + 69);
        if (inicio <= fin) {
          ws.mergeCells(`A${inicio}:A${fin}`);
          ws.getCell(`A${inicio}`).alignment = {
            horizontal: "center",
            vertical: "middle",
          };
        }
      }

      const resumenRow = dataStartRow + sheet.filas.length + 2;

      ws.getCell(`A${resumenRow}`).value = "RESUMEN";
      ws.getCell(`A${resumenRow}`).font = { bold: true };

      ws.getCell(`A${resumenRow + 1}`).value = "Kilos alimento consumidos:";
      ws.getCell(`B${resumenRow + 1}`).value = {
        formula: `SUM(E${dataStartRow}:E${dataStartRow + sheet.filas.length - 1})`,
      };

      ws.getCell(`A${resumenRow + 2}`).value = "Consumo total de gas:";
      ws.getCell(`B${resumenRow + 2}`).value = {
        formula: `SUM(H${dataStartRow}:H${dataStartRow + sheet.filas.length - 1})`,
      };

      ws.getCell(`A${resumenRow + 3}`).value = "Mortalidad total:";
      ws.getCell(`B${resumenRow + 3}`).value = {
        formula: `SUM(J${dataStartRow}:J${dataStartRow + sheet.filas.length - 1})`,
      };

      ws.getCell(`A${resumenRow + 4}`).value = "Mortalidad %:";
      ws.getCell(`B${resumenRow + 4}`).value = {
        formula: `IF(${cantidadInicial}=0,"",ROUND((B${resumenRow + 3}/${cantidadInicial})*100,2))`,
      };
      ws.getCell(`B${resumenRow + 4}`).numFmt = "0.00";

      ws.views = [{ state: "frozen", ySplit: 7 }];

      // =========================================================
      // 2. CREACIÓN DE LA HOJA DE CONSUMO PARA ESTE GALPÓN (CON FÓRMULAS)
      // =========================================================
      const wsConsumo = workbook.addWorksheet(
        sanitizarNombreHojaExcel(`Consumo ${nombreGalpon}`),
      );

      wsConsumo.columns = [
        { key: "semana", width: 12 },
        { key: "dia", width: 10 },
        { key: "fecha", width: 16 },
        { key: "cantidadPollos", width: 22 },
        { key: "consumoIndividual", width: 24 },
        { key: "consumoTotal", width: 20 },
        { key: "fundas", width: 15 },
      ];

      wsConsumo.mergeCells("A1:G1");
      wsConsumo.getCell("A1").value =
        `TABLA DE CONSUMO DE ALIMENTO - ${nombreGalpon.toUpperCase()}`;
      wsConsumo.getCell("A1").font = { bold: true, size: 14 };
      wsConsumo.getCell("A1").alignment = {
        horizontal: "center",
        vertical: "middle",
      };

      wsConsumo.mergeCells("A2:G2");
      wsConsumo.getCell("A2").value =
        `Lote: ${conjunto.value.nombre || ""} | Código Lote: ${conjunto.value.id || ""}`;
      wsConsumo.getCell("A2").alignment = { horizontal: "center" };

      const headerRowConsumo = 4;
      const headersConsumo = [
        "Semana",
        "Día",
        "Fecha",
        "Cantidad de Pollos",
        "Consumo Individual [gr]",
        "Consumo Total [gr]",
        "Fundas",
      ];

      wsConsumo.getRow(headerRowConsumo).values = headersConsumo;
      wsConsumo.getRow(headerRowConsumo).font = { bold: true };
      wsConsumo.getRow(headerRowConsumo).alignment = {
        horizontal: "center",
        vertical: "middle",
        wrapText: true,
      };

      wsConsumo.getRow(headerRowConsumo).eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFFFE599" }, // Color amarillo pastel para diferenciar
        };
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        };
      });

      const tablaConsumo = getTablaConsumoSheet(sheet);
      const dataStartRowConsumo = 5;

      tablaConsumo.forEach((fila, i) => {
        const excelRow = dataStartRowConsumo + i;

        wsConsumo.getCell(`A${excelRow}`).value = fila.semana;
        wsConsumo.getCell(`B${excelRow}`).value = fila.dia;
        wsConsumo.getCell(`C${excelRow}`).value = fila.fecha || "";

        // Base de datos para el cálculo
        wsConsumo.getCell(`D${excelRow}`).value = fila.cantidadPollos;
        wsConsumo.getCell(`E${excelRow}`).value =
          fila.consumoIndividualGr === 0 ? "" : fila.consumoIndividualGr;

        // Fórmulas de Excel en lugar de datos quemados
        wsConsumo.getCell(`F${excelRow}`).value = {
          formula: `IF(E${excelRow}="","",D${excelRow}*E${excelRow})`,
        };

        // Asumiendo que GRAMOS_POR_FUNDA = 45000, dividimos el Consumo Total para las fundas
        wsConsumo.getCell(`G${excelRow}`).value = {
          formula: `IF(F${excelRow}="","",ROUND(F${excelRow}/45000,0))`,
        };

        for (let col = 1; col <= 7; col++) {
          const cell = wsConsumo.getRow(excelRow).getCell(col);
          cell.alignment = { horizontal: "center", vertical: "middle" };
          cell.border = {
            top: { style: "thin" },
            left: { style: "thin" },
            bottom: { style: "thin" },
            right: { style: "thin" },
          };
        }
      });

      // Agrupar visualmente las semanas igual que en la tabla principal
      for (
        let inicio = dataStartRowConsumo;
        inicio < dataStartRowConsumo + 70;
        inicio += 7
      ) {
        const fin = Math.min(inicio + 6, dataStartRowConsumo + 69);
        if (inicio <= fin) {
          wsConsumo.mergeCells(`A${inicio}:A${fin}`);
          wsConsumo.getCell(`A${inicio}`).alignment = {
            horizontal: "center",
            vertical: "middle",
          };
        }
      }

      const resumenRowConsumo = dataStartRowConsumo + tablaConsumo.length + 2;

      wsConsumo.getCell(`A${resumenRowConsumo}`).value = "RESUMEN";
      wsConsumo.getCell(`A${resumenRowConsumo}`).font = { bold: true };

      // Fórmulas de suma para el resumen inferior
      wsConsumo.getCell(`A${resumenRowConsumo + 1}`).value =
        "Consumo total alimento [gr]:";
      wsConsumo.getCell(`C${resumenRowConsumo + 1}`).value = {
        formula: `SUM(F${dataStartRowConsumo}:F${dataStartRowConsumo + tablaConsumo.length - 1})`,
      };

      wsConsumo.getCell(`A${resumenRowConsumo + 2}`).value = "Total fundas:";
      wsConsumo.getCell(`C${resumenRowConsumo + 2}`).value = {
        formula: `SUM(G${dataStartRowConsumo}:G${dataStartRowConsumo + tablaConsumo.length - 1})`,
      };

      wsConsumo.views = [{ state: "frozen", ySplit: 4 }];
    });

    // =========================================================
    // 3. HOJA DE ESTADÍSTICAS GENERALES (Al final de todas las hojas)
    // =========================================================
    const wsStats = workbook.addWorksheet("Estadisticas");
    wsStats.columns = [
      { key: "numero", width: 10 },
      { key: "id", width: 22 },
      { key: "galpon", width: 14 },
      { key: "lote", width: 14 },
      { key: "cantidad", width: 12 },
      { key: "alimento", width: 16 },
      { key: "gas", width: 14 },
      { key: "mortalidad", width: 16 },
      { key: "porcentaje", width: 14 },
    ];

    wsStats.mergeCells("A1:I1");
    wsStats.getCell("A1").value = "ESTADÍSTICAS GENERALES";
    wsStats.getCell("A1").font = { bold: true, size: 14 };
    wsStats.getCell("A1").alignment = { horizontal: "center" };

    wsStats.getRow(3).values = [
      "#",
      "Código Galpón",
      "Galpón",
      "Lote",
      "Cantidad",
      "Total Alimento",
      "Total Gas",
      "Total Mortalidad",
      "% Mortalidad",
    ];

    wsStats.getRow(3).font = { bold: true };
    wsStats.getRow(3).alignment = { horizontal: "center", vertical: "middle" };

    wsStats.getRow(3).eachCell((cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF4CCCC" },
      };
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });

    // Mapear solo los galpones seleccionados para las estadísticas
    const statsAExportar = hojasAExportar.map((sheet, index) => {
      const cantidad = Number(sheet.form.cantidad) || 0;
      const mortalidad = getTotalMortalidadSheet(sheet);

      return {
        numero: index + 1,
        id: sheet.id,
        galpon: sheet.form.galpon || `Galpón ${index + 1}`,
        lote: sheet.form.lote || "-",
        cantidad,
        alimento: getTotalAlimentoSheet(sheet),
        gas: getTotalGasSheet(sheet),
        mortalidad,
        porcentaje: cantidad
          ? ((mortalidad / cantidad) * 100).toFixed(2)
          : "0.00",
      };
    });

    statsAExportar.forEach((item, idx) => {
      const row = 4 + idx;
      wsStats.getRow(row).values = [
        item.numero,
        item.id,
        item.galpon,
        item.lote,
        item.cantidad,
        item.alimento,
        item.gas,
        item.mortalidad,
        Number(item.porcentaje),
      ];

      wsStats.getCell(`I${row}`).numFmt = "0.00";

      wsStats.getRow(row).eachCell((cell) => {
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        };
      });
    });

    const totalRow = 5 + statsAExportar.length;
    wsStats.getCell(`D${totalRow}`).value = "TOTALES";
    wsStats.getCell(`D${totalRow}`).font = { bold: true };
    wsStats.getCell(`E${totalRow}`).value = {
      formula: `SUM(E4:E${totalRow - 1})`,
    };
    wsStats.getCell(`F${totalRow}`).value = {
      formula: `SUM(F4:F${totalRow - 1})`,
    };
    wsStats.getCell(`G${totalRow}`).value = {
      formula: `SUM(G4:G${totalRow - 1})`,
    };
    wsStats.getCell(`H${totalRow}`).value = {
      formula: `SUM(H4:H${totalRow - 1})`,
    };
    wsStats.getCell(`I${totalRow}`).value = {
      formula: `IF(E${totalRow}=0,"",ROUND((H${totalRow}/E${totalRow})*100,2))`,
    };
    wsStats.getCell(`I${totalRow}`).numFmt = "0.00";

    wsStats.getRow(totalRow).eachCell((cell) => {
      cell.font = { bold: true };
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });

    return await workbook.xlsx.writeBuffer();
  };

  const crearPdfBuffer = async () => {
    recalcularTodasLasHojas();

    const doc = new jsPDF("l", "mm", "a4");
    const margenX = 10;

    // Filtramos las hojas para exportar solo las que el usuario seleccionó
    const hojasAExportar = sheets.value.filter((_, i) => galponesAExportar.value.includes(i));

    hojasAExportar.forEach((sheet, index) => {
      // =========================================================
      // 1. PÁGINA DEL GALPÓN
      // =========================================================
      if (index > 0) doc.addPage("a4", "l");

      // --- ENCABEZADO PRINCIPAL ---
      doc.setFontSize(16);
      doc.text("CONTROL PARA POLLOS DE CARNE", margenX, 12);

      doc.setFontSize(10);
      doc.text(
        `Código Lote: ${conjunto.value.id || ""}   |   Nombre del lote: ${conjunto.value.nombre || ""}`,
        margenX,
        18,
      );
      doc.text(`Descripción: ${conjunto.value.descripcion || ""}`, margenX, 23);

      doc.setFontSize(12);
      doc.text(`${sheet.nombre} - ${sheet.id}`, margenX, 29);

      doc.setFontSize(9);
      doc.text(`Granja: ${sheet.form.granja || ""}`, margenX, 34);
      doc.text(`Lote: ${sheet.form.lote || ""}`, 70, 34);
      doc.text(`Galpón: ${sheet.form.galpon || ""}`, 120, 34);
      doc.text(`Fecha ingreso: ${sheet.form.fechaIngreso || ""}`, 170, 34);
      doc.text(`Procedencia: ${sheet.form.procedencia || ""}`, 230, 34);
      doc.text(`Cantidad: ${sheet.form.cantidad || 0}`, 280, 34, {
        align: "right",
      });

      // MODIFICACIÓN: Creamos el body omitiendo la celda Semana en los días 2-7 y agregando estilos
      const body = [];
      sheet.filas.forEach((fila, i) => {
        // Función auxiliar para recuperar el estilo y dárselo al PDF
        const getPdfCell = (colIndex, valor) => {
          const formato = getFormatoCelda(i, colIndex);
          return {
            content: valor,
            styles: {
              halign: formato.h,
              valign: formato.v,
            },
          };
        };

        const filaDatos = [
          { content: fila.dia, styles: { halign: "center", valign: "middle" } },
          getPdfCell(0, fila.fecha || ""),
          getPdfCell(1, fila.alimentoCant || ""),
          getPdfCell(2, fila.alimentoDiario || ""),
          getPdfCell(3, fila.alimentoAcum || ""),
          getPdfCell(4, fila.medicina || ""),
          getPdfCell(5, fila.gasDiario || ""),
          getPdfCell(6, fila.gasAcum || ""),
          getPdfCell(7, fila.mortDiaria || ""),
          getPdfCell(8, fila.mortAcum || ""),
          getPdfCell(9, fila.mortPorcentaje || ""),
          getPdfCell(10, fila.observacion || ""),
        ];

        // Solo insertamos la celda de la Semana al inicio del arreglo si es el día 1 de la semana
        if (Number(fila.dia) % 7 === 1) {
          filaDatos.unshift({
            content: fila.semana,
            rowSpan: 7,
            styles: { halign: "center", valign: "middle" },
          });
        }

        body.push(filaDatos);
      });

      // --- TABLA DEL GALPÓN ---
      autoTable(doc, {
        startY: 38,
        head: [
          [
            "Sem",
            "Día",
            "Fecha",
            "Cant.",
            "Alim. Diario",
            "Alim. Acum.",
            "Medicinas / Vacunas",
            "Gas Diario",
            "Gas Acum.",
            "Mort. Diaria",
            "Mort. Acum.",
            "Mort. %",
            "Observación",
          ],
        ],
        body,
        styles: {
          fontSize: 7,
          cellPadding: 1.5,
          overflow: "linebreak",
          halign: "center",
          valign: "middle",
        },
        headStyles: {
          fillColor: [52, 73, 94],
        },
        columnStyles: {
          6: { cellWidth: 28 }, // Alineación removida para que domine el estilo dinámico
          12: { cellWidth: 34 }, // Alineación removida para que domine el estilo dinámico
        },
        margin: { left: 8, right: 8 },
      });

      const finalY = doc.lastAutoTable.finalY + 6;

      doc.setFontSize(10);
      doc.text(
        `Kilos alimento consumidos: ${getTotalAlimentoSheet(sheet)}`,
        margenX,
        finalY,
      );
      doc.text(`Consumo total de gas: ${getTotalGasSheet(sheet)}`, 95, finalY);
      doc.text(
        `Mortalidad total: ${getTotalMortalidadSheet(sheet)}`,
        170,
        finalY,
      );
      doc.text(
        `Mortalidad %: ${getPorcentajeMortalidadSheet(sheet)}%`,
        245,
        finalY,
      );

      // =========================================================
      // 2. PÁGINA DE TABLA DE CONSUMO PARA ESTE GALPÓN
      // =========================================================
      doc.addPage("a4", "l");

      doc.setFontSize(14);
      doc.text(
        `TABLA DE CONSUMO DE ALIMENTO - ${sheet.nombre.toUpperCase()}`,
        margenX,
        12,
      );

      doc.setFontSize(9);
      doc.text(`Código Lote: ${conjunto.value.id || ""}`, margenX, 18);
      doc.text(`Lote: ${sheet.form.lote || ""}`, 90, 18);
      doc.text(`Galpón: ${sheet.form.galpon || ""}`, 150, 18);

      const tablaConsumo = getTablaConsumoSheet(sheet);

      // MODIFICACIÓN: Mismo procedimiento de omitir celda para la tabla de Consumo
      const bodyConsumo = [];
      tablaConsumo.forEach((fila) => {
        const filaDatos = [
          fila.dia,
          fila.fecha || "",
          fila.cantidadPollos,
          fila.consumoIndividualGr === 0 ? "" : fila.consumoIndividualGr,
          fila.consumoTotalGr,
          fila.fundas,
        ];

        // Solo la insertamos al inicio del arreglo si corresponde
        if (Number(fila.dia) % 7 === 1) {
          filaDatos.unshift({ content: fila.semana, rowSpan: 7 });
        }

        bodyConsumo.push(filaDatos);
      });

      autoTable(doc, {
        startY: 24,
        head: [
          [
            "Semana",
            "Día",
            "Fecha",
            "Cantidad de Pollos",
            "Consumo Individual [gr]",
            "Consumo Total [gr]",
            "Fundas",
          ],
        ],
        body: bodyConsumo,
        styles: {
          fontSize: 8,
          cellPadding: 2,
          halign: "center",
          valign: "middle",
        },
        headStyles: {
          fillColor: [243, 156, 18],
        },
        margin: { left: 8, right: 8 },
      });

      const finalYConsumo = doc.lastAutoTable.finalY + 8;

      doc.setFontSize(10);
      doc.text("RESUMEN DE CONSUMO:", margenX, finalYConsumo);
      doc.text(
        `Consumo total alimento [gr]: ${getTotalConsumoGrSheet(sheet)}`,
        margenX,
        finalYConsumo + 6,
      );
      doc.text(
        `Total fundas: ${getTotalFundasSheet(sheet)}`,
        80,
        finalYConsumo + 6,
      );
    });

    // =========================================================
    // 3. PÁGINA DE ESTADÍSTICAS GENERALES AL FINAL
    // =========================================================
    doc.addPage("a4", "l");
    doc.setFontSize(14);
    doc.text("ESTADÍSTICAS GENERALES", margenX, 12);

    // Mapear solo los galpones seleccionados para las estadísticas del PDF
    const statsAExportar = hojasAExportar.map((sheet, index) => {
      const cantidad = Number(sheet.form.cantidad) || 0;
      const mortalidad = getTotalMortalidadSheet(sheet);

      return {
        numero: index + 1,
        id: sheet.id,
        galpon: sheet.form.galpon || `Galpón ${index + 1}`,
        lote: sheet.form.lote || "-",
        cantidad,
        alimento: getTotalAlimentoSheet(sheet),
        gas: getTotalGasSheet(sheet),
        mortalidad,
        porcentaje: cantidad
          ? ((mortalidad / cantidad) * 100).toFixed(2)
          : "0.00",
      };
    });

    autoTable(doc, {
      startY: 20,
      head: [
        [
          "#",
          "Código Galpón",
          "Galpón",
          "Lote",
          "Cantidad",
          "Total Alimento",
          "Total Gas",
          "Total Mortalidad",
          "% Mortalidad",
        ],
      ],
      body: statsAExportar.map((item) => [
        item.numero,
        item.id,
        item.galpon,
        item.lote,
        item.cantidad,
        item.alimento,
        item.gas,
        item.mortalidad,
        `${item.porcentaje}%`,
      ]),
      styles: {
        fontSize: 9,
        halign: "center",
        valign: "middle",
      },
      headStyles: {
        fillColor: [41, 128, 185],
      },
    });

    const y = doc.lastAutoTable.finalY + 8;
    doc.setFontSize(11);
    
    // Calcular sumas solo con los seleccionados
    const totalCantidad = statsAExportar.reduce((acc, item) => acc + item.cantidad, 0);
    const totalAlimento = statsAExportar.reduce((acc, item) => acc + item.alimento, 0);
    const totalGas = statsAExportar.reduce((acc, item) => acc + item.gas, 0);
    const totalMortalidad = statsAExportar.reduce((acc, item) => acc + item.mortalidad, 0);

    doc.text(
      `Total galpones: ${hojasAExportar.length}`,
      margenX,
      y,
    );
    doc.text(
      `Total pollos ingresados: ${totalCantidad}`,
      70,
      y,
    );
    doc.text(
      `Total alimento: ${totalAlimento}`,
      145,
      y,
    );
    doc.text(`Total gas: ${totalGas}`, 210, y);
    doc.text(
      `Total mortalidad: ${totalMortalidad}`,
      260,
      y,
    );

    return doc.output("arraybuffer");
  };

  const obtenerMensajeErrorLimpio = (error) => {
    let mensaje = String(error?.message || error || "").trim();

    // Si viene con "with error:", nos quedamos solo con esa parte
    const match = mensaje.match(/with error:\s*(.+)$/i);
    if (match?.[1]) {
      mensaje = match[1].trim();
    }

    // Quitar: (os error 32), (os error 5), etc.
    mensaje = mensaje.replace(/\s*\(os error \d+\)\s*$/i, "").trim();

    return mensaje || "Ocurrió un error inesperado.";
  };

  const exportarDatos = async (tipo) => {
    if (exportando.value) return;

    try {
      exportando.value = true;
      recalcularTodasLasHojas();

      const nombreBase = sanitizarNombreArchivo(
        `${conjunto.value.nombre || "conjunto"}_${conjunto.value.id || ""}`,
      );

      let buffer = null;
      let extension = "";

      // 1. Preparamos el buffer y la extensión según el tipo
      if (tipo === "pdf") {
        extension = "pdf";
        buffer = await crearPdfBuffer();
      } else if (tipo === "excel") {
        extension = "xlsx";
        buffer = await crearExcelBuffer();
      } else if (tipo === "ambas") {
        extension = "zip";
        const [pdfBuffer, excelBuffer] = await Promise.all([
          crearPdfBuffer(),
          crearExcelBuffer(),
        ]);

        const zip = new JSZip();
        zip.file(`${nombreBase}.pdf`, pdfBuffer);
        zip.file(`${nombreBase}.xlsx`, excelBuffer);

        buffer = await zip.generateAsync({ type: "arraybuffer" });
      }

      // 🔥 CORRECCIÓN: Desactivar el estado "exportando" ANTES de pedir la ruta
      // Esto cierra el modal de "Cargando..." para que no bloquee la pantalla
      exportando.value = false;
      cerrarExportacion();
      await nextTick();

      // 2. Abrir el cuadro de diálogo nativo para elegir dónde guardar
      const rutaDestino = await save({
        defaultPath: `${nombreBase}.${extension}`,
        filters: [
          {
            name: tipo.toUpperCase(),
            extensions: [extension],
          },
        ],
      });

      // Si el usuario presiona "Cancelar" en la ventana de guardado, detenemos la función
      if (!rutaDestino) {
        return;
      }

      // 3. Escribir el archivo físicamente en la ruta elegida
      await writeFile(rutaDestino, new Uint8Array(buffer));

      // 4. Extraer la ruta de la carpeta (quitando el nombre del archivo al final)
      // Soporta separadores de Windows (\) y Unix (/)
      const carpetaDestino = rutaDestino.substring(
        0,
        Math.max(rutaDestino.lastIndexOf("/"), rutaDestino.lastIndexOf("\\")),
      );

      // 5. Mostrar tu modal de confirmación con la opción de abrir la carpeta
      abrirConfirmacion(
        "Exportación exitosa",
        `El archivo se guardó correctamente en:\n${rutaDestino}\n\n¿Deseas abrir la ubicación del archivo?`,
        async () => {
          try {
            // Abre la carpeta en el explorador de archivos del sistema
            await revealItemInDir(rutaDestino);
          } catch (err) {
            console.error("Error al abrir la carpeta:", err);
            mostrarMensaje(
              "Error",
              "No se pudo abrir la ubicación del archivo.",
            );
          }
        },
        "Abrir ubicación", // Texto del botón de confirmación
        "success", // Pasamos el tipo "success" o "normal" según cómo lo manejes
      );
    } catch (error) {
      console.error("Error al exportar:", error);

      exportando.value = false;
      cerrarExportacion();
      await nextTick();

      mostrarMensaje("Error al exportar", obtenerMensajeErrorLimpio(error));
    } finally {
      exportando.value = false;
    }
  };

  const onCantidadChange = (sheet) => {
    const ultimaFilaMort = sheet.filas.reduce(
      (ultimo, fila, index) => (fila.mortDiaria ? index : ultimo),
      -1,
    );

    if (ultimaFilaMort >= 0) {
      calcularMortalidadHasta(sheet, ultimaFilaMort);
    }
  };

  // --- NUEVA VARIABLE DE ESTADO ---
  const estadoGuardado = ref({
    tipo: "idle", // 'idle', 'exito_auto', 'error_auto', 'exito_manual', 'error_manual'
    mensaje: "",
  });

  const guardar = async (esManual = false) => {
    // Asegurarnos de que sea un booleano puro (los botones a veces envían el objeto del evento)
    const manual = esManual === true;

    if (!currentSheet.value) return;

    try {
      const database = await initDB();
      recalcularSheet(currentSheet.value);
      const sheet = currentSheet.value;

      await database.execute(
        `INSERT OR REPLACE INTO conjuntos (id, nombre, descripcion) VALUES (?, ?, ?)`,
        [
          conjunto.value.id,
          conjunto.value.nombre || "",
          conjunto.value.descripcion || "",
        ],
      );

      await database.execute(
        `INSERT OR REPLACE INTO sheets
        (id, conjunto_id, nombre, granja, lote, galpon, fecha_ingreso, procedencia, cantidad)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sheet.id,
          conjunto.value.id,
          sheet.nombre,
          sheet.form.granja || "",
          sheet.form.lote || "",
          sheet.form.galpon || "",
          sheet.form.fechaIngreso || "",
          sheet.form.procedencia || "",
          Number(sheet.form.cantidad) || 0,
        ],
      );

      await database.execute(`DELETE FROM filas WHERE sheet_id = ?`, [
        sheet.id,
      ]);

      for (const fila of sheet.filas) {
        await database.execute(
          `INSERT INTO filas
          (sheet_id, dia, semana, fecha, alimento_cant, alimento_diario, alimento_acum,
           medicina, gas_diario, gas_acum, mort_diaria, mort_acum, mort_porcentaje, observacion)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            sheet.id,
            fila.dia,
            fila.semana,
            fila.fecha || "",
            fila.alimentoCant || "",
            Number(fila.alimentoDiario) || 0,
            Number(fila.alimentoAcum) || 0,
            fila.medicina || "",
            Number(fila.gasDiario) || 0,
            Number(fila.gasAcum) || 0,
            Number(fila.mortDiaria) || 0,
            Number(fila.mortAcum) || 0,
            Number(fila.mortPorcentaje) || 0,
            fila.observacion || "",
          ],
        );
      }

      console.log(`✅ Guardado completado para la hoja: ${sheet.nombre}`);

      // Actualizamos el estado de éxito
      estadoGuardado.value = {
        tipo: manual ? "exito_manual" : "exito_auto",
        mensaje: manual
          ? "Guardado manual correcto"
          : "Autoguardado correctamente",
      };

      // Opcional: Ocultar el mensaje de éxito después de 4 segundos para limpiar la pantalla
      setTimeout(() => {
        if (estadoGuardado.value.tipo.includes("exito")) {
          estadoGuardado.value = { tipo: "idle", mensaje: "" };
        }
      }, 4000);
    } catch (error) {
      console.error("Error al guardar en SQLite:", error);

      // Actualizamos el estado de error
      estadoGuardado.value = {
        tipo: manual ? "error_manual" : "error_auto",
        mensaje: manual
          ? "Error al guardar manualmente"
          : "Ocurrió un error al guardar automáticamente",
      };
    }
  };

  // --- LÓGICA DE AUTOGUARDADO Y AUTOCÁLCULO ---
  let timerAutoguardado = null;

  watch(
    [sheets, conjunto],
    () => {
      // Limpiamos el mensaje si el usuario empieza a editar de nuevo
      if (estadoGuardado.value.tipo.includes("exito")) {
        estadoGuardado.value = { tipo: "idle", mensaje: "" };
      }

      if (timerAutoguardado) {
        clearTimeout(timerAutoguardado);
      }

      timerAutoguardado = setTimeout(() => {
        guardar(false); // Pasamos 'false' para indicar que es autoguardado
      }, 500);
    },
    { deep: true },
  );

  const getTotalAlimentoSheet = (sheet) =>
    sheet.filas.reduce(
      (acc, fila) => acc + (Number(fila.alimentoDiario) || 0),
      0,
    );

  const getTotalGasSheet = (sheet) =>
    sheet.filas.reduce((acc, fila) => acc + (Number(fila.gasDiario) || 0), 0);

  const getTotalMortalidadSheet = (sheet) =>
    sheet.filas.reduce((acc, fila) => acc + (Number(fila.mortDiaria) || 0), 0);

  const getPorcentajeMortalidadSheet = (sheet) => {
    const cantidad = Number(sheet.form.cantidad) || 0;
    const totalMort = getTotalMortalidadSheet(sheet);

    if (!cantidad) return "0.00";
    return ((totalMort / cantidad) * 100).toFixed(2);
  };

  const totalAlimentoActual = computed(() =>
    currentSheet.value ? getTotalAlimentoSheet(currentSheet.value) : 0,
  );

  const tablaConsumoActual = computed(() =>
    currentSheet.value ? getTablaConsumoSheet(currentSheet.value) : [],
  );

  const totalConsumoGrActual = computed(() =>
    currentSheet.value ? getTotalConsumoGrSheet(currentSheet.value) : 0,
  );

  const totalFundasActual = computed(() =>
    currentSheet.value ? getTotalFundasSheet(currentSheet.value) : 0,
  );

  const totalGasActual = computed(() =>
    currentSheet.value ? getTotalGasSheet(currentSheet.value) : 0,
  );

  const totalMortalidadActual = computed(() =>
    currentSheet.value ? getTotalMortalidadSheet(currentSheet.value) : 0,
  );

  const mortalidadPorcentajeFinalActual = computed(() =>
    currentSheet.value
      ? getPorcentajeMortalidadSheet(currentSheet.value)
      : "0.00",
  );

  const resumenGalpones = computed(() =>
    sheets.value.map((sheet, index) => {
      const cantidad = Number(sheet.form.cantidad) || 0;
      const mortalidad = getTotalMortalidadSheet(sheet);

      return {
        numero: index + 1,
        id: sheet.id,
        galpon: sheet.form.galpon || `Galpón ${index + 1}`,
        lote: sheet.form.lote || "-",
        cantidad,
        alimento: getTotalAlimentoSheet(sheet),
        gas: getTotalGasSheet(sheet),
        mortalidad,
        porcentaje: cantidad
          ? ((mortalidad / cantidad) * 100).toFixed(2)
          : "0.00",
        consumoTotalGr: getTotalConsumoGrSheet(sheet),
        fundas: getTotalFundasSheet(sheet),
      };
    }),
  );

  const estadisticasGenerales = computed(() => {
    const totalCantidad = resumenGalpones.value.reduce(
      (acc, item) => acc + item.cantidad,
      0,
    );
    const totalAlimento = resumenGalpones.value.reduce(
      (acc, item) => acc + item.alimento,
      0,
    );
    const totalGas = resumenGalpones.value.reduce(
      (acc, item) => acc + item.gas,
      0,
    );
    const totalMortalidad = resumenGalpones.value.reduce(
      (acc, item) => acc + item.mortalidad,
      0,
    );

    const porcentajeMortalidad = totalCantidad
      ? ((totalMortalidad / totalCantidad) * 100).toFixed(2)
      : "0.00";

    return {
      totalGalpones: sheets.value.length,
      totalCantidad,
      totalAlimento,
      totalGas,
      totalMortalidad,
      totalConsumoGr,
      totalFundas,
      porcentajeMortalidad,
    };
  });

  const totalConsumoGr = resumenGalpones.value.reduce(
    (acc, item) => acc + item.consumoTotalGr,
    0,
  );

  const totalFundas = resumenGalpones.value.reduce(
    (acc, item) => acc + item.fundas,
    0,
  );

  const handleGlobalClick = (event) => {
    if (contextMenu.value.visible) cerrarMenuContextual();

    const dentroDeTabla = event.target.closest(".control-table");
    const dentroDeToolbar = event.target.closest(".format-toolbar");
    const dentroDeEditor = event.target.closest(".cell-editor");

    if (editingCell.value && !dentroDeEditor && !dentroDeTabla) {
      cancelCellEdit();
    }

    if (!dentroDeTabla && !dentroDeToolbar && !seleccion.value.arrastrando) {
      limpiarSeleccion();
    }
  };
  const deshacerUltimaAccion = () => {
    const ultima = historialDeshacer.value.pop();
    if (!ultima) return;

    if (ultima.tipo === "mover-corte") {
      const sheetOrigen = sheets.value[ultima.origen.sheetIndex];
      const sheetDestino = sheets.value[ultima.destino.sheetIndex];

      if (!sheetOrigen || !sheetDestino) return;

      limpiarRango(
        sheetDestino,
        ultima.destino.filaInicio,
        ultima.destino.colInicio,
        ultima.datosMovidos.length,
        ultima.datosMovidos[0]?.length || 0,
      );

      restaurarDatosEnRango(
        sheetOrigen,
        ultima.origen.rango.minFila,
        ultima.origen.rango.minCol,
        ultima.datosOrigen,
      );

      recalcularSheet(sheetOrigen);
      if (sheetDestino !== sheetOrigen) {
        recalcularSheet(sheetDestino);
      } else {
        recalcularSheet(sheetDestino);
      }

      activeTab.value = ultima.origen.sheetIndex;

      seleccion.value.activa = true;
      seleccion.value.arrastrando = false;
      seleccion.value.inicio = {
        fila: ultima.origen.rango.minFila,
        col: ultima.origen.rango.minCol,
      };
      seleccion.value.fin = {
        fila: ultima.origen.rango.maxFila,
        col: ultima.origen.rango.maxCol,
      };

      cortePendiente.value = {
        sheetIndex: ultima.origen.sheetIndex,
        rango: clonarRango(ultima.origen.rango),
      };

      operacionPortapapeles.value = "cortar";
      destinoPegado.value = {
        fila: ultima.destino.filaInicio,
        col: ultima.destino.colInicio,
      };
      pegadoDesdeCorte.value = false;
    }
  };

  const iniciarEdicionDesdeTecla = async (tecla) => {
    if (!currentSheet.value) return;
    if (!seleccion.value.inicio) return;

    const { fila, col } = seleccion.value.inicio;

    if (!esColumnaEditable(col)) return;

    // 🔥 NUEVO: Si es columna numérica y presionan una letra, lo ignoramos por completo
    if (esColumnaNumerica(col) && !/^[0-9.,]$/.test(tecla)) {
      return;
    }

    if (editingCell.value) return;

    await startCellEdit(fila, col);

    editingValue.value = tecla;

    await nextTick();

    const editor = document.querySelector(".cell-editor");
    if (editor) {
      editor.innerText = tecla;
      editor.focus();

      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(editor);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  };

  const handleCellDoubleClick = async (event, fila, col) => {
    // ✅ NUEVO: Si hacemos doble clic en la celda que YA estamos editando,
    // dejamos que el doble clic seleccione la palabra (comportamiento nativo).
    if (isEditingCell(fila, col)) {
      event.stopPropagation();
      return;
    }

    event.preventDefault();

    if (!esColumnaEditable(col)) return;

    // Si estaba editando otra → guardar
    if (editingCell.value && !isEditingCell(fila, col)) {
      commitCellEdit(editingCell.value.fila, editingCell.value.col);
    }

    ultimoPegado.value = null;

    // Iniciar edición
    await startCellEdit(fila, col);
  };

  const handleKeyDownGlobal = (event) => {
    if (editingCell.value) {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelCellEdit();
      }
      return;
    }

    if (event.key === "Escape") {
      cerrarMenuContextual();

      if (operacionPortapapeles.value) {
        cancelarPortapapeles();
      } else {
        limpiarSeleccion();
      }

      return;
    }

    if (event.ctrlKey && (event.key === "z" || event.key === "Z")) {
      event.preventDefault();
      deshacerUltimaAccion();
      return;
    }

    if (!seleccion.value.activa) {
      const quiereCopiarOCortar =
        event.ctrlKey && ["c", "C", "x", "X"].includes(event.key);

      const quiereBorrar = event.key === "Delete" || event.key === "Backspace";

      if ((quiereCopiarOCortar || quiereBorrar) && ultimoPegado.value) {
        convertirUltimoPegadoASeleccion();
      } else {
        return;
      }
    }

    const rango = getRangoSeleccion();
    if (!rango) return;

    //  ESCRIBIR DIRECTO COMO EXCEL
    const esTeclaDeTexto =
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey;

    if (esTeclaDeTexto && seleccion.value.activa && !editingCell.value) {
      event.preventDefault();
      iniciarEdicionDesdeTecla(event.key);
      return;
    }

    //  OPCIONAL: F2 para editar sin borrar contenido
    if (event.key === "F2" && seleccion.value.activa && !editingCell.value) {
      event.preventDefault();
      const { fila, col } = seleccion.value.inicio;
      startCellEdit(fila, col);
      return;
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      for (let f = rango.minFila; f <= rango.maxFila; f++) {
        for (let c = rango.minCol; c <= rango.maxCol; c++) {
          if (![3, 6, 8, 9].includes(c)) {
            const propiedad = COLUMNAS_MAP[c];
            if (propiedad) currentSheet.value.filas[f][propiedad] = "";
          }
        }
      }
      recalcularSheet(currentSheet.value);
      return;
    }

    // ==========================================
    // COPIAR (Ctrl + C)
    // ==========================================
    if (event.ctrlKey && (event.key === "c" || event.key === "C")) {
      event.preventDefault();
      let textoCopiado = "";

      for (let f = rango.minFila; f <= rango.maxFila; f++) {
        const filaTexto = [];
        for (let c = rango.minCol; c <= rango.maxCol; c++) {
          const propiedad = COLUMNAS_MAP[c];
          const valor = currentSheet.value.filas[f][propiedad] || "";
          filaTexto.push(valor);
        }
        textoCopiado += filaTexto.join("\t") + "\n";
      }

      navigator.clipboard.writeText(textoCopiado);
      destinoPegado.value = null;
      ultimoPegado.value = null;
      originalSinFondo.value = false;
      operacionPortapapeles.value = "copiar";

      //  NUEVO: Guardamos las coordenadas para las líneas entrecortadas
      rangoPortapapeles.value = {
        sheetIndex: activeTab.value,
        rango: clonarRango(rango),
      };

      return;
    }

    // ==========================================
    // CORTAR (Ctrl + X)
    // ==========================================
    if (event.ctrlKey && (event.key === "x" || event.key === "X")) {
      event.preventDefault();
      let textoCopiado = "";

      for (let f = rango.minFila; f <= rango.maxFila; f++) {
        const filaTexto = [];
        for (let c = rango.minCol; c <= rango.maxCol; c++) {
          const propiedad = COLUMNAS_MAP[c];
          const valor = currentSheet.value.filas[f][propiedad] || "";
          filaTexto.push(valor);
        }
        textoCopiado += filaTexto.join("\t") + "\n";
      }

      navigator.clipboard.writeText(textoCopiado);

      cortePendiente.value = {
        sheetIndex: activeTab.value,
        rango: {
          minFila: rango.minFila,
          maxFila: rango.maxFila,
          minCol: rango.minCol,
          maxCol: rango.maxCol,
        },
      };

      destinoPegado.value = null;
      ultimoPegado.value = null;
      originalSinFondo.value = false;
      operacionPortapapeles.value = "cortar";

      //  NUEVO: Guardamos las coordenadas para las líneas entrecortadas
      rangoPortapapeles.value = {
        sheetIndex: activeTab.value,
        rango: clonarRango(rango),
      };
    }
  };

  const handlePasteGlobal = (event) => {
    if (editingCell.value) {
      return;
    }
    if (!currentSheet.value) return;
    if (!seleccion.value.inicio) return;

    if (!seleccion.value.activa && document.activeElement.tagName === "INPUT") {
      const texto = event.clipboardData.getData("text");
      if (!texto.includes("\t") && !texto.includes("\n")) return;
    }

    event.preventDefault();

    const textoPegado = event.clipboardData.getData("text");
    if (!textoPegado) return;

    // ✅ SOLUCIÓN: Preservar la estructura de tabulaciones y saltos de línea vacíos
    const filasPega = textoPegado
      .replace(/\r?\n$/, "") // Elimina solo el último salto de línea
      .split(/\r?\n/) // Divide soportando saltos de Windows (\r\n) y normales (\n)
      .map((f) => f.split("\t"));

    const totalFilasPegadas = filasPega.length;
    const totalColsPegadas = Math.max(...filasPega.map((f) => f.length));

    const rango = getRangoSeleccion();

    const filaInicio =
      destinoPegado.value?.fila ??
      (rango ? rango.minFila : seleccion.value.inicio.fila);

    const colInicio =
      destinoPegado.value?.col ??
      (rango ? rango.minCol : seleccion.value.inicio.col);

    const TOTAL_COLUMNAS = 11;
    const COLUMNAS_SOLO_LECTURA = [3, 6, 8, 9];

    // 1. Validar tamaño del rango seleccionado solo cuando NO hay un
    // destino explícito de pegado y realmente existe una selección múltiple.
    if (rango && !destinoPegado.value) {
      const filasSeleccionadas = rango.maxFila - rango.minFila + 1;
      const colsSeleccionadas = rango.maxCol - rango.minCol + 1;

      const esSeleccionMultiple =
        filasSeleccionadas > 1 || colsSeleccionadas > 1;

      if (
        esSeleccionMultiple &&
        (totalFilasPegadas > filasSeleccionadas ||
          totalColsPegadas > colsSeleccionadas)
      ) {
        mostrarMensaje(
          "No se puede pegar",
          `Copiaste un bloque de ${totalFilasPegadas} fila(s) x ${totalColsPegadas} columna(s), pero la selección destino solo tiene ${filasSeleccionadas} fila(s) x ${colsSeleccionadas} columna(s).`,
        );
        return;
      }
    }

    // 2. Validar que no se salga por filas
    if (filaInicio + totalFilasPegadas > currentSheet.value.filas.length) {
      mostrarMensaje(
        "No se puede pegar",
        "El bloque excede el total de filas disponibles.",
      );
      return;
    }

    // 3. Validar que todas las columnas destino sean editables y contiguas reales
    for (let j = 0; j < totalColsPegadas; j++) {
      const colDestino = colInicio + j;

      if (colDestino >= TOTAL_COLUMNAS) {
        mostrarMensaje(
          "No se puede pegar",
          "El bloque excede el ancho de la tabla.",
        );
        return;
      }

      if (!esColumnaEditable(colDestino)) {
        mostrarMensaje(
          "No permitido",
          "El bloque incluye una o más columnas de solo lectura o no editables.",
        );
        return;
      }
    }

    const datosOrigenAntesDeMover =
      operacionPortapapeles.value === "cortar" && cortePendiente.value
        ? obtenerDatosDeRango(
            sheets.value[cortePendiente.value.sheetIndex],
            cortePendiente.value.rango,
          )
        : null;

    // 4. Pegar
    for (let i = 0; i < filasPega.length; i++) {
      const datosFila = filasPega[i];
      const indiceFilaSheet = filaInicio + i;

      if (indiceFilaSheet >= currentSheet.value.filas.length) break;

      for (let j = 0; j < datosFila.length; j++) {
        const indiceColSheet = colInicio + j;
        const valor = datosFila[j].trim();

        if (esColumnaEditable(indiceColSheet)) {
          const propiedad = COLUMNAS_MAP[indiceColSheet];
          if (propiedad && valor !== undefined) {
            currentSheet.value.filas[indiceFilaSheet][propiedad] = valor;
          }
        }
      }
    }

    if (
      operacionPortapapeles.value === "cortar" &&
      cortePendiente.value &&
      typeof cortePendiente.value.sheetIndex === "number"
    ) {
      const sheetOrigen = sheets.value[cortePendiente.value.sheetIndex];
      const rangoOrigen = cortePendiente.value.rango;

      if (sheetOrigen && rangoOrigen) {
        pushHistorial({
          tipo: "mover-corte",
          origen: {
            sheetIndex: cortePendiente.value.sheetIndex,
            rango: clonarRango(rangoOrigen),
          },
          destino: {
            sheetIndex: activeTab.value,
            filaInicio,
            colInicio,
          },
          datosOrigen: datosOrigenAntesDeMover,
          datosMovidos: filasPega.map((fila) => [...fila]),
        });

        for (let f = rangoOrigen.minFila; f <= rangoOrigen.maxFila; f++) {
          for (let c = rangoOrigen.minCol; c <= rangoOrigen.maxCol; c++) {
            if (!COLUMNAS_SOLO_LECTURA.includes(c)) {
              const propiedad = COLUMNAS_MAP[c];
              if (propiedad) {
                sheetOrigen.filas[f][propiedad] = "";
              }
            }
          }
        }

        recalcularSheet(sheetOrigen);
        pegadoDesdeCorte.value = true;
      }
    } else {
      pegadoDesdeCorte.value = false;
    }

    recalcularSheet(currentSheet.value);

    if (operacionPortapapeles.value === "cortar" && cortePendiente.value) {
      const rangoOrigen = cortePendiente.value.rango;

      seleccion.value.activa = true;
      seleccion.value.arrastrando = false;
      seleccion.value.inicio = {
        fila: rangoOrigen.minFila,
        col: rangoOrigen.minCol,
      };
      seleccion.value.fin = {
        fila: rangoOrigen.maxFila,
        col: rangoOrigen.maxCol,
      };
    }

    recalcularSheet(currentSheet.value);

    ultimoPegado.value = {
      minFila: filaInicio,
      maxFila: filaInicio + totalFilasPegadas - 1,
      minCol: colInicio,
      maxCol: colInicio + totalColsPegadas - 1,
    };
    //  NUEVO: Actualizamos la selección nativa para que envuelva todo el bloque pegado
    seleccion.value.activa = true;
    seleccion.value.inicio = { fila: filaInicio, col: colInicio };
    seleccion.value.fin = {
      fila: filaInicio + totalFilasPegadas - 1,
      col: colInicio + totalColsPegadas - 1,
    };

    if (operacionPortapapeles.value !== null) {
      originalSinFondo.value = true;
    }
  };

  const reiniciarConjunto = () => {
    conjunto.value = {
      id: crearIdLote(),
      nombre: `Conjunto ${Date.now()}`,
      descripcion: "",
    };

    sheets.value = [crearSheetVacia(1)];
    activeTab.value = 0;
    selectedTabs.value = [0];

    limpiarSeleccion();
    cancelarPortapapeles();
    ultimoPegado.value = null;
    originalSinFondo.value = false;
    historialDeshacer.value = [];
  };

  const nuevoConjunto = () => {
    abrirConfirmacion(
      "Nuevo conjunto",
      "¿Deseas crear un nuevo conjunto? Se limpiarán los datos actuales en pantalla.",
      () => {
        reiniciarConjunto();
      },
      "Crear",
      "primary", // opcional
      true,
    );
  };

  onMounted(async () => {
    try {
      await initDB();
    } catch (error) {
      console.error("Error inicializando SQLite:", error);
    }
    window.addEventListener("blur", marcarBlurVentana);
    window.addEventListener("focus", marcarFocusVentana);
    window.addEventListener("click", handleGlobalClick);
    window.addEventListener("keydown", handleKeyDownGlobal);
    window.addEventListener("mouseup", finalizarSeleccionCeldas);
    window.addEventListener("paste", handlePasteGlobal);
    window.addEventListener("mousemove", handleMouseMoveGlobal);
  });

  // --- NUEVO ESTADO PARA EL TOOLTIP DE REDIMENSIÓN ---
  const resizeTooltip = ref({
    visible: false,
    text: "",
    x: 0,
    y: 0,
  });

  // --- NUEVO ESTADO PARA REDIMENSIONAR COLUMNAS Y FILAS ---
  const colWidths = ref({});
  const rowHeights = ref({});

  const DEFAULT_ROW_HEIGHT = 32;

  const DEFAULT_COL_WIDTHS = {
    semanas: null,
    dia: null,
    0: null,
    1: null,
    2: null,
    3: null,
    4: null,
    5: null,
    6: null,
    7: null,
    8: null,
    9: null,
    10: null,
  };

  const startResizeCol = (event, colIndex) => {
    const startX = event.pageX;
    const th = event.target.parentElement;
    const startWidth = th.offsetWidth;

    // 🧊 ¡NUEVO!: Congelar el tamaño del resto de las columnas para evitar que se encojan
    const table = th.closest("table");
    const resizableThs = table.querySelectorAll("th[data-col]");

    resizableThs.forEach((header) => {
      const key = header.getAttribute("data-col");
      // Convertimos a número si es necesario para mantener la consistencia en tu objeto
      const parsedKey = isNaN(key) ? key : Number(key);

      // Si la columna está en 'auto', le asignamos su tamaño real en pantalla
      if (key !== null && !colWidths.value[parsedKey]) {
        colWidths.value[parsedKey] = header.offsetWidth;
      }
    });

    // Mostrar el tooltip "ANCHO" en la posición inicial del clic
    resizeTooltip.value = {
      visible: true,
      text: "ANCHO",
      x: event.pageX + 15,
      y: event.pageY + 15,
    };

    document.body.classList.add("is-resizing-col");

    const onMouseMove = (e) => {
      const newWidth = Math.max(40, startWidth + (e.pageX - startX));
      colWidths.value[colIndex] = newWidth;
    };

    const onMouseUp = () => {
      resizeTooltip.value.visible = false;
      document.body.classList.remove("is-resizing-col");
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  const startResizeRow = (event, rowIndex) => {
    const startY = event.pageY;
    const startHeight = event.target.parentElement.offsetHeight;

    // Mostrar el tooltip "ALTO" en la posición inicial del clic
    resizeTooltip.value = {
      visible: true,
      text: "ALTO",
      x: event.pageX + 15,
      y: event.pageY + 15,
    };

    // 🔴 NUEVO: Forzamos la clase en el body al iniciar el arrastre
    document.body.classList.add("is-resizing-row");

    const onMouseMove = (e) => {
      // Solo calculamos y aplicamos el nuevo alto, el tooltip se queda quieto
      const newHeight = Math.max(30, startHeight + (e.pageY - startY));
      rowHeights.value[rowIndex] = newHeight;
    };

    const onMouseUp = () => {
      // Ocultar el tooltip al soltar el clic
      resizeTooltip.value.visible = false;

      // 🔴 NUEVO: Quitamos la clase del body al soltar el clic
      document.body.classList.remove("is-resizing-row");

      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  const resetResizeCol = (colIndex) => {
    delete colWidths.value[colIndex];

    resizeTooltip.value = {
      visible: true,
      text: "ANCHO RESTAURADO",
      x: window.innerWidth / 2 - 60,
      y: 20,
    };

    setTimeout(() => {
      resizeTooltip.value.visible = false;
    }, 900);
  };

  const resetResizeRow = (rowIndex) => {
    delete rowHeights.value[rowIndex];

    resizeTooltip.value = {
      visible: true,
      text: "ALTO RESTAURADO",
      x: window.innerWidth / 2 - 50,
      y: 20,
    };

    setTimeout(() => {
      resizeTooltip.value.visible = false;
    }, 900);
  };

  // --- NUEVO ESTADO PARA ALINEACIÓN DE CELDAS ---
  // Almacena la alineación. Clave: 'fila-columna', Valor: { h: 'left', v: 'top' }
  const cellFormats = ref({});

  const getFormatoCelda = (fila, col) => {
    const key = `${fila}-${col}`;
    if (!cellFormats.value[key]) {
      cellFormats.value[key] = {
        h: "center",
        v: "middle",
        wrap: false,
      };
    }
    return cellFormats.value[key];
  };

  const aplicarAjusteTexto = () => {
    const rango = getRangoSeleccion();

    if (rango) {
      const primeraCelda = getFormatoCelda(rango.minFila, rango.minCol);
      const nuevoValor = !primeraCelda.wrap;

      for (let f = rango.minFila; f <= rango.maxFila; f++) {
        for (let c = rango.minCol; c <= rango.maxCol; c++) {
          const formato = getFormatoCelda(f, c);
          formato.wrap = nuevoValor;
        }
      }
    } else if (seleccion.value.inicio) {
      const f = seleccion.value.inicio.fila;
      const c = seleccion.value.inicio.col;
      const formato = getFormatoCelda(f, c);
      formato.wrap = !formato.wrap;
    }
  };

  const getEstiloTextoCelda = (fila, col) => {
    const formato = cellFormats.value[`${fila}-${col}`];
    const h = formato?.h || "center";
    const v = formato?.v || "center"; // <-- 1. Leemos la alineación
    const wrap = formato?.wrap || false;

    return {
      textAlign: h,
      whiteSpace: wrap ? "pre-wrap" : "nowrap",
      overflowWrap: wrap ? "anywhere" : "normal",
      wordBreak: wrap ? "break-word" : "normal",
      overflow: wrap ? "visible" : "hidden",
      textOverflow: wrap ? "unset" : "clip",
      // <-- 2. Le decimos a Flexbox cómo alinear el texto internamente
      alignItems:
        v === "top" ? "flex-start" : v === "bottom" ? "flex-end" : "center",
      justifyContent:
        h === "left" ? "flex-start" : h === "right" ? "flex-end" : "center",
    };
  };

  const getEstiloEditorCelda = (fila, col) => {
    const formato = cellFormats.value[`${fila}-${col}`];
    const h = formato?.h || "center";
    const wrap = formato?.wrap || false;

    return {
      textAlign: h,
      whiteSpace: wrap ? "pre-wrap" : "nowrap",
      overflowWrap: wrap ? "anywhere" : "normal",
      wordBreak: wrap ? "break-word" : "normal",
      overflowY: wrap ? "auto" : "hidden",
      overflowX: "hidden",
    };
  };

  const aplicarAlineacion = (eje, valor) => {
    const rango = getRangoSeleccion();

    if (rango) {
      for (let f = rango.minFila; f <= rango.maxFila; f++) {
        for (let c = rango.minCol; c <= rango.maxCol; c++) {
          const formato = getFormatoCelda(f, c);
          formato[eje] = valor;
        }
      }
    } else if (seleccion.value.inicio) {
      const f = seleccion.value.inicio.fila;
      const c = seleccion.value.inicio.col;
      const formato = getFormatoCelda(f, c);
      formato[eje] = valor;
    }
  };

  const getEstiloAlineacion = (fila, col) => {
    const formato = cellFormats.value[`${fila}-${col}`];

    return {
      textAlign: formato?.h || "center",
      verticalAlign:
        formato?.v === "top"
          ? "top"
          : formato?.v === "bottom"
            ? "bottom"
            : "middle",
    };
  };

  const getEstiloContenidoAlineacion = (fila, col) => {
    const formato = cellFormats.value[`${fila}-${col}`];

    const h = formato?.h || "center";
    const v = formato?.v || "middle";
    const wrap = formato?.wrap || false;

    return {
      justifyContent:
        h === "left" ? "flex-start" : h === "right" ? "flex-end" : "center",
      alignItems:
        v === "top" ? "flex-start" : v === "bottom" ? "flex-end" : "center",
      textAlign: h,
      whiteSpace: wrap ? "normal" : "nowrap",
    };
  };

  // Nueva función para saber si un botón debe estar activo
  const esFormatoActivo = (eje, valor) => {
    if (!seleccion.value.inicio) return false;

    // Obtenemos el formato de la celda principal de la selección actual
    const { fila, col } = seleccion.value.inicio;
    const formato = getFormatoCelda(fila, col);

    // Si estamos consultando el ajuste de texto (wrap)
    if (eje === "wrap") {
      return formato.wrap === true;
    }

    // Si estamos consultando alineación horizontal (h) o vertical (v)
    return formato[eje] === valor;
  };

  onBeforeUnmount(() => {
    window.removeEventListener("blur", marcarBlurVentana);
    window.removeEventListener("focus", marcarFocusVentana);
    window.removeEventListener("click", handleGlobalClick);
    window.removeEventListener("keydown", handleKeyDownGlobal);
    window.removeEventListener("mouseup", finalizarSeleccionCeldas);
    window.removeEventListener("paste", handlePasteGlobal);
    window.removeEventListener("mousemove", handleMouseMoveGlobal);
  });

  return {
    selectedTabs,
    esFormatoActivo,
    resetResizeCol,
    resetResizeRow,
    resizeTooltip,
    aplicarAjusteTexto,
    getEstiloTextoCelda,
    getEstiloEditorCelda,
    sheets,
    activeTab,
    contextMenu,
    seleccion,
    operacionPortapapeles,
    esTabEstadisticas,
    currentSheet,
    puedeAgregarSheet,
    totalAlimentoActual,
    totalGasActual,
    totalMortalidadActual,
    mortalidadPorcentajeFinalActual,
    tablaConsumoActual,
    totalConsumoGrActual,
    totalFundasActual,
    resumenGalpones,
    estadisticasGenerales,
    addSheet,
    irAEstadisticas,
    irASheet,
    abrirMenuContextual,
    cerrarMenuContextual,
    eliminarSheet,
    handleCellMouseDown,
    handleCellMouseEnter,
    finalizarSeleccionCeldas,
    estaCeldaSeleccionada,
    obtenerClasesSeleccion,
    limpiarSeleccion,
    getRangoSeleccion,
    calcularAlimentoHasta,
    calcularGasHasta,
    calcularMortalidadHasta,
    recalcularSheet,
    getTablaConsumoSheet,
    getTotalConsumoGrSheet,
    getTotalFundasSheet,
    onCantidadChange,
    guardar,
    modalMensaje,
    cerrarMensaje,
    modalConfirmacion,
    confirmarAccion,
    cerrarConfirmacion,
    handleInputFocus,
    handleInputEdit,
    conjunto,
    reiniciarConjunto,
    nuevoConjunto,
    esCeldaUnicaSeleccionada,
    iniciarArrastreFill,
    colWidths,
    rowHeights,
    startResizeCol,
    startResizeRow,
    aplicarAlineacion,
    getEstiloAlineacion,
    getEstiloContenidoAlineacion,
    editingCell,
    editingValue,
    isEditingCell,
    startCellEdit,
    handleEditableInput,
    commitCellEdit,
    cancelCellEdit,
    handleEditorKeydown,
    handleCellClick,
    bloquearSeleccionNativa,
    handleCellDoubleClick,
    tablaExpandida,
    toggleTablaExpandida,
    modalExportacion,
    abrirExportacion,
    cerrarExportacion,
    exportarDatos,
    exportando,
    estadoGuardado,
    setTableWrapperRef,
    pasoExportacion,
    galponesAExportar,
    siguientePasoExportacion,
    todosGalponesSeleccionados,
    toggleTodosGalpones,
  };
}
