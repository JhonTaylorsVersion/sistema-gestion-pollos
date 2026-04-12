<script setup lang="ts">
import { ref, computed, watch } from "vue";
import Database from "@tauri-apps/plugin-sql";
import ExcelJS from "exceljs";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import JSZip from "jszip";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useDrive } from "./composables/useDrive";

type PdfCell =
  | string
  | number
  | {
      content: string | number;
      rowSpan?: number;
      colSpan?: number;
    };

type PdfRow = PdfCell[];

type ResultadoBusqueda = {
  codigo_conjunto: string;
  nombre_conjunto: string;
  descripcion_conjunto: string;
  codigo_galpon: string;
  nombre: string;
  granja: string;
  lote: string;
  galpon: string;
  fecha_ingreso: string;
  procedencia: string;
  cantidad: number;
  dia: number;
  semana: number;
  fecha: string;
  alimento_cant: string;
  alimento_diario: number;
  alimento_acum: number;
  medicina: string;
  gas_diario: number;
  gas_acum: number;
  mort_diaria: number;
  mort_acum: number;
  mort_porcentaje: number;
  observacion: string;
};

type GalponData = {
  id: string;
  nombre: string;
  granja: string;
  lote: string;
  galpon: string;
  fecha_ingreso: string;
  procedencia: string;
  cantidad: number;
  codigo_conjunto: string;
  nombre_conjunto: string;
  descripcion_conjunto: string;
  filas: ResultadoBusqueda[];
  totalAlimento: number;
  totalGas: number;
  totalMortalidad: number;
  porcentajeMortalidad: number;
};

type GalponResumen = {
  id: string;
  nombre: string;
  granja: string;
  lote: string;
  galpon: string;
  fecha_ingreso: string;
  procedencia: string;
  cantidad: number;
  conjunto_id: string;
  conjunto_nombre: string;
};

type ConjuntoResumen = {
  id: string;
  nombre: string;
  descripcion: string;
  totalGalpones: number;
  totalCantidad: number;
};

// Añadimos "detalle" y "sincronizacion" a las secciones posibles
type SeccionActiva = "busqueda" | "galpones" | "conjuntos" | "detalle" | "sincronizacion";

// Saber si la última búsqueda fue general (sin filtros)
const busquedaSinFiltros = ref(false);

// Agrupar los galpones por conjunto para la vista de tabla
const galponesAgrupados = computed(() => {
  if (!busquedaSinFiltros.value) return [];

  const map = new Map<
    string,
    {
      id: string;
      nombre: string;
      galpones: { index: number; data: GalponData }[];
    }
  >();

  galpones.value.forEach((g, index) => {
    // Usamos el código del conjunto, o "SIN CONJUNTO" si por algún motivo viene vacío
    const conjuntoId = g.codigo_conjunto || "SIN CONJUNTO";

    if (!map.has(conjuntoId)) {
      map.set(conjuntoId, {
        id: conjuntoId,
        nombre: g.nombre_conjunto,
        galpones: [],
      });
    }
    // Guardamos el índice original para que al hacer clic en el tab, seleccione el correcto
    map.get(conjuntoId)!.galpones.push({ index, data: g });
  });

  return Array.from(map.values());
});

const autenticado = ref(false);

const loginForm = ref({
  usuario: "",
  password: "",
});

const seccionActiva = ref<SeccionActiva>("busqueda");
// Variable para recordar a dónde debe volver el botón "Regresar"
const origenDetalle = ref<SeccionActiva | null>(null);

const seccionSidebarActiva = computed<"busqueda" | "galpones" | "conjuntos" | "sincronizacion">(
  () => {
    if (seccionActiva.value === "detalle") {
      if (origenDetalle.value === "galpones") return "galpones";
      if (origenDetalle.value === "conjuntos") return "conjuntos";
      return "busqueda";
    }

    return seccionActiva.value as "busqueda" | "galpones" | "conjuntos" | "sincronizacion";
  },
);

const filtros = ref({
  fechaDesde: "",
  fechaHasta: "",
  codigoGalpon: "",
  codigoConjunto: "",
});

const busquedaGalpones = ref("");
const busquedaConjuntos = ref("");

const galpones = ref<GalponData[]>([]);
const galponesLista = ref<GalponResumen[]>([]);
const conjuntosLista = ref<ConjuntoResumen[]>([]);

const activeTab = ref<number | "stats">(0);
const buscando = ref(false);
const cargandoGalpones = ref(false);
const cargandoConjuntos = ref(false);

let db: Database | null = null;

const initDB = async () => {
  if (db) return db;
  db = await Database.load("sqlite:pollos.db");
  return db;
};

const iniciarSesion = async () => {
  if (
    loginForm.value.usuario === "admin" &&
    loginForm.value.password === "1234"
  ) {
    autenticado.value = true;
    console.log("✅ Sesión iniciada");

    await Promise.all([cargarGalpones(), cargarConjuntos()]);
  } else {
    alert("Credenciales incorrectas");
  }
};

const cerrarSesion = () => {
  autenticado.value = false;
  loginForm.value.usuario = "";
  loginForm.value.password = "";
  seccionActiva.value = "busqueda";
  origenDetalle.value = null;

  limpiarFiltros();

  galponesLista.value = [];
  conjuntosLista.value = [];
  busquedaGalpones.value = "";
  busquedaConjuntos.value = "";
};

const cambiarSeccion = async (seccion: SeccionActiva) => {
  seccionActiva.value = seccion;

  if (seccion === "busqueda") {
    origenDetalle.value = null;
    galpones.value = [];
    activeTab.value = 0;
    busquedaSinFiltros.value = false;
  }

  if (seccion === "galpones" && galponesLista.value.length === 0) {
    await cargarGalpones();
  }

  if (seccion === "conjuntos" && conjuntosLista.value.length === 0) {
    await cargarConjuntos();
  }
};

const cargarGalpones = async () => {
  try {
    cargandoGalpones.value = true;
    const database = await initDB();

    const query = `
      SELECT
        s.id AS id,
        s.nombre AS nombre,
        s.granja AS granja,
        s.lote AS lote,
        s.galpon AS galpon,
        s.fecha_ingreso AS fecha_ingreso,
        s.procedencia AS procedencia,
        s.cantidad AS cantidad,
        c.id AS conjunto_id,
        c.nombre AS conjunto_nombre
      FROM sheets s
      INNER JOIN conjuntos c ON s.conjunto_id = c.id
      ORDER BY s.nombre ASC, s.id ASC
    `;

    const rows = await database.select<GalponResumen[]>(query);
    galponesLista.value = rows || [];
  } catch (error) {
    console.error("❌ Error al cargar galpones:", error);
    alert("No se pudieron cargar los galpones.");
  } finally {
    cargandoGalpones.value = false;
  }
};

const cargarConjuntos = async () => {
  try {
    cargandoConjuntos.value = true;
    const database = await initDB();

    const query = `
      SELECT
        c.id AS id,
        c.nombre AS nombre,
        c.descripcion AS descripcion,
        COUNT(s.id) AS totalGalpones,
        COALESCE(SUM(s.cantidad), 0) AS totalCantidad
      FROM conjuntos c
      LEFT JOIN sheets s ON s.conjunto_id = c.id
      GROUP BY c.id, c.nombre, c.descripcion
      ORDER BY c.nombre ASC, c.id ASC
    `;

    const rows = await database.select<ConjuntoResumen[]>(query);
    conjuntosLista.value = rows || [];
  } catch (error) {
    console.error("❌ Error al cargar conjuntos:", error);
    alert("No se pudieron cargar los conjuntos.");
  } finally {
    cargandoConjuntos.value = false;
  }
};

const buscarRegistros = async () => {
  try {
    buscando.value = true;

    // Evaluar si hay algún filtro activo antes de buscar
    const hayFiltros =
      filtros.value.codigoGalpon.trim() !== "" ||
      filtros.value.codigoConjunto.trim() !== "" ||
      filtros.value.fechaDesde !== "" ||
      filtros.value.fechaHasta !== "";

    busquedaSinFiltros.value = !hayFiltros;

    const database = await initDB();

    let query = `
      SELECT
        c.id AS codigo_conjunto,
        c.nombre AS nombre_conjunto,
        c.descripcion AS descripcion_conjunto,
        s.id AS codigo_galpon,
        s.nombre AS nombre,
        s.granja AS granja,
        s.lote AS lote,
        s.galpon AS galpon,
        s.fecha_ingreso AS fecha_ingreso,
        s.procedencia AS procedencia,
        s.cantidad AS cantidad,
        f.dia AS dia,
        f.semana AS semana,
        f.fecha AS fecha,
        f.alimento_cant AS alimento_cant,
        f.alimento_diario AS alimento_diario,
        f.alimento_acum AS alimento_acum,
        f.medicina AS medicina,
        f.gas_diario AS gas_diario,
        f.gas_acum AS gas_acum,
        f.mort_diaria AS mort_diaria,
        f.mort_acum AS mort_acum,
        f.mort_porcentaje AS mort_porcentaje,
        f.observacion AS observacion
      FROM sheets s
      INNER JOIN filas f ON s.id = f.sheet_id
      INNER JOIN conjuntos c ON s.conjunto_id = c.id
      WHERE 1 = 1
    `;

    const params: (string | number)[] = [];

    if (filtros.value.codigoGalpon.trim()) {
      query += ` AND s.id LIKE ? `;
      params.push(`%${filtros.value.codigoGalpon.trim()}%`);
    }

    if (filtros.value.codigoConjunto.trim()) {
      query += ` AND (c.id LIKE ? OR c.nombre LIKE ?) `;
      params.push(`%${filtros.value.codigoConjunto.trim()}%`);
      params.push(`%${filtros.value.codigoConjunto.trim()}%`);
    }

    if (filtros.value.fechaDesde) {
      query += ` AND f.fecha >= ? `;
      params.push(filtros.value.fechaDesde);
    }

    if (filtros.value.fechaHasta) {
      query += ` AND f.fecha <= ? `;
      params.push(filtros.value.fechaHasta);
    }

    query += ` ORDER BY c.id ASC, s.id ASC, f.fecha ASC, f.dia ASC `;

    const rows = await database.select<ResultadoBusqueda[]>(query, params);

    procesarFilasObtenidas(rows);

    activeTab.value = 0;
    seccionActiva.value = "busqueda";
  } catch (error) {
    console.error("❌ Error al buscar registros:", error);
    alert("No se pudo realizar la búsqueda.");
  } finally {
    buscando.value = false;
  }
};

