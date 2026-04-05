<script setup lang="ts">
import { ref, computed } from "vue";
import Database from "@tauri-apps/plugin-sql";

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

// Añadimos "detalle" a las secciones posibles
type SeccionActiva = "busqueda" | "galpones" | "conjuntos" | "detalle";

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

const seccionSidebarActiva = computed<"busqueda" | "galpones" | "conjuntos">(
  () => {
    if (seccionActiva.value === "detalle") {
      if (origenDetalle.value === "galpones") return "galpones";
      if (origenDetalle.value === "conjuntos") return "conjuntos";
      return "busqueda";
    }

    return seccionActiva.value as "busqueda" | "galpones" | "conjuntos";
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

    // 👇 LÍNEA AÑADIDA PARA APAGAR LA AGRUPACIÓN 👇
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
          Conjuntos
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
              <span>{{ galpones.length }} galpón(es) encontrado(s)</span>
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

                <div class="info-grid">
                  <div class="field">
                    <label>Nombre del conjunto:</label>
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

                <div class="table-wrapper">
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

                <div class="summary">
                  <div class="summary-left">
                    <p>
                      <strong>Kilos alimento consumidos:</strong>
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
                    <th>Código conjunto</th>
                    <th>Nombre conjunto</th>
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
            <h1>Conjuntos</h1>
            <p>Aquí aparecen todos los conjuntos registrados.</p>
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
              Cargando conjuntos...
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
                      No se encontraron conjuntos.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>
      </main>
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
</style>