// NUEVA FUNCIÓN: Para ver un galpón o conjunto específico
const verDetalle = async (
  tipo: "galpon" | "conjunto",
  id: string,
  origen: SeccionActiva,
) => {
  try {
    buscando.value = true;

    //  LÍNEA AÑADIDA PARA APAGAR LA AGRUPACIÓN
    busquedaSinFiltros.value = false;

    const database = await initDB();

    let query = `
      SELECT
        c.id AS codigo_conjunto,
        c.nombre AS nombre_conjunto,
        c.descripcion AS descripcion_conjunto,
        s.id AS codigo_galpon,
        s.nombre AS nombre,
        s.granja AS granja,
        s.lote AS lote,
        s.galpon AS galpon,
        s.fecha_ingreso AS fecha_ingreso,
        s.procedencia AS procedencia,
        s.cantidad AS cantidad,
        f.dia AS dia,
        f.semana AS semana,
        f.fecha AS fecha,
        f.alimento_cant AS alimento_cant,
        f.alimento_diario AS alimento_diario,
        f.alimento_acum AS alimento_acum,
        f.medicina AS medicina,
        f.gas_diario AS gas_diario,
        f.gas_acum AS gas_acum,
        f.mort_diaria AS mort_diaria,
        f.mort_acum AS mort_acum,
        f.mort_porcentaje AS mort_porcentaje,
        f.observacion AS observacion
      FROM sheets s
      INNER JOIN filas f ON s.id = f.sheet_id
      INNER JOIN conjuntos c ON s.conjunto_id = c.id
      WHERE 1 = 1
    `;

    const params: (string | number)[] = [];

    if (tipo === "galpon") {
      query += ` AND s.id = ? `;
      params.push(id);
    } else if (tipo === "conjunto") {
      query += ` AND c.id = ? `;
      params.push(id);
    }

    query += ` ORDER BY c.id ASC, s.id ASC, f.fecha ASC, f.dia ASC `;

    const rows = await database.select<ResultadoBusqueda[]>(query, params);

    procesarFilasObtenidas(rows);

    // Si es conjunto mostramos las stats por defecto, si es galpón mostramos el tab 0
    activeTab.value = tipo === "conjunto" ? "stats" : 0;

    // Guardamos de donde vinimos y cambiamos la vista a 'detalle'
    origenDetalle.value = origen;
    seccionActiva.value = "detalle";
  } catch (error) {
    console.error("❌ Error al cargar detalle:", error);
    alert("No se pudo cargar la vista de detalle.");
  } finally {
    buscando.value = false;
  }
};

const procesarFilasObtenidas = (rows: ResultadoBusqueda[]) => {
  const mapAgrupado = new Map<string, GalponData>();

  for (const row of rows) {
    if (!mapAgrupado.has(row.codigo_galpon)) {
      mapAgrupado.set(row.codigo_galpon, {
        id: row.codigo_galpon,
        nombre: row.nombre,
        granja: row.granja,
        lote: row.lote,
        galpon: row.galpon,
        fecha_ingreso: row.fecha_ingreso,
        procedencia: row.procedencia,
        cantidad: row.cantidad,
        codigo_conjunto: row.codigo_conjunto,
        nombre_conjunto: row.nombre_conjunto,
        descripcion_conjunto: row.descripcion_conjunto,
        filas: [],
        totalAlimento: 0,
        totalGas: 0,
        totalMortalidad: 0,
        porcentajeMortalidad: 0,
      });
    }
    mapAgrupado.get(row.codigo_galpon)!.filas.push(row);
  }

  galpones.value = Array.from(mapAgrupado.values()).map((g) => {
    const ultimaFila = g.filas[g.filas.length - 1];
    if (ultimaFila) {
      g.totalAlimento = ultimaFila.alimento_acum || 0;
      g.totalGas = ultimaFila.gas_acum || 0;
      g.totalMortalidad = ultimaFila.mort_acum || 0;
      g.porcentajeMortalidad = ultimaFila.mort_porcentaje || 0;
    }
    return g;
  });
};

const limpiarFiltros = () => {
  filtros.value.fechaDesde = "";
  filtros.value.fechaHasta = "";
  filtros.value.codigoGalpon = "";
  filtros.value.codigoConjunto = "";
  galpones.value = [];
  activeTab.value = 0;
};

// Función para regresar desde la vista de Detalle
const regresarDeDetalle = () => {
  if (origenDetalle.value) {
    seccionActiva.value = origenDetalle.value;
    origenDetalle.value = null;
    // Opcional: Limpiamos los galpones cargados en detalle para no ensuciar la Búsqueda
    galpones.value = [];
  }
};

const currentGalpon = computed(() => {
  if (activeTab.value === "stats" || galpones.value.length === 0) return null;
  return galpones.value[activeTab.value as number];
});

const resumenGalpones = computed(() => {
  return galpones.value.map((g, index) => ({
    id: g.id,
    numero: index + 1,
    galpon: g.galpon,
    lote: g.lote,
    cantidad: g.cantidad,
    alimento: g.totalAlimento,
    gas: g.totalGas,
    mortalidad: g.totalMortalidad,
    porcentaje: g.porcentajeMortalidad,
  }));
});

const estadisticasGenerales = computed(() => {
  const totalGalpones = galpones.value.length;
  const totalCantidad = galpones.value.reduce(
    (acc, g) => acc + (g.cantidad || 0),
    0,
  );
  const totalAlimento = galpones.value.reduce(
    (acc, g) => acc + g.totalAlimento,
    0,
  );
  const totalGas = galpones.value.reduce((acc, g) => acc + g.totalGas, 0);
  const totalMortalidad = galpones.value.reduce(
    (acc, g) => acc + g.totalMortalidad,
    0,
  );

  const porcentajeMortalidad =
    totalCantidad > 0
      ? ((totalMortalidad / totalCantidad) * 100).toFixed(2)
      : 0;

  return {
    totalGalpones,
    totalCantidad,
    totalAlimento,
    totalGas,
    totalMortalidad,
    porcentajeMortalidad,
  };
});

const galponesFiltrados = computed(() => {
  const texto = busquedaGalpones.value.trim().toLowerCase();

  if (!texto) return galponesLista.value;

  return galponesLista.value.filter((g) => {
    return (
      g.id?.toLowerCase().includes(texto) ||
      g.nombre?.toLowerCase().includes(texto) ||
      g.granja?.toLowerCase().includes(texto) ||
      g.lote?.toLowerCase().includes(texto) ||
      g.galpon?.toLowerCase().includes(texto) ||
      g.conjunto_id?.toLowerCase().includes(texto) ||
      g.conjunto_nombre?.toLowerCase().includes(texto)
    );
  });
});

const conjuntosFiltrados = computed(() => {
  const texto = busquedaConjuntos.value.trim().toLowerCase();

  if (!texto) return conjuntosLista.value;

  return conjuntosLista.value.filter((c) => {
    return (
      c.id?.toLowerCase().includes(texto) ||
      c.nombre?.toLowerCase().includes(texto) ||
      (c.descripcion || "").toLowerCase().includes(texto)
    );
  });
});

// ==========================================
// --- MODALES REUTILIZABLES DE MENSAJE Y CONFIRMACIÓN ---
// ==========================================
const modalMensaje = ref({
  visible: false,
  titulo: "",
  texto: "",
});

const mostrarMensaje = (titulo: string, texto: string) => {
  modalMensaje.value = { visible: true, titulo, texto };
};

const cerrarMensaje = () => {
  modalMensaje.value.visible = false;
};

const modalConfirmacion = ref({
  visible: false,
  titulo: "",
  texto: "",
  onConfirm: null as Function | null,
  textoConfirmar: "Aceptar",
  tipo: "normal",
});

const abrirConfirmacion = (
  titulo: string,
  texto: string,
  onConfirm: Function,
  textoConfirmar = "Aceptar",
  tipo = "normal",
) => {
  modalConfirmacion.value = {
    visible: true,
    titulo,
    texto,
    onConfirm,
    textoConfirmar,
    tipo,
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
  };
};

// ==========================================
// --- LÓGICA DE EXPORTACIÓN PARA ADMIN ---
// ==========================================
const modalExportacion = ref({ visible: false });
const exportando = ref(false);

const abrirExportacion = () => {
  modalExportacion.value.visible = true;
};
const cerrarExportacion = () => {
  if (!exportando.value) modalExportacion.value.visible = false;
};

const sanitizarNombreArchivo = (texto: string) => {
  return (texto || "exportacion")
    .toString()
    .trim()
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "_");
};

const sanitizarNombreHojaExcel = (texto: string, fallback = "Hoja") => {
  const limpio = (texto || fallback)
    .toString()
    .replace(/[\\/*?:[\]]/g, "")
    .trim();
  return (limpio || fallback).slice(0, 31);
};

// Helpers para calcular el consumo total requerido por los reportes
const getTablaConsumoGalpon = (galpon: GalponData) => {
  const cantidadInicial = galpon.cantidad || 0;
  return galpon.filas.map((fila) => {
    let cantidadPollos = cantidadInicial;
    if (USAR_MORTALIDAD_EN_CONSUMO) {
      cantidadPollos = Math.max(0, cantidadInicial - (fila.mort_acum || 0));
    }
    const consumoIndividualGr = fila.alimento_diario || 0;
    const consumoTotalGr = cantidadPollos * consumoIndividualGr;
    const fundas = consumoTotalGr
      ? Math.round(consumoTotalGr / GRAMOS_POR_FUNDA)
      : 0;
    return {
      semana: fila.semana,
      dia: fila.dia,
      fecha: fila.fecha || "",
      cantidadPollos,
      consumoIndividualGr,
      consumoTotalGr,
      fundas,
    };
  });
};

const getTotalConsumoGrGalpon = (galpon: GalponData) =>
  getTablaConsumoGalpon(galpon).reduce((acc, f) => acc + f.consumoTotalGr, 0);
const getTotalFundasGalpon = (galpon: GalponData) =>
  getTablaConsumoGalpon(galpon).reduce((acc, f) => acc + f.fundas, 0);

const crearExcelBuffer = async (): Promise<Uint8Array> => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Sistema Gestión Pollos (Admin)";
  workbook.created = new Date();

  const nombreConjunto = galpones.value[0]?.nombre_conjunto || "";
  const codigoConjunto = galpones.value[0]?.codigo_conjunto || "";

  galpones.value.forEach((sheet, index) => {
    const nombreGalpon = sheet.nombre || `Galpon ${index + 1}`;
    const ws = workbook.addWorksheet(sanitizarNombreHojaExcel(nombreGalpon));
    const cantidadInicial = Number(sheet.cantidad) || 0;

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
      `Lote: ${nombreConjunto} | Código Lote: ${codigoConjunto}`;
    ws.getCell("A2").alignment = { horizontal: "center" };

    ws.getCell("A4").value = "Código Galpón:";
    ws.getCell("B4").value = sheet.id || "";
    ws.getCell("D4").value = "Granja:";
    ws.getCell("E4").value = sheet.granja || "";
    ws.getCell("G4").value = "Lote:";
    ws.getCell("H4").value = sheet.lote || "";
    ws.getCell("J4").value = "Galpón:";
    ws.getCell("K4").value = sheet.galpon || "";

    ws.getCell("A5").value = "Fecha ingreso:";
    ws.getCell("B5").value = sheet.fecha_ingreso || "";
    ws.getCell("D5").value = "Procedencia:";
    ws.getCell("E5").value = sheet.procedencia || "";
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
      ws.getCell(`D${excelRow}`).value = fila.alimento_cant || "";
      ws.getCell(`E${excelRow}`).value =
        fila.alimento_diario === 0 || fila.alimento_diario === null
          ? ""
          : Number(fila.alimento_diario);
      ws.getCell(`F${excelRow}`).value =
        fila.alimento_acum === 0 || fila.alimento_acum === null
          ? ""
          : Number(fila.alimento_acum);
      ws.getCell(`G${excelRow}`).value = fila.medicina || "";
      ws.getCell(`H${excelRow}`).value =
        fila.gas_diario === 0 || fila.gas_diario === null
          ? ""
          : Number(fila.gas_diario);
      ws.getCell(`I${excelRow}`).value =
        fila.gas_acum === 0 || fila.gas_acum === null
          ? ""
          : Number(fila.gas_acum);
      ws.getCell(`J${excelRow}`).value =
        fila.mort_diaria === 0 || fila.mort_diaria === null
          ? ""
          : Number(fila.mort_diaria);
      ws.getCell(`K${excelRow}`).value =
        fila.mort_acum === 0 || fila.mort_acum === null
          ? ""
          : Number(fila.mort_acum);
      ws.getCell(`L${excelRow}`).value =
        fila.mort_porcentaje === 0 || fila.mort_porcentaje === null
          ? ""
          : Number(fila.mort_porcentaje);
      ws.getCell(`M${excelRow}`).value = fila.observacion || "";

      for (let col = 1; col <= 13; col++) {
        const cell = ws.getRow(excelRow).getCell(col);
        cell.alignment = {
          horizontal: col === 7 || col === 13 ? "left" : "center",
          vertical: "middle",
          wrapText: true,
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
    ws.getCell(`B${resumenRow + 1}`).value = sheet.totalAlimento;
    ws.getCell(`A${resumenRow + 2}`).value = "Consumo total de gas:";
    ws.getCell(`B${resumenRow + 2}`).value = sheet.totalGas;
    ws.getCell(`A${resumenRow + 3}`).value = "Mortalidad total:";
    ws.getCell(`B${resumenRow + 3}`).value = sheet.totalMortalidad;
    ws.getCell(`A${resumenRow + 4}`).value = "Mortalidad %:";
    ws.getCell(`B${resumenRow + 4}`).value = sheet.porcentajeMortalidad;
    ws.getCell(`B${resumenRow + 4}`).numFmt = "0.00";
    ws.views = [{ state: "frozen", ySplit: 7 }];

    // HOJA CONSUMO
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
      `Lote: ${nombreConjunto} | Código Lote: ${codigoConjunto}`;
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
        fgColor: { argb: "FFFFE599" },
      };
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });

    const tablaConsumo = getTablaConsumoGalpon(sheet);
    const dataStartRowConsumo = 5;

    tablaConsumo.forEach((fila, i) => {
      const excelRow = dataStartRowConsumo + i;
      wsConsumo.getCell(`A${excelRow}`).value = fila.semana;
      wsConsumo.getCell(`B${excelRow}`).value = fila.dia;
      wsConsumo.getCell(`C${excelRow}`).value = fila.fecha || "";
      wsConsumo.getCell(`D${excelRow}`).value = fila.cantidadPollos;
      wsConsumo.getCell(`E${excelRow}`).value =
        fila.consumoIndividualGr === 0 ? "" : fila.consumoIndividualGr;
      wsConsumo.getCell(`F${excelRow}`).value =
        fila.consumoTotalGr === 0 ? "" : fila.consumoTotalGr;
      wsConsumo.getCell(`G${excelRow}`).value =
        fila.fundas === 0 ? "" : fila.fundas;

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
    wsConsumo.getCell(`A${resumenRowConsumo + 1}`).value =
      "Consumo total alimento [gr]:";
    wsConsumo.getCell(`C${resumenRowConsumo + 1}`).value =
      getTotalConsumoGrGalpon(sheet);
    wsConsumo.getCell(`A${resumenRowConsumo + 2}`).value = "Total fundas:";
    wsConsumo.getCell(`C${resumenRowConsumo + 2}`).value =
      getTotalFundasGalpon(sheet);
    wsConsumo.views = [{ state: "frozen", ySplit: 4 }];
  });

  // HOJA ESTADÍSTICAS
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

  resumenGalpones.value.forEach((item, idx) => {
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

  const totalRow = 5 + resumenGalpones.value.length;
  wsStats.getCell(`D${totalRow}`).value = "TOTALES";
  wsStats.getCell(`D${totalRow}`).font = { bold: true };
  wsStats.getCell(`E${totalRow}`).value =
    estadisticasGenerales.value.totalCantidad;
  wsStats.getCell(`F${totalRow}`).value =
    estadisticasGenerales.value.totalAlimento;
  wsStats.getCell(`G${totalRow}`).value = estadisticasGenerales.value.totalGas;
  wsStats.getCell(`H${totalRow}`).value =
    estadisticasGenerales.value.totalMortalidad;
  wsStats.getCell(`I${totalRow}`).value = Number(
    estadisticasGenerales.value.porcentajeMortalidad,
  );
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

  const excelBuffer = await workbook.xlsx.writeBuffer();
  return excelBuffer instanceof Uint8Array
    ? excelBuffer
    : new Uint8Array(excelBuffer);
};

const crearPdfBuffer = async (): Promise<ArrayBuffer> => {
  const doc = new jsPDF("l", "mm", "a4");
  const margenX = 10;
  const nombreConjunto = galpones.value[0]?.nombre_conjunto || "";
  const codigoConjunto = galpones.value[0]?.codigo_conjunto || "";

  galpones.value.forEach((sheet, index) => {
    if (index > 0) doc.addPage("a4", "l");

    doc.setFontSize(16);
    doc.text("CONTROL PARA POLLOS DE CARNE", margenX, 12);
    doc.setFontSize(10);
    doc.text(
      `Código Lote: ${codigoConjunto}   |   Nombre del lote: ${nombreConjunto}`,
      margenX,
      18,
    );
    doc.text(`Descripción: ${sheet.descripcion_conjunto || ""}`, margenX, 23);
    doc.setFontSize(12);
    doc.text(`${sheet.nombre} - ${sheet.id}`, margenX, 29);
    doc.setFontSize(9);
    doc.text(`Granja: ${sheet.granja || ""}`, margenX, 34);
    doc.text(`Lote: ${sheet.lote || ""}`, 70, 34);
    doc.text(`Galpón: ${sheet.galpon || ""}`, 120, 34);
    doc.text(`Fecha ingreso: ${sheet.fecha_ingreso || ""}`, 170, 34);
    doc.text(`Procedencia: ${sheet.procedencia || ""}`, 230, 34);
    doc.text(`Cantidad: ${sheet.cantidad || 0}`, 280, 34, { align: "right" });

    const body: PdfRow[] = [];
    sheet.filas.forEach((fila) => {
      const filaDatos: PdfRow = [
        fila.dia,
        fila.fecha || "",
        fila.alimento_cant || "",
        fila.alimento_diario || "",
        fila.alimento_acum || "",
        fila.medicina || "",
        fila.gas_diario || "",
        fila.gas_acum || "",
        fila.mort_diaria || "",
        fila.mort_acum || "",
        fila.mort_porcentaje || "",
        fila.observacion || "",
      ];
      if (Number(fila.dia) % 7 === 1) {
        filaDatos.unshift({ content: fila.semana, rowSpan: 7 });
      }
      body.push(filaDatos);
    });

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
      headStyles: { fillColor: [52, 73, 94] },
      columnStyles: {
        6: { cellWidth: 28, halign: "left" },
        12: { cellWidth: 34, halign: "left" },
      },
      margin: { left: 8, right: 8 },
    });

    const finalY = (doc as any).lastAutoTable.finalY + 6;
    doc.setFontSize(10);
    doc.text(
      `Kilos alimento consumidos: ${sheet.totalAlimento}`,
      margenX,
      finalY,
    );
    doc.text(`Consumo total de gas: ${sheet.totalGas}`, 95, finalY);
    doc.text(`Mortalidad total: ${sheet.totalMortalidad}`, 170, finalY);
    doc.text(`Mortalidad %: ${sheet.porcentajeMortalidad}%`, 245, finalY);

    // HOJA CONSUMO (PDF)
    doc.addPage("a4", "l");
    doc.setFontSize(14);
    doc.text(
      `TABLA DE CONSUMO DE ALIMENTO - ${sheet.nombre.toUpperCase()}`,
      margenX,
      12,
    );
    doc.setFontSize(9);
    doc.text(`Código Lote: ${codigoConjunto}`, margenX, 18);
    doc.text(`Lote: ${sheet.lote || ""}`, 90, 18);
    doc.text(`Galpón: ${sheet.galpon || ""}`, 150, 18);

    const tablaConsumo = getTablaConsumoGalpon(sheet);
    const bodyConsumo: PdfRow[] = [];
    tablaConsumo.forEach((fila) => {
      const filaDatos: PdfRow = [
        fila.dia,
        fila.fecha || "",
        fila.cantidadPollos,
        fila.consumoIndividualGr === 0 ? "" : fila.consumoIndividualGr,
        fila.consumoTotalGr,
        fila.fundas,
      ];
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
      headStyles: { fillColor: [243, 156, 18] },
      margin: { left: 8, right: 8 },
    });

    const finalYConsumo = (doc as any).lastAutoTable.finalY + 8;
    doc.setFontSize(10);
    doc.text("RESUMEN DE CONSUMO:", margenX, finalYConsumo);
    doc.text(
      `Consumo total alimento [gr]: ${getTotalConsumoGrGalpon(sheet)}`,
      margenX,
      finalYConsumo + 6,
    );
    doc.text(
      `Total fundas: ${getTotalFundasGalpon(sheet)}`,
      80,
      finalYConsumo + 6,
    );
  });

  // ESTADISTICAS GENERALES (PDF)
  doc.addPage("a4", "l");
  doc.setFontSize(14);
  doc.text("ESTADÍSTICAS GENERALES", margenX, 12);
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
    body: resumenGalpones.value.map((item) => [
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
    styles: { fontSize: 9, halign: "center", valign: "middle" },
    headStyles: { fillColor: [41, 128, 185] },
  });

  const y = (doc as any).lastAutoTable.finalY + 8;
  doc.setFontSize(11);
  doc.text(
    `Total galpones: ${estadisticasGenerales.value.totalGalpones}`,
    margenX,
    y,
  );
  doc.text(
    `Total pollos ingresados: ${estadisticasGenerales.value.totalCantidad}`,
    70,
    y,
  );
  doc.text(
    `Total alimento: ${estadisticasGenerales.value.totalAlimento}`,
    145,
    y,
  );
  doc.text(`Total gas: ${estadisticasGenerales.value.totalGas}`, 210, y);
  doc.text(
    `Total mortalidad: ${estadisticasGenerales.value.totalMortalidad}`,
    260,
    y,
  );

  return doc.output("arraybuffer");
};

const obtenerMensajeErrorLimpio = (error: unknown) => {
  let mensaje = String(
    (error as { message?: string })?.message || error || "",
  ).trim();

  // Si viene algo como:
  // "failed to open file at path: ... with error: El proceso no tiene acceso..."
  const match = mensaje.match(/with error:\s*(.+)$/i);
  if (match?.[1]) {
    mensaje = match[1].trim();
  }

  // Quitar: (os error 32), (os error 5), etc.
  mensaje = mensaje.replace(/\s*\(os error \d+\)\s*$/i, "").trim();

  return mensaje || "Ocurrió un error inesperado.";
};

const exportarDatos = async (tipo: "pdf" | "excel" | "ambas") => {
  if (exportando.value || galpones.value.length === 0) return;
  try {
    exportando.value = true;
    const nombreBase = sanitizarNombreArchivo(
      `${galpones.value[0]?.nombre_conjunto || "lote"}_${galpones.value[0]?.codigo_conjunto || ""}`,
    );
    let buffer: ArrayBuffer | Uint8Array | null = null;
    let extension = "";

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

    exportando.value = false;
    cerrarExportacion();

    const rutaDestino = await save({
      defaultPath: `${nombreBase}.${extension}`,
      filters: [{ name: tipo.toUpperCase(), extensions: [extension] }],
    });
    if (!rutaDestino) return;

    if (!buffer) {
      throw new Error("No se pudo generar el archivo a exportar.");
    }

    const dataToWrite =
      buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

    await writeFile(rutaDestino, dataToWrite);

    // AQUÍ ES DONDE LLAMAMOS A TU MODAL EXACTO
    abrirConfirmacion(
      "Exportación exitosa",
      `El archivo se guardó correctamente en:\n${rutaDestino}\n\n¿Deseas abrir la ubicación del archivo?`,
      async () => {
        try {
          await revealItemInDir(rutaDestino);
        } catch (err) {
          console.error("Error al abrir la carpeta:", err);
          mostrarMensaje("Error", "No se pudo abrir la ubicación del archivo.");
        }
      },
      "Abrir ubicación",
      "success",
    );
  } catch (error) {
    console.error("Error al exportar:", error);
    exportando.value = false;
    cerrarExportacion();
    mostrarMensaje("Error al exportar", obtenerMensajeErrorLimpio(error));
  } finally {
    exportando.value = false;
  }
};

// --- LÓGICA PARA LA TABLA DE CONSUMO EN ADMIN ---
const vistaGalpon = ref<"control" | "consumo">("control");

const unidadConsumo = ref<"gr" | "kg">("gr");

const cambiarUnidadConsumo = () => {
  unidadConsumo.value = unidadConsumo.value === "gr" ? "kg" : "gr";
};

const etiquetaUnidadConsumo = () => {
  return unidadConsumo.value === "kg" ? "kg" : "gr";
};

const formatearConsumo = (valor: number | string | null | undefined) => {
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

const formatearConsumoTotal = (valor: number | string | null | undefined) => {
  const numero = Number(valor) || 0;

  if (unidadConsumo.value === "kg") {
    const enKg = numero / 1000;

    return enKg.toLocaleString("es-EC", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  }

  return numero.toLocaleString("es-EC", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
};

const GRAMOS_POR_FUNDA = 45000;
const USAR_MORTALIDAD_EN_CONSUMO = false;

const irATablaConsumo = () => {
  vistaGalpon.value = "consumo";
};

const volverATablaControl = () => {
  vistaGalpon.value = "control";
};

// Reiniciar a la vista de control cada vez que cambies de galpón (pestaña)
watch(activeTab, () => {
  vistaGalpon.value = "control";
});

// Cálculos dinámicos de la tabla de consumo
const tablaConsumoActual = computed(() => {
  if (activeTab.value === "stats" || !currentGalpon.value) return [];

  const cantidadInicial = currentGalpon.value.cantidad || 0;

  return currentGalpon.value.filas.map((fila) => {
    let cantidadPollos = cantidadInicial;

    if (USAR_MORTALIDAD_EN_CONSUMO) {
      cantidadPollos = Math.max(0, cantidadInicial - (fila.mort_acum || 0));
    }

    const consumoIndividualGr = fila.alimento_diario || 0;
    const consumoTotalGr = cantidadPollos * consumoIndividualGr;
    const fundas = consumoTotalGr
      ? Math.round(consumoTotalGr / GRAMOS_POR_FUNDA)
      : 0;

    return {
      semana: fila.semana,
      dia: fila.dia,
      fecha: fila.fecha || "—",
      cantidadPollos,
      consumoIndividualGr,
      consumoTotalGr,
      fundas,
    };
  });
});

const totalConsumoGrActual = computed(() => {
  return tablaConsumoActual.value.reduce(
    (acc, fila) => acc + fila.consumoTotalGr,
    0,
  );
});

const totalFundasActual = computed(() => {
  return tablaConsumoActual.value.reduce((acc, fila) => acc + fila.fundas, 0);
});

// --- Lógica de Google Drive ---
const {
  user: userDrive,
  loading: loadingDrive,
  backups: backupsDrive,
  login: loginDrive,
  signout: signoutDrive,
  listBackups: listBackupsDrive,
  uploadBackup: uploadBackupDrive,
  restoreBackup: restoreBackupDrive,
  isAuthenticated: authenticatedDrive,
} = useDrive();

watch(seccionActiva, (newVal) => {
  if (newVal === "sincronizacion" && authenticatedDrive.value) {
    listBackupsDrive();
  }
});
</script>

<template>
  <div class="admin-page">
    <div v-if="!autenticado" class="login-page">
      <div class="login-box">
        <h1>Iniciar sesión</h1>

        <input v-model="loginForm.usuario" placeholder="Usuario" />
        <input
          v-model="loginForm.password"
          type="password"
          placeholder="Contraseña"
          @keyup.enter="iniciarSesion"
        />

        <button @click="iniciarSesion">Ingresar</button>
      </div>
    </div>

    <div v-else class="dashboard-page">
      <aside class="sidebar">
        <h2>Panel de Control</h2>

        <button
          class="sidebar-btn"
          :class="{ active: seccionSidebarActiva === 'busqueda' }"
          @click="cambiarSeccion('busqueda')"
        >
          Búsqueda
        </button>

        <button
          class="sidebar-btn"
          :class="{ active: seccionSidebarActiva === 'galpones' }"
          @click="cambiarSeccion('galpones')"
        >
          Galpones
        </button>

        <button
          class="sidebar-btn"
          :class="{ active: seccionSidebarActiva === 'conjuntos' }"
          @click="cambiarSeccion('conjuntos')"
        >
          Lotes
        </button>

        <button
          class="sidebar-btn"
          :class="{ active: seccionSidebarActiva === 'sincronizacion' }"
          @click="cambiarSeccion('sincronizacion')"
        >
          Sincronización
        </button>

        <button class="sidebar-btn" @click="cerrarSesion">Cerrar sesión</button>
      </aside>

      <main class="dashboard-content">
        <template
          v-if="seccionActiva === 'busqueda' || seccionActiva === 'detalle'"
        >
          <div v-if="seccionActiva === 'busqueda'" class="dashboard-header">
            <h1>Consulta de registros</h1>
            <p>Busca por rango de fechas y código de galpón o conjunto.</p>
          </div>
          <div v-else class="dashboard-header">
            <h1>Vista de Detalles</h1>
            <p>Mostrando la información completa del registro seleccionado.</p>
          </div>

          <div v-if="seccionActiva === 'busqueda'" class="filtros-box">
            <div class="campo-filtro">
              <label>Fecha desde</label>
              <input v-model="filtros.fechaDesde" type="date" />
            </div>

            <div class="campo-filtro">
              <label>Fecha hasta</label>
              <input v-model="filtros.fechaHasta" type="date" />
            </div>

            <div class="campo-filtro">
              <label>Código de galpón</label>
              <input
                v-model="filtros.codigoGalpon"
                type="text"
                placeholder="Ej: GAL-MN4QCM10-WKNH"
              />
            </div>

            <div class="campo-filtro">
              <label>Código o nombre de lote</label>
              <input
                v-model="filtros.codigoConjunto"
                type="text"
                placeholder="Ej: LOT:-XXXX o Lote 1"
              />
            </div>

            <div class="acciones-filtro">
              <button
                class="btn-primary"
                @click="buscarRegistros"
                :disabled="buscando"
              >
                {{ buscando ? "Buscando..." : "Buscar" }}
              </button>
              <button class="btn-secondary" @click="limpiarFiltros">
                Limpiar
              </button>
            </div>
          </div>

          <div class="resultados-box">
            <div class="resultados-header">
              <div style="display: flex; gap: 12px; align-items: center">
                <button
                  v-if="seccionActiva === 'detalle'"
                  class="btn-secondary btn-sm"
                  @click="regresarDeDetalle"
                >
                  ← Regresar
                </button>

                <h3>
                  {{ seccionActiva === "detalle" ? "" : "Resultados" }}
                </h3>
              </div>

              <div
                style="
                  display: flex;
                  flex-direction: column;
                  gap: 6px;
                  align-items: flex-end;
                "
              >
                <span>{{ galpones.length }} galpón(es) encontrado(s)</span>

                <button
                  v-if="seccionActiva === 'detalle' && galpones.length > 0"
                  class="btn-primary btn-sm"
                  @click="abrirExportacion"
                >
                  Exportar
                </button>
              </div>
            </div>

            <div v-if="galpones.length > 0" class="resultados-inner">
              <div class="tabs-bar">
                <template v-if="busquedaSinFiltros">
                  <div
                    v-for="grupo in galponesAgrupados"
                    :key="grupo.id"
                    class="grupo-conjunto"
                  >
                    <div class="grupo-header">{{ grupo.id }}</div>
                    <div class="grupo-botones">
                      <button
                        v-for="g in grupo.galpones"
                        :key="g.data.id"
                        class="tab-btn"
                        :class="{ active: activeTab === g.index }"
                        @click="activeTab = g.index"
                      >
                        {{ g.data.nombre }}
                      </button>
                    </div>
                  </div>

                  <button
                    class="tab-btn stats-btn align-bottom"
                    :class="{ active: activeTab === 'stats' }"
                    @click="activeTab = 'stats'"
                  >
                    Estadísticas
                  </button>
                </template>

                <template v-else>
                  <button
                    v-for="(g, index) in galpones"
                    :key="g.id"
                    class="tab-btn"
                    :class="{ active: activeTab === index }"
                    @click="activeTab = index"
                  >
                    {{ g.nombre }}
                  </button>

                  <button
                    class="tab-btn stats-btn"
                    :class="{ active: activeTab === 'stats' }"
                    @click="activeTab = 'stats'"
                  >
                    Estadísticas
                  </button>
                </template>
              </div>

              <div v-if="activeTab !== 'stats' && currentGalpon" class="sheet">
                <div class="header-top">
                  <div class="logo">AVÍTALSA</div>

                  <div class="title-block">
                    <h1>CONTROL PARA POLLOS DE CARNE</h1>
                    <p class="sheet-id">
                      <strong>Código Lote:</strong>
                      {{ currentGalpon.codigo_conjunto }}
                    </p>
                    <p class="sheet-id">
                      <strong>Código Galpón:</strong> {{ currentGalpon.id }}
                    </p>
                  </div>
                </div>

                <div v-show="vistaGalpon === 'control'" class="info-grid">
                  <div class="field">
                    <label>Nombre del lote:</label>
                    <input
                      class="readonly"
                      readonly
                      :value="currentGalpon.nombre_conjunto"
                    />
                  </div>

                  <div class="field">
                    <label>Descripción del conjunto:</label>
                    <input
                      class="readonly"
                      readonly
                      :value="currentGalpon.descripcion_conjunto || '—'"
                    />
                  </div>

                  <div class="field">
                    <label>Granja:</label>
                    <input
                      class="readonly"
                      readonly
                      :value="currentGalpon.granja"
                    />
                  </div>

                  <div class="field">
                    <label>Fecha de ingreso:</label>
                    <input
                      class="readonly"
                      readonly
                      :value="currentGalpon.fecha_ingreso || '—'"
                    />
                  </div>

                  <div class="field">
                    <label>Lote N°:</label>
                    <input
                      class="readonly"
                      readonly
                      :value="currentGalpon.lote"
                    />
                  </div>

                  <div class="field">
                    <label>Procedencia:</label>
                    <input
                      class="readonly"
                      readonly
                      :value="currentGalpon.procedencia || '—'"
                    />
                  </div>

                  <div class="field">
                    <label>Galpón #:</label>
                    <input
                      class="readonly"
                      readonly
                      :value="currentGalpon.galpon"
                    />
                  </div>

                  <div class="field">
                    <label>Cantidad:</label>
                    <input
                      class="readonly"
                      readonly
                      :value="currentGalpon.cantidad || '—'"
                    />
                  </div>
                </div>

                <div v-show="vistaGalpon === 'control'" class="table-wrapper">
                  <table class="control-table">
                    <thead>
                      <tr>
                        <th rowspan="2">Semanas</th>
                        <th rowspan="2">Día</th>
                        <th rowspan="2">Fecha</th>
                        <th colspan="3">Alimentos</th>
                        <th rowspan="2">Medicinas / Vacunas</th>
                        <th colspan="2">Consumo Gas</th>
                        <th colspan="3">Mortalidad</th>
                        <th rowspan="2">Observac. y Peso</th>
                      </tr>
                      <tr>
                        <th>Cant.</th>
                        <th>Diario</th>
                        <th>Acum.</th>
                        <th>Diario</th>
                        <th>Acum.</th>
                        <th>Diaria</th>
                        <th>Acum.</th>
                        <th>%</th>
                      </tr>
                    </thead>

                    <tbody>
                      <tr
                        v-for="(item, index) in currentGalpon.filas"
                        :key="`${item.codigo_galpon}-${item.dia}-${index}`"
                      >
                        <td v-if="item.dia % 7 === 1" :rowspan="7">
                          <div class="cell-content">
                            <div class="cell-display">{{ item.semana }}</div>
                          </div>
                        </td>
                        <td>
                          <div class="cell-content">
                            <div class="cell-display">{{ item.dia }}</div>
                          </div>
                        </td>
                        <td>
                          <div class="cell-content">
                            <div class="cell-display">{{ item.fecha }}</div>
                          </div>
                        </td>
                        <td>
                          <div class="cell-content">
                            <div class="cell-display">
                              {{ item.alimento_cant }}
                            </div>
                          </div>
                        </td>
                        <td>
                          <div class="cell-content">
                            <div class="cell-display">
                              {{ item.alimento_diario }}
                            </div>
                          </div>
                        </td>
                        <td>
                          <div class="cell-content readonly-cell">
                            <div class="cell-display">
                              {{ item.alimento_acum }}
                            </div>
                          </div>
                        </td>
                        <td>
                          <div class="cell-content">
                            <div class="cell-display">{{ item.medicina }}</div>
                          </div>
                        </td>
                        <td>
                          <div class="cell-content">
                            <div class="cell-display">
                              {{ item.gas_diario }}
                            </div>
                          </div>
                        </td>
                        <td>
                          <div class="cell-content readonly-cell">
                            <div class="cell-display">{{ item.gas_acum }}</div>
                          </div>
                        </td>
                        <td>
                          <div class="cell-content">
                            <div class="cell-display">
                              {{ item.mort_diaria }}
                            </div>
                          </div>
                        </td>
                        <td>
                          <div class="cell-content readonly-cell">
                            <div class="cell-display">{{ item.mort_acum }}</div>
                          </div>
                        </td>
                        <td>
                          <div class="cell-content readonly-cell">
                            <div class="cell-display">
                              {{ item.mort_porcentaje }}
                            </div>
                          </div>
                        </td>
                        <td>
                          <div class="cell-content">
                            <div class="cell-display">
                              {{ item.observacion }}
                            </div>
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div
                  v-show="vistaGalpon === 'control'"
                  class="view-nav-actions"
                  style="margin-top: 14px; text-align: right"
                >
                  <button
                    type="button"
                    class="btn-primary"
                    @click="irATablaConsumo"
                  >
                    Siguiente: Tabla de consumo
                  </button>
                </div>

                <div
                  v-if="vistaGalpon === 'consumo'"
                  class="food-table-section"
                >
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
                      class="btn-secondary"
                      @click="volverATablaControl"
                    >
                      ← Anterior: Tabla del galpón
                    </button>
                  </div>

                  <div
                    class="table-wrapper food-table-wrapper food-table-wrapper--fit"
                  >
                    <table class="control-table food-table">
                      <thead>
                        <tr>
                          <th>Semana</th>
                          <th>Día</th>
                          <th>Fecha</th>
                          <th>Cantidad de Pollos</th>
                          <th>
                            Consumo Individual [{{ etiquetaUnidadConsumo() }}]
                          </th>
                          <th>Consumo Total [{{ etiquetaUnidadConsumo() }}]</th>
                          <th>Fundas</th>
                        </tr>
                      </thead>

                      <tbody>
                        <tr
                          v-for="(fila, index) in tablaConsumoActual"
                          :key="`consumo-admin-${currentGalpon?.id || 'galpon'}-${fila.dia}-${index}`"
                        >
                          <td
                            v-if="fila.dia % 7 === 1"
                            :rowspan="7"
                            style="vertical-align: middle"
                          >
                            <div class="cell-content readonly-cell">
                              <div
                                class="cell-display"
                                style="justify-content: center"
                              >
                                {{ fila.semana }}
                              </div>
                            </div>
                          </td>

                          <td>
                            <div
                              class="cell-content readonly-cell"
                              style="justify-content: center"
                            >
                              <div
                                class="cell-display"
                                style="justify-content: center"
                              >
                                {{ fila.dia }}
                              </div>
                            </div>
                          </td>

                          <td>
                            <div
                              class="cell-content readonly-cell"
                              style="justify-content: center"
                            >
                              <div
                                class="cell-display"
                                style="justify-content: center"
                              >
                                {{ fila.fecha }}
                              </div>
                            </div>
                          </td>

                          <td>
                            <div
                              class="cell-content readonly-cell"
                              style="justify-content: center"
                            >
                              <div
                                class="cell-display"
                                style="justify-content: center"
                              >
                                {{ fila.cantidadPollos }}
                              </div>
                            </div>
                          </td>

                          <td>
                            <div
                              class="cell-content readonly-cell"
                              style="justify-content: center"
                            >
                              <div
                                class="cell-display"
                                style="justify-content: center"
                              >
                                {{ formatearConsumo(fila.consumoIndividualGr) }}
                              </div>
                            </div>
                          </td>

                          <td>
                            <div
                              class="cell-content readonly-cell"
                              style="justify-content: center"
                            >
                              <div
                                class="cell-display"
                                style="justify-content: center"
                              >
                                {{ formatearConsumoTotal(fila.consumoTotalGr) }}
                              </div>
                            </div>
                          </td>

                          <td>
                            <div
                              class="cell-content readonly-cell"
                              style="justify-content: center"
                            >
                              <div
                                class="cell-display"
                                style="justify-content: center"
                              >
                                {{ fila.fundas }}
                              </div>
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div class="summary" style="margin-top: 16px">
                    <div class="summary-left">
                      <p>
                        <strong>Total consumo individual acumulado:</strong>
                        {{ currentGalpon.totalAlimento }}
                      </p>
                      <p>
                        <strong>Consumo total de gas:</strong>
                        {{ currentGalpon.totalGas }}
                      </p>
                      <p>
                        <strong>Mortalidad total:</strong>
                        {{ currentGalpon.totalMortalidad }}
                      </p>
                      <p>
                        <strong>Mortalidad %:</strong>
                        {{ currentGalpon.porcentajeMortalidad }}%
                      </p>
                      <p>
                        <strong
                          >Consumo total alimento [{{
                            etiquetaUnidadConsumo()
                          }}]:</strong
                        >
                        {{ formatearConsumoTotal(totalConsumoGrActual) }}
                      </p>
                      <p>
                        <strong>Total fundas:</strong> {{ totalFundasActual }}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div v-else-if="activeTab === 'stats'" class="sheet stats-sheet">
                <div class="header-top">
                  <div class="logo">AVÍTALSA</div>
                  <div class="title-block">
                    <h1>ESTADÍSTICAS GENERALES</h1>
                    <p class="sheet-id">
                      <strong>Código Lote:</strong>
                      {{ galpones[0]?.codigo_conjunto || "—" }}
                    </p>
                    <p class="sheet-id">
                      <strong>Nombre:</strong>
                      {{ galpones[0]?.nombre_conjunto || "—" }}
                    </p>
                    <p class="sheet-id">
                      <strong
                        >Resumen consolidado de
                        {{ estadisticasGenerales.totalGalpones }}
                        galpones</strong
                      >
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

            <div v-else class="sin-resultados">
              No hay resultados para mostrar.
              <span v-if="seccionActiva === 'busqueda'"
                >Ajusta los filtros y presiona "Buscar".</span
              >
            </div>
          </div>
        </template>

        <template v-else-if="seccionActiva === 'galpones'">
          <div class="dashboard-header">
            <h1>Galpones</h1>
            <p>Aquí aparecen todos los galpones registrados.</p>
          </div>

          <div class="listado-box">
            <div class="listado-toolbar">
              <input
                v-model="busquedaGalpones"
                type="text"
                class="search-input"
                placeholder="Buscar por código, nombre, granja, lote, galpón o conjunto..."
              />
              <span class="listado-count">
                {{ galponesFiltrados.length }} galpón(es)
              </span>
            </div>

            <div v-if="cargandoGalpones" class="sin-resultados">
              Cargando galpones...
            </div>

            <div v-else class="table-wrapper">
              <table class="control-table listado-table">
                <thead>
                  <tr>
                    <th>Acciones</th>
                    <th>Código</th>
                    <th>Nombre</th>
                    <th>Granja</th>
                    <th>Lote</th>
                    <th>Galpón</th>
                    <th>Fecha ingreso</th>
                    <th>Procedencia</th>
                    <th>Cantidad</th>
                    <th>Código lote</th>
                    <th>Nombre lote</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in galponesFiltrados" :key="item.id">
                    <td>
                      <button
                        class="btn-primary btn-sm"
                        @click="verDetalle('galpon', item.id, 'galpones')"
                      >
                        Ver
                      </button>
                    </td>
                    <td>{{ item.id }}</td>
                    <td>{{ item.nombre || "—" }}</td>
                    <td>{{ item.granja || "—" }}</td>
                    <td>{{ item.lote || "—" }}</td>
                    <td>{{ item.galpon || "—" }}</td>
                    <td>{{ item.fecha_ingreso || "—" }}</td>
                    <td>{{ item.procedencia || "—" }}</td>
                    <td>{{ item.cantidad ?? "—" }}</td>
                    <td>{{ item.conjunto_id || "—" }}</td>
                    <td>{{ item.conjunto_nombre || "—" }}</td>
                  </tr>

                  <tr v-if="!galponesFiltrados.length">
                    <td colspan="11" class="empty-cell">
                      No se encontraron galpones.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>

        <template v-else-if="seccionActiva === 'conjuntos'">
          <div class="dashboard-header">
            <h1>Lotes</h1>
            <p>Aquí aparecen todos los lotes registrados.</p>
          </div>

          <div class="listado-box">
            <div class="listado-toolbar">
              <input
                v-model="busquedaConjuntos"
                type="text"
                class="search-input"
                placeholder="Buscar por código, nombre o descripción..."
              />
              <span class="listado-count">
                {{ conjuntosFiltrados.length }} conjunto(s)
              </span>
            </div>

            <div v-if="cargandoConjuntos" class="sin-resultados">
              Cargando lotes...
            </div>

            <div v-else class="table-wrapper">
              <table class="control-table listado-table">
                <thead>
                  <tr>
                    <th>Acciones</th>
                    <th>Código</th>
                    <th>Nombre</th>
                    <th>Descripción</th>
                    <th>Total galpones</th>
                    <th>Total cantidad</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in conjuntosFiltrados" :key="item.id">
                    <td>
                      <button
                        class="btn-primary btn-sm"
                        @click="verDetalle('conjunto', item.id, 'conjuntos')"
                      >
                        Ver
                      </button>
                    </td>
                    <td>{{ item.id }}</td>
                    <td>{{ item.nombre || "—" }}</td>
                    <td>{{ item.descripcion || "—" }}</td>
                    <td>{{ item.totalGalpones }}</td>
                    <td>{{ item.totalCantidad }}</td>
                  </tr>

                  <tr v-if="!conjuntosFiltrados.length">
                    <td colspan="6" class="empty-cell">
                      No se encontraron lotes.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>

        <template v-if="seccionActiva === 'sincronizacion'">
          <div class="dashboard-header">
            <h1>Sincronización en la Nube</h1>
            <p>Respalda tu información en Google Drive y restáurala cuando la necesites.</p>
          </div>

          <div class="sync-container">
            <div v-if="!authenticatedDrive" class="sync-card empty">
              <div class="sync-icon-circle">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 10v6m0 0l-3-3m3 3l3-3" />
                  <path d="M22 12c0 3-2.5 5.5-5.5 5.5s-5.5-2.5-5.5-5.5 2.5-5.5 5.5-5.5 5.5 2.5 5.5 5.5z" />
                </svg>
              </div>
              <h2>Sin conexión a Google Drive</h2>
              <p>Debes vincular tu cuenta para habilitar los respaldos automáticos y manuales.</p>
              <button class="btn-primary" @click="loginDrive" :disabled="loadingDrive">
                {{ loadingDrive ? "Conectando..." : "Vincular Cuenta de Google" }}
              </button>
            </div>

            <div v-else class="sync-layout">
              <!-- Perfil de Usuario -->
              <div class="sync-card profile">
                  <div class="user-info-container">
                    <img 
                      v-if="userDrive?.picture" 
                      :src="userDrive.picture" 
                      class="user-avatar" 
                      alt="Google Avatar" 
                      referrerpolicy="no-referrer"
                    />
                    <div v-else class="user-avatar-placeholder">
                      {{ (userDrive?.name || 'G')[0] }}
                    </div>
                    <div class="user-details">
                      <p class="user-name">{{ userDrive?.name || 'Usuario de Google' }}</p>
                      <p class="user-email">{{ userDrive?.email || 'Conectado' }}</p>
                    </div>
                  </div>
                <button class="btn-unlink" @click="signoutDrive">
                  Desvincular cuenta
                </button>
              </div>

              <!-- Botón de Acción Principal -->
              <div class="sync-main-actions">
                <button class="btn-primary btn-lg" @click="uploadBackupDrive(true)" :disabled="loadingDrive">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="btn-icon">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  Crear Backup Manual Ahora
                </button>
              </div>

              <!-- Lista de Backups -->
              <div class="sync-card backups-list">
                <div class="list-header">
                  <h3>Copias de Seguridad Disponibles</h3>
                  <button class="btn-icon-only" @click="listBackupsDrive" title="Actualizar lista" :disabled="loadingDrive">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="23 4 23 10 17 10" />
                      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                    </svg>
                  </button>
                </div>

                <div v-if="loadingDrive && backupsDrive.length === 0" class="list-loading">
                  Cargando copias de seguridad...
                </div>
                
                <div v-else-if="backupsDrive.length === 0" class="list-empty">
                  No se encontraron copias de seguridad en tu cuenta.
                </div>

                <table v-else class="backups-table">
                  <thead>
                    <tr>
                      <th>Nombre del Archivo</th>
                      <th>Fecha</th>
                      <th>Tamaño</th>
                      <th>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="file in backupsDrive" :key="file.id">
                      <td>{{ file.name }}</td>
                      <td>{{ new Date(file.createdTime).toLocaleString() }}</td>
                      <td>{{ (Number(file.size) / 1024 / 1024).toFixed(2) }} MB</td>
                      <td>
                        <button class="btn-danger btn-sm" @click="restoreBackupDrive(file.id)" :disabled="loadingDrive">
                          Restaurar
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </template>
      </main>
    </div>
  </div>
  <div v-if="modalExportacion.visible" class="modal-overlay">
    <div class="modal-box" style="position: relative">
      <h3>Exportar datos</h3>
      <p v-if="!exportando">
        Escoge el formato en el que deseas exportar la información de todos los
        galpones de la búsqueda actual.
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
</template>

<style scoped>
* {
  box-sizing: border-box;
}

.admin-page {
  width: 100%;
  height: 100vh;
  background: #f4f6f8;
  color: #1f2937;
  overflow: hidden;
}

.login-page {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.login-box {
  width: 360px;
  background: white;
  padding: 24px;
  border-radius: 14px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.login-box h1 {
  margin: 0 0 8px;
}

.login-box input {
  padding: 10px 12px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  outline: none;
}

.login-box input:focus {
  border-color: #2563eb;
}

.login-box button {
  padding: 10px 12px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  background: #2563eb;
  color: white;
  font-weight: 600;
}

.dashboard-page {
  height: 100vh;
  display: flex;
  overflow: hidden;
}

.sidebar {
  width: 250px;
  background: #1f2937;
  color: white;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
}

.sidebar h2 {
  margin: 0 0 12px;
  font-size: 22px;
}

.sidebar-btn {
  padding: 10px 12px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
  font-weight: 600;
  background: #374151;
  color: white;
}

.sidebar-btn.active {
  background: #2563eb;
}

.dashboard-content {
  flex: 1;
  padding: 24px;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  min-height: 0;
}

.dashboard-header {
  margin-bottom: 20px;
}

.dashboard-header h1 {
  margin: 0 0 6px;
}

.dashboard-header p {
  margin: 0;
  color: #6b7280;
}

.filtros-box {
  display: grid;
  grid-template-columns: repeat(4, minmax(180px, 1fr));
  gap: 16px;
  margin-bottom: 20px;
  background: white;
  padding: 16px;
  border-radius: 12px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.04);
}

.campo-filtro {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.campo-filtro label {
  font-size: 14px;
  font-weight: 600;
}

.campo-filtro input,
.search-input {
  padding: 10px 12px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  outline: none;
}

.campo-filtro input:focus,
.search-input:focus {
  border-color: #2563eb;
}

.acciones-filtro {
  display: flex;
  align-items: end;
  gap: 10px;
}

.btn-primary,
.btn-secondary {
  padding: 10px 14px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
}

.btn-primary {
  background: #2563eb;
  color: white;
}

.btn-primary:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.btn-secondary {
  background: #e5e7eb;
  color: #111827;
}

.btn-sm {
  padding: 6px 10px;
  font-size: 12px;
}

.resultados-box,
.listado-box {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: white;
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.04);
  overflow: hidden;
}

.resultados-inner {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.resultados-header,
.listado-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}

.resultados-header h3 {
  margin: 0;
}

.resultados-header span,
.listado-count {
  color: #6b7280;
  font-size: 14px;
  white-space: nowrap;
}

.listado-toolbar .search-input {
  flex: 1;
}

.sin-resultados {
  padding: 20px;
  text-align: center;
  color: #6b7280;
}

.sheet {
  width: 100%;
  background: white;
  border: 2px solid #111;
  padding: 18px;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: auto; /* AQUI: Hacemos que todo el contenedor de la hoja tenga scroll */
}

.header-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  gap: 20px;
}

.logo {
  font-size: 32px;
  font-weight: 800;
  letter-spacing: 1px;
  white-space: nowrap;
}

.title-block {
  flex: 1;
  text-align: center;
}

.title-block h1 {
  margin: 0;
  font-size: 30px;
  font-weight: 800;
}

.sheet-id {
  margin: 8px 0 0;
  font-size: 14px;
}

.info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 18px;
  margin-bottom: 14px;
}

.field {
  display: flex;
  align-items: center;
  gap: 8px;
}

.field label {
  min-width: 130px;
  font-weight: 700;
  font-size: 14px;
}

.field input {
  flex: 1;
  border: none;
  border-bottom: 1px solid #111;
  padding: 6px 4px;
  font-size: 14px;
  background: transparent;
}

.table-wrapper {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid #111;
  max-width: 100%;
}

/* NUEVO: Anulamos el overflow SOLO para las tablas dentro de la hoja (.sheet), 
   permitiendo que crezcan y activen el scroll de .sheet, manteniendo intacto el listado */
.sheet .table-wrapper {
  flex: none;
  overflow: visible;
}

.control-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  min-width: 1400px;
}

.listado-table {
  min-width: 1100px;
}

.control-table thead {
  position: sticky;
  top: 0;
  z-index: 40;
}

.control-table th,
.control-table td {
  border-right: 1px solid #111;
  border-bottom: 1px solid #111;
  text-align: center;
  padding: 0; /* Padding cero, el cell-content se encarga */
  font-size: 12px;
  position: relative;
  height: 32px; /* Alto base de la hoja original */
}

.control-table thead tr:first-child th {
  position: sticky;
  top: 0;
  z-index: 30;
  background: #f3f3f3;
}

.control-table thead tr:nth-child(2) th {
  position: sticky;
  top: 26px;
  z-index: 29;
  background: #f3f3f3;
}

.control-table th {
  background: #f3f3f3;
  padding: 6px 4px;
  font-weight: 700;
}

/* --- CLASES ESTRUCTURALES DE CELDA ORIGINALES --- */

.cell-content {
  height: 100%;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  min-width: 0;
}

.cell-display {
  width: 100%;
  min-width: 0;
  height: 100%;
  padding: 0 4px; /* Espaciado interno horizontal */
  overflow: hidden;
  white-space: nowrap; /* Evita salto de línea */
  text-overflow: clip; /* Corta el texto largo sin puntos suspensivos */
  display: flex;
  align-items: center;
  justify-content: center;
}

.readonly-cell {
  background-color: #f3f3f3;
  color: #666;
  font-weight: 700;
  height: 100%;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Forzamos SOLO a los TD de la hoja a no expandir la celda */
.control-table td {
  max-width: 0;
  background: #fff;
}

/* Restauramos el padding para las otras tablas de listado y estadísticas */
.listado-table td,
.stats-table td {
  padding: 8px 6px;
  height: auto;
  max-width: none;
}

.cell-input {
  width: 100%;
  border: none;
  padding: 6px 4px;
  font-size: 12px;
  min-height: 30px;
  background: transparent;
  text-align: center;
}

.cell-input:focus {
  outline: 1px solid #666;
  background: #fffef2;
}

.readonly {
  background: #fefefe;
  font-weight: 700;
  color: #333;
}

.tabs-bar {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 14px;

  max-height: 140px;
  overflow-y: auto;
  overflow-x: hidden;

  padding-right: 6px; /* espacio para scrollbar */
}

.tab-btn {
  border: 1px solid #111;
  background: #fff;
  padding: 10px 14px;
  cursor: pointer;
  font-weight: 700;
  min-width: 110px;
  user-select: none;
}

.tab-btn.active {
  background: #111;
  color: #fff;
}

.stats-btn {
  background: #f7f7f7;
}

.summary {
  margin-top: 16px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

.summary p {
  margin: 6px 0;
  font-size: 14px;
}

.stats-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
  margin-bottom: 18px;
}

.stat-card {
  border: 1px solid #111;
  padding: 14px;
  background: #fafafa;
}

.stat-card h3 {
  margin: 0 0 8px;
  font-size: 15px;
}

.stat-card p {
  margin: 0;
  font-size: 22px;
  font-weight: 800;
}

.user-info-container {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.user-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: 2px solid var(--accent-color);
  object-fit: cover;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.user-details {
  display: flex;
  flex-direction: column;
}

.user-name {
  font-weight: 700;
  color: var(--primary-color);
  margin: 0;
  font-size: 1.1rem;
}

.user-email {
  font-size: 0.85rem;
  color: #666;
  margin: 0;
}

.stats-table {
  min-width: 1000px;
}

.empty-cell {
  text-align: center;
  color: #6b7280;
  padding: 18px !important;
}

@media (max-width: 1200px) {
  .filtros-box {
    grid-template-columns: repeat(2, minmax(180px, 1fr));
  }
}

@media (max-width: 900px) {
  .info-grid {
    grid-template-columns: 1fr;
  }

  .title-block h1 {
    font-size: 22px;
  }

  .logo {
    font-size: 24px;
  }

  .stats-cards {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 768px) {
  .dashboard-page,
  .admin-page {
    height: auto;
    min-height: 100vh;
    flex-direction: column;
    overflow: visible;
  }

  .dashboard-content {
    overflow: visible;
  }

  .resultados-box,
  .resultados-inner,
  .sheet,
  .listado-box {
    min-height: 600px;
  }

  .sidebar {
    width: 100%;
    height: auto;
  }

  .filtros-box {
    grid-template-columns: 1fr;
  }

  .acciones-filtro {
    align-items: stretch;
    flex-direction: column;
  }

  .listado-toolbar,
  .resultados-header {
    flex-direction: column;
    align-items: stretch;
  }

  .stats-cards {
    grid-template-columns: 1fr;
  }
}
/* Estilos EXCLUSIVOS para la vista agrupada (sin filtros) */
.grupo-conjunto {
  display: flex;
  flex-direction: column;
  border: 1px solid #111;
  background: #fff;
}

.grupo-header {
  padding: 4px 8px;
  border-bottom: 1px solid #111;
  font-weight: 700;
  text-transform: uppercase;
  text-align: center;
  background: #f9f9f9;
  font-size: 13px;
}

.grupo-botones {
  display: flex;
  flex: 1;
}

.grupo-botones .tab-btn {
  border: none;
  border-right: 1px solid #111;
  border-radius: 0;
  margin: 0;
}

.grupo-botones .tab-btn:last-child {
  border-right: none;
}

.align-bottom {
  align-self: flex-end;
}
.control-table.food-table {
  min-width: 700px; /* o 600px si quieres más compacta */
}

.export-loading-overlay {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.78);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  z-index: 20;
}

.export-loading-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  font-weight: 700;
  color: #222;
}

.export-spinner {
  width: 34px;
  height: 34px;
  border: 4px solid #d9d9d9;
  border-top: 4px solid #111;
  border-radius: 50%;
  animation: girar-export 0.8s linear infinite;
}

@keyframes girar-export {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
/* --- ESTILOS DEL MODAL --- */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  padding: 16px;
}

.modal-box {
  width: 100%;
  max-width: 440px;
  background: #fff;
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
  position: relative;
}

.modal-box h3 {
  margin: 0 0 12px;
  font-size: 20px;
  font-weight: 700;
  color: #111827;
}

.modal-box p {
  margin: 0;
  color: #4b5563;
  line-height: 1.5;
  margin-bottom: 15px;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
}

.food-table-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 14px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}

.food-table-header-left {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.food-table-header-left h3 {
  margin: 0;
}

.unit-switcher {
  display: flex;
  align-items: center;
  gap: 8px;
}

.unit-label {
  font-size: 14px;
  font-weight: 700;
  color: #374151;
}

.unit-btn {
  min-width: 60px;
  padding: 8px 12px;
  border: 1px solid #111;
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  font-weight: 700;
}

.unit-btn:hover {
  background: #f3f4f6;
}

/* --- ESTILOS DE SINCRONIZACIÓN (PREMIUM) --- */
.sync-container {
  padding: 24px;
  max-width: 1100px;
  margin: 0 auto;
}

.sync-card {
  background: #ffffff;
  border-radius: 16px;
  padding: 24px;
  border: 1px solid #e5e7eb;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
}

.sync-card.empty {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1.5rem;
  padding: 4rem 2rem;
  background: linear-gradient(135deg, #f9fafb 0%, #ffffff 100%);
}

.sync-icon-circle {
  width: 90px;
  height: 90px;
  background: #eff6ff;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #3b82f6;
  box-shadow: 0 10px 15px -3px rgba(59, 130, 246, 0.1);
}

.sync-icon-circle svg {
  width: 44px;
  height: 44px;
}

.sync-card.empty h2 {
  margin: 0;
  color: #111827;
  font-size: 1.5rem;
}

.sync-card.empty p {
  margin: 0;
  color: #6b7280;
  max-width: 320px;
}

.sync-layout {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.sync-card.profile {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.user-info-container {
  display: flex;
  align-items: center;
  gap: 1.25rem;
}

.user-avatar {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: 2px solid #3b82f6;
  object-fit: cover;
}

.user-name {
  font-weight: 700;
  color: #111827;
  font-size: 1.1rem;
  margin: 0;
}

.user-email {
  font-size: 0.85rem;
  color: #6b7280;
  margin: 0;
}

.btn-unlink {
  background: #f3f4f6;
  color: #4b5563;
  border: 1px solid #e5e7eb;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-unlink:hover {
  background: #e5e7eb;
  color: #111827;
}

.sync-main-actions {
  display: flex;
  justify-content: center;
  margin: 0.5rem 0;
}

.btn-lg {
  padding: 16px 32px;
  font-size: 18px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  gap: 12px;
  font-weight: 600;
  box-shadow: 0 10px 15px -3px rgba(59, 130, 246, 0.3);
}

.btn-icon {
  width: 24px;
  height: 24px;
}

.backups-list {
  padding: 0;
  overflow: hidden;
}

.list-header {
  padding: 20px 24px;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.list-header h3 {
  margin: 0;
  font-size: 18px;
}

.backups-table {
  width: 100%;
  border-collapse: collapse;
}

.backups-table th {
  text-align: left;
  padding: 12px 24px;
  background: #f9fafb;
  font-size: 12px;
  text-transform: uppercase;
  color: #6b7280;
  font-weight: 600;
  letter-spacing: 0.05em;
}

.backups-table td {
  padding: 16px 24px;
  border-bottom: 1px solid #f3f4f6;
  font-size: 14px;
  color: #374151;
}

.backups-table tr:hover td {
  background: #fdfdfd;
}

.list-empty, .list-loading {
  padding: 48px;
  text-align: center;
  color: #6b7280;
  font-style: italic;
}

.btn-icon-only {
  background: transparent;
  border: none;
  color: #6b7280;
  cursor: pointer;
  padding: 8px;
  border-radius: 8px;
  transition: all 0.2s;
}

.btn-icon-only:hover {
  background: #f3f4f6;
  color: #111827;
}

.btn-icon-only svg {
  width: 20px;
  height: 20px;
}

.btn-danger {
  background: #fee2e2;
  color: #dc2626;
  border: 1px solid #fecaca;
}

.btn-danger:hover {
  background: #fecaca;
}

.btn-danger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@media (max-width: 768px) {
  .sync-card.profile {
    flex-direction: column;
    text-align: center;
    gap: 16px;
  }
}

.user-avatar-placeholder {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: #3b82f6;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  font-weight: 700;
}
</style>
