<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { ref, computed, watch, onMounted } from "vue";
import Database from "@tauri-apps/plugin-sql";
import ExcelJS from "exceljs";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import JSZip from "jszip";
import { save, open } from "@tauri-apps/plugin-dialog";
import {
  writeFile,
  readFile,
  remove,
  rename,
  exists,
} from "@tauri-apps/plugin-fs";

import { revealItemInDir, openUrl } from "@tauri-apps/plugin-opener";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen } from "@tauri-apps/api/event";
import { useDrive, setConfirmHandler } from "./composables/useDrive";
import { useNotify } from "./composables/useNotify";
import SyncIcon from "./components/SyncIcon.vue";

const isDev = import.meta.env.DEV;

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
type SeccionActiva =
  | "busqueda"
  | "galpones"
  | "conjuntos"
  | "detalle"
  | "sincronizacion";

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

const seccionSidebarActiva = computed<
  "busqueda" | "galpones" | "conjuntos" | "sincronizacion"
>(() => {
  if (seccionActiva.value === "detalle") {
    if (origenDetalle.value === "galpones") return "galpones";
    if (origenDetalle.value === "conjuntos") return "conjuntos";
    return "busqueda";
  }

  return seccionActiva.value as
    | "busqueda"
    | "galpones"
    | "conjuntos"
    | "sincronizacion";
});

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
let dbPromise: Promise<Database> | null = null;

const initDB = async (): Promise<Database> => {
  if (db) return db;
  if (dbPromise) return dbPromise;

  dbPromise = (async () => {
    try {
      const connection = await Database.load("sqlite:pollos.db");
      
      // 1. Tablas Base y Migraciones (Consistente con useSheets / NIVEL 3)
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS conjuntos (
          id TEXT PRIMARY KEY,
          nombre TEXT NOT NULL,
          descripcion TEXT,
          updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
      `);
      try { await connection.execute("ALTER TABLE conjuntos ADD COLUMN updated_at INTEGER DEFAULT (strftime('%s', 'now'))"); } catch(e) {}

      await connection.execute(`
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
          updated_at INTEGER DEFAULT (strftime('%s', 'now')),
          FOREIGN KEY (conjunto_id) REFERENCES conjuntos(id)
        )
      `);
      try { await connection.execute("ALTER TABLE sheets ADD COLUMN updated_at INTEGER DEFAULT (strftime('%s', 'now'))"); } catch(e) {}

      await connection.execute(`
        CREATE TABLE IF NOT EXISTS filas (
          id TEXT PRIMARY KEY, 
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
          updated_at INTEGER DEFAULT (strftime('%s', 'now')),
          FOREIGN KEY (sheet_id) REFERENCES sheets(id)
        )
      `);
      try { await connection.execute("ALTER TABLE filas ADD COLUMN updated_at INTEGER DEFAULT (strftime('%s', 'now'))"); } catch(e) {}

      // 2. Infraestructura de Sincronización (Nivel 3)
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS sync_mutations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          table_name TEXT NOT NULL,
          row_id TEXT NOT NULL,
          operation TEXT NOT NULL,
          payload TEXT,
          timestamp INTEGER DEFAULT (strftime('%s', 'now')),
          device_id TEXT,
          synced INTEGER DEFAULT 0
        )
      `);

      await connection.execute(`
        CREATE TABLE IF NOT EXISTS processed_deltas (
          file_id TEXT PRIMARY KEY,
          processed_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
      `);

      await connection.execute(`CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT)`);
      await connection.execute(`INSERT OR IGNORE INTO app_config (key, value) VALUES ('sync_mute', '0')`);

      // 3. TRIGGERS (Replicados para asegurar que cambios en Admin también se sincronicen)
      const triggerSpecs = [
        { t: 'conjuntos', ops: ['INSERT', 'UPDATE', 'DELETE'], p: "json_object('nombre', NEW.nombre, 'descripcion', NEW.descripcion)" },
        { t: 'sheets', ops: ['INSERT', 'UPDATE', 'DELETE'], p: "json_object('conjunto_id', NEW.conjunto_id, 'nombre', NEW.nombre, 'granja', NEW.granja, 'lote', NEW.lote, 'galpon', NEW.galpon, 'fecha_ingreso', NEW.fecha_ingreso, 'procedencia', NEW.procedencia, 'cantidad', NEW.cantidad)" },
        { t: 'filas', ops: ['INSERT', 'UPDATE', 'DELETE'], p: "json_object('sheet_id', NEW.sheet_id, 'dia', NEW.dia, 'semana', NEW.semana, 'fecha', NEW.fecha, 'alimento_cant', NEW.alimento_cant, 'alimento_diario', NEW.alimento_diario, 'medicina', NEW.medicina, 'gas_diario', NEW.gas_diario, 'mort_diaria', NEW.mort_diaria, 'observacion', NEW.observacion)" }
      ];

      for (const spec of triggerSpecs) {
        for (const op of spec.ops) {
          const suffix = op.toLowerCase().substring(0, 3);
          const payload = op === 'DELETE' ? 'NULL' : spec.p;
          const ref = op === 'DELETE' ? 'OLD' : 'NEW';
          
          await connection.execute(`
            CREATE TRIGGER IF NOT EXISTS trg_sync_${spec.t}_${suffix} AFTER ${op} ON ${spec.t}
            WHEN (SELECT value FROM app_config WHERE key = 'sync_mute') = '0'
            BEGIN
              INSERT INTO sync_mutations (table_name, row_id, operation, payload)
              VALUES ('${spec.t}', ${ref}.id, '${op}', ${payload});
              ${op === 'UPDATE' ? `UPDATE ${spec.t} SET updated_at = (strftime('%s', 'now')) WHERE id = NEW.id;` : ''}
            END;
          `);
        }
      }

      db = connection;
      return db;
    } catch (e) {
      dbPromise = null;
      const errorStr = String(e).toLowerCase();
      console.error("🚨 [initDB ADMIN] Error crítico detectado:", e);
      
      if (errorStr.includes("malformed") || errorStr.includes("code 11")) {
        console.warn("🛡️ [VALLA] ¡Corrupción detectada en initDB! databaseMalformed = true");
        databaseMalformed.value = true;
      }
      throw e;
    }
  })();

  return dbPromise;
};

const formatearIdParaUsuario = (id: string | null | undefined) => {
  if (!id) return "";
  const partes = id.split(":");
  if (partes.length < 2) return id;

  const prefijoLimpio = partes[0].split("-")[0];
  const fecha = partes[1];

  return `${prefijoLimpio}:${fecha}`;
};

const formatearNombreBackup = (nombre: string) => {
  if (!nombre) return "Respaldo";
  if (nombre === "Llave_Maestra_Seguridad.key") return "Llave de Seguridad (Maestra)";
  if (nombre.startsWith("pollos_backup")) return "Copia de Seguridad (Cloud)";
  if (nombre.endsWith(".db")) return "Base de Datos";
  return nombre;
};

// --- Estados de Seguridad 2FA ---
const twoFactorSecret = ref<string | null>(null);
const is2FAConfirmed = ref(false);
const is2FAEnabled = computed(
  () => !!twoFactorSecret.value && is2FAConfirmed.value,
);

const filaEliminandoId = ref<string | null>(null);
const show2FASetupModal = ref(false);
const setup2FAData = ref<{ secret: string; qr: string } | null>(null);

const show2FAVerifyModal = ref(false);
const input2FACode = ref("");
const verifyTargetFileId = ref<string | null>(null);
const verificando2FA = ref(false);
const llaveValidada = ref(false);

// --- AUTO-VERIFICACIÓN INTELIGENTE (UX MEJORADA) ---
watch(input2FACode, (newVal) => {
  // Limpiamos espacios por si acaso
  const code = newVal.trim();

  // Si tiene exactamente 6 caracteres y NO estamos en modo soporte/llave
  // (El modo soporte usa códigos más largos o recovery codes de 8 chars)
  if (code.length === 6 && !showSupportMode.value && !llaveValidada.value) {
    if (show2FASetupModal.value) {
      confirmar2FASetup();
    } else if (show2FAVerifyModal.value) {
      procesarEliminacionCon2FA();
    }
  }
});

const currentKeyPath = ref<string | null>(null);
const subSeccionSync = ref<string>("backups");
const recoveryCodes = ref<string[]>([]);
const showRecoveryModal = ref(false);
const haDescargadoCodigos = ref(false);
const subiendoADrive = ref(false);
const subidaDriveExitosa = ref(false);
const showSupportMode = ref(false);
const systemId = ref("");
const showLogoutConfirmModal = ref(false);
const showMasterKeyUploadModal = ref(false);
const pendingMasterKeyBytes = ref<Uint8Array | null>(null);
const subiendoLlaveADrive = ref(false);
const showDeleteOldKeyConfirm = ref(false);
// databaseMalformed ahora se obtiene de useDrive() para sincronización global
const showRecoverySuccessModal = ref(false);
const recoveryType = ref<"local" | "clean">("clean");
const isConfigLoaded = ref(false);

const cerrarRecoverySuccessModal = () => {
  showRecoverySuccessModal.value = false;
  if (recoveryType.value === "clean") {
    cambiarSeccion("sincronizacion");
  }
};

const repararBaseDeDatos = async () => {
  const confirmed = await abrirConfirmacion(
    "Reparación de Base de Datos",
    "Se ha detectado que la base de datos local está dañada (malformed). Esto puede ocurrir por un cierre inesperado.\n\nSe moverá el archivo dañado a una copia de seguridad y la app se reiniciará en blanco para que puedas restaurar tu copia de la nube.\n\n¿Deseas intentar la reparación automática?",
    "Iniciar Reparación",
    "warning",
  );

  if (confirmed) {
    try {
      // 🛡️ IMPORTANTE: Cerrar la conexión antes de renombrar para evitar bloqueos
      if (db) {
        await (db as any).close();
        db = null;
      }

      const dbPath = await invoke<string>("get_db_path");
      const backupPath = `${dbPath}.malformed_${Date.now()}`;
      const bakPath = `${dbPath}.bak`;

      // 1. Aislar el archivo dañado y sus rastros
      await rename(dbPath, backupPath);

      // 🧹 LIMPIEZA DE VALLA: Eliminar archivos temporales del malformed para evitar contaminar el reinicio
      try {
        if (await exists(dbPath + "-wal")) await remove(dbPath + "-wal");
        if (await exists(dbPath + "-shm")) await remove(dbPath + "-shm");
        if (await exists(dbPath + "-journal")) await remove(dbPath + "-journal");
        console.log("🧹 Rastro de archivos temporales corruptos eliminado.");
      } catch (e) {
        console.warn("⚠️ No se pudieron limpiar temporales en reparación:", e);
      }
      // 2. Intentar Recuperación Local (Plan A)
      const hasBak = await exists(bakPath);
      if (hasBak) {
        console.log(
          "📦 [Rescate] Encontrado respaldo local .bak. Restaurando...",
        );
        await rename(bakPath, dbPath);
        localStorage.setItem("db_recovery_flag", "local");
      } else {
        console.log(
          "📦 [Rescate] No hay respaldo local. Iniciando sistema limpio.",
        );
        localStorage.setItem("db_recovery_flag", "clean");
      }

      await invoke("restart_app");
    } catch (e) {
      console.error("Error en reparación:", e);
      mostrarToast(
        "No se pudo completar la reparación automática. El archivo podría estar bloqueado. Intenta cerrando la aplicación y borrando 'pollos.db' manualmente.",
        "error",
      );
    }
  }
};

const confirmarEliminarLlaveInutil = async () => {
  if (currentKeyPath.value) {
    try {
      await remove(currentKeyPath.value);
      mostrarToast("Archivo eliminado permanentemente.");
    } catch (err) {
      console.error("Error al eliminar el archivo .key:", err);
      mostrarToast("No se pudo eliminar el archivo físico.", "error");
    }
  }
  showDeleteOldKeyConfirm.value = false;
};

const { toast, toastY, draggingToast, mostrarToast, handleToastMouseDown } =
  useNotify();

const modalSeguridadTitulo = computed(() => {
  const v = verifyTargetFileId.value;
  if (v === "RESET_2FA_ACTION") return "Seguridad: Autorizar Cambio";
  if (v === "SIGNOUT_DRIVE_ACTION") return "Seguridad: Cerrar Sesión";
  if (v === "LOGIN_IDENTITY_UNLOCK") return "Validación de Identidad";
  if (v?.startsWith("RESTORE_")) return "Confirmar Restauración";
  if (v?.startsWith("DELETE_")) return "Confirmar Eliminación";
  return "Verificación de Seguridad";
});

const modalSeguridadMensaje = computed(() => {
  const v = verifyTargetFileId.value;
  if (v === "RESET_2FA_ACTION")
    return "Para vincular un nuevo celular, ingresa el código actual de tu Authenticator o un código de recuperación.";
  if (v === "SIGNOUT_DRIVE_ACTION")
    return "Para desvincular tu cuenta de Google Drive de este equipo, ingresa el código de tu Authenticator.";
  if (v === "LOGIN_IDENTITY_UNLOCK")
    return "Se ha detectado una identidad previa en la nube. Por seguridad, ingresa el código de tu Authenticator para desbloquear tu acceso en este equipo.";
  if (v?.startsWith("RESTORE_"))
    return "<b>Atención:</b> Estás a punto de restaurar un respaldo. Se reemplazarán todos los datos locales actuales. Por favor, confirma tu identidad.";
  return "Ingresa el código de 6 dígitos de tu Authenticator o un código de recuperación para continuar.";
});

const modalSeguridadBotonLabel = computed(() => {
  if (verificando2FA.value) return "Verificando...";
  const v = verifyTargetFileId.value;
  if (v === "RESET_2FA_ACTION") return "Autorizar";
  if (v === "SIGNOUT_DRIVE_ACTION") return "Desvincular";
  if (v === "LOGIN_IDENTITY_UNLOCK") return "Confirmar Identidad";
  if (v?.startsWith("RESTORE_")) return "Restaurar Ahora";
  return "Confirmar Borrado";
});

const cargarConfig2FA = async () => {
  try {
    const database = await initDB();
    const res = await database.select<{ key: string; value: string }[]>(
      "SELECT key, value FROM app_config WHERE key IN ('2fa_secret', '2fa_recovery_codes', '2fa_confirmed', 'system_id')",
    );

    // 2. Extraer valores del 2FA si existen
    if (res && res.length > 0) {
      const secret = res.find((r) => r.key === "2fa_secret")?.value;
      const codesRaw = res.find((r) => r.key === "2fa_recovery_codes")?.value;
      const confirmed = res.find((r) => r.key === "2fa_confirmed")?.value;

      console.log("🔑 [Config2FA] Datos cargados de BD:", {
        tieneSecret: !!secret,
        tieneCodes: !!codesRaw,
        confirmedValue: confirmed,
      });

      if (secret) twoFactorSecret.value = secret;
      if (codesRaw) recoveryCodes.value = JSON.parse(codesRaw);

      if (confirmed === "true") {
        is2FAConfirmed.value = true;
        console.log("✅ [Config2FA] 2FA confirmado localmente.");
      } else {
        is2FAConfirmed.value = false;
        console.log("⚠️ [Config2FA] 2FA NO confirmado localmente.");
      }

      // SI HAY SECRETO PERO NO ESTÁ CONFIRMADO (Cajón de seguridad anti-apagones)
      if (twoFactorSecret.value && !is2FAConfirmed.value) {
        haDescargadoCodigos.value = false;
        console.log(
          "🚨 [Config2FA] Detectado estado pendiente de confirmación.",
        );
        showRecoveryModal.value = true;
      }
    } else {
      console.log("ℹ️ [Config2FA] No hay configuración previa en BD.");
    }

    // 3. Garantizar que siempre haya un System ID
    let sid = (res || []).find((r) => r.key === "system_id")?.value;
    if (!sid) {
      sid = Math.random().toString(36).substring(2, 8).toUpperCase();
      await database.execute(
        "INSERT OR REPLACE INTO app_config (key, value) VALUES ('system_id', ?)",
        [sid],
      );
    }
    systemId.value = sid;
    isConfigLoaded.value = true; // 🏁 Marcamos como cargado
  } catch (e) {
    const errorStr = String(e).toLowerCase();
    console.error("🚨 [Config2FA] Error al cargar configuración técnica:", e);
    
    if (errorStr.includes("malformed") || errorStr.includes("code 11")) {
      console.warn("🛡️ [VALLA] Corrupción detectada en Config2FA. Activando banner de reparación.");
      databaseMalformed.value = true;
    }
  }
};

const forzarResetMaestro = async () => {
  const confirm = await abrirConfirmacion(
    "RESET MAESTRO",
    "¿ESTÁS SEGURO? Esto eliminará la protección 2FA sin pedir código.",
    "Eliminar Protección",
    "danger",
  );

  if (confirm) {
    try {
      const db = await initDB();
      await db.execute("DELETE FROM app_config WHERE key = '2fa_secret'");
      await db.execute(
        "DELETE FROM app_config WHERE key = '2fa_recovery_codes'",
      );
      await db.execute("DELETE FROM app_config WHERE key = '2fa_confirmed'");

      twoFactorSecret.value = null;
      recoveryCodes.value = [];
      is2FAConfirmed.value = false;

      mostrarToast("Protección 2FA eliminada con éxito.");
    } catch (e) {
      console.error("Error en reset maestro:", e);
      mostrarToast("Error al resetear la base de datos.", "error");
    }
  }
};

const descargarCodigosRecuperacion = async () => {
  try {
    if (recoveryCodes.value.length === 0) return;

    // 1. Generar los bytes de la Llave Maestra encriptada en Rust
    const keyBytes = await invoke<number[]>("create_master_key_file", {
      codes: recoveryCodes.value,
    });
    const contentArray = new Uint8Array(keyBytes);

    // 2. Pedir ubicación para guardar el archivo .key
    const filePath = await save({
      filters: [{ name: "Llave Maestra de Rescate", extensions: ["key"] }],
      defaultPath: "Llave_Maestra_Seguridad.key",
    });

    if (filePath) {
      // 3. Guardar el archivo cifrado usando el motor de Rust
      await invoke("save_master_key_file", {
        path: filePath,
        content: keyBytes,
      });
      haDescargadoCodigos.value = true;

      // En lugar de ask(), mostramos nuestro modal premium
      pendingMasterKeyBytes.value = contentArray;
      showMasterKeyUploadModal.value = true;
    }
  } catch (e) {
    console.error("Error al descargar códigos:", e);
    mostrarToast("No se pudo guardar el archivo. Inténtalo de nuevo.", "error");
  }
};

const iniciarSesion = async () => {
  if (
    loginForm.value.usuario === "admin" &&
    loginForm.value.password === "1234"
  ) {
    autenticado.value = true;
    console.log("✅ Sesión iniciada");

    await Promise.all([cargarGalpones(), cargarConjuntos(), cargarConfig2FA()]);
  } else {
    mostrarToast("Credenciales incorrectas", "error");
  }
};

// --- Manejadores 2FA ---
const iniciar2FASetup = async () => {
  if (is2FAEnabled.value) {
    // Si ya está activo, primero pedimos el código actual para autorizar el cambio
    verifyTargetFileId.value = "RESET_2FA_ACTION"; // Marcador especial
    input2FACode.value = "";
    llaveValidada.value = false;
    show2FAVerifyModal.value = true;
    return;
  }

  // Si no está activo, procedemos a generar el QR inicial
  generarNuevoQR();
};

const generarNuevoQR = async () => {
  try {
    const [secret, qr] = await invoke<[string, string]>("generate_2fa_setup");
    setup2FAData.value = { secret, qr };
    show2FASetupModal.value = true;
    input2FACode.value = "";
  } catch (e) {
    console.error(e);
    mostrarToast(`Error al iniciar configuración 2FA: ${e}`, "error");
  }
};

const confirmar2FASetup = async () => {
  if (!setup2FAData.value) return;
  try {
    verificando2FA.value = true;
    const isValid = await invoke<boolean>("verify_2fa_code", {
      secretBase32: setup2FAData.value.secret,
      code: input2FACode.value,
    });

    if (isValid) {
      // Generar 5 códigos de recuperación aleatorios
      const newCodes = Array.from({ length: 5 }, () =>
        Math.random().toString(36).substring(2, 10).toUpperCase(),
      );

      const database = await initDB();
      await database.execute(
        "INSERT OR REPLACE INTO app_config (key, value) VALUES ('2fa_secret', ?)",
        [setup2FAData.value.secret],
      );
      await database.execute(
        "INSERT OR REPLACE INTO app_config (key, value) VALUES ('2fa_recovery_codes', ?)",
        [JSON.stringify(newCodes)],
      );
      await database.execute(
        "INSERT OR REPLACE INTO app_config (key, value) VALUES ('2fa_confirmed', ?)",
        ["false"],
      );

      twoFactorSecret.value = setup2FAData.value.secret;
      recoveryCodes.value = newCodes;
      haDescargadoCodigos.value = false;
      is2FAConfirmed.value = false;

      show2FASetupModal.value = false;
      showRecoveryModal.value = true;
    } else {
      mostrarToast("Código incorrecto. Verifica tu celular.", "error");
    }
  } catch (e) {
    console.error(e);
  } finally {
    verificando2FA.value = false;
  }
};

const finalizarConfiguracion2FA = async () => {
  const db = await initDB();
  await db.execute(
    "UPDATE app_config SET value = 'true' WHERE key = '2fa_confirmed'",
  );

  // --- PERSISTENCIA DE IDENTIDAD EN LA NUBE (NIST-Compliant) ---
  try {
    const userEmail = userDrive.value?.email || "unknown";

    // Hasheamos los códigos de recuperación para la nube
    const hashedCodes = await Promise.all(
      recoveryCodes.value.map((c) => hashStringDrive(c)),
    );

    const saved = await saveAccountState({
      schemaVersion: 1,
      cloudAccountId: userEmail,
      appAccountInitialized: true,
      twoFactor: {
        enabled: true,
        confirmed: true,
        method: "totp",
        enrolledAt: new Date().toISOString(),
        secretStoredMode: "local_only",
      },
      recovery: {
        hasRecoveryCodes: true,
        recoveryCodeHashes: hashedCodes,
        hasMasterKey: true, // Siempre generamos la llave en este sistema
        masterKeyVerifier: hashedCodes[0], // Usamos el primer hash como verificador simple para la llave
        updatedAt: new Date().toISOString(),
        failedAttempts: 0,
      },
      backups: {
        hasAnyBackup: backupsDrive.value.length > 0,
        lastBackupAt: new Date().toISOString(),
      },
      devicePolicy: {
        require2faOnNewInstall: true,
      },
    });

    if (saved) {
      console.log(
        "🔒 Identidad Cloud sincronizada con Hashes de Recuperación.",
      );
    } else {
      console.warn(
        "⚠️ La identidad Cloud no se pudo sincronizar, pero el 2FA local está activo.",
      );
    }
  } catch (e) {
    console.error("Error al sincronizar identidad en la nube:", e);
  }

  is2FAConfirmed.value = true;
  showRecoveryModal.value = false;
  mostrarToast("Seguridad 2FA configurada y activada correctamente.");
};

const subirCodigosADrive = async (contentArray: Uint8Array) => {
  try {
    subiendoLlaveADrive.value = true;
    const buffer = contentArray.buffer as ArrayBuffer;
    const blob = new Blob([buffer], { type: "application/octet-stream" });
    const file = new File([blob], "Llave_Maestra_Seguridad.key", {
      type: "application/octet-stream",
    });

    await uploadFileDrive(file, "security");

    mostrarToast("Copia cifrada guardada en Google Drive con éxito.");
  } catch (e) {
    console.error("Error al subir a Drive:", e);
    mostrarToast("No se pudo subir a Drive.", "error");
  } finally {
    subiendoLlaveADrive.value = false;
  }
};

const confirmarSubidaLlave = async () => {
  if (pendingMasterKeyBytes.value) {
    await subirCodigosADrive(pendingMasterKeyBytes.value);
  }
  showMasterKeyUploadModal.value = false;
  pendingMasterKeyBytes.value = null;
};

const cancelarSubidaLlave = () => {
  showMasterKeyUploadModal.value = false;
  pendingMasterKeyBytes.value = null;
  mostrarToast("Llave Maestra descargada con éxito. Asegura tu archivo.");
};

const cargarLlaveMaestra = async () => {
  try {
    const filePath = await open({
      multiple: false,
      filters: [{ name: "Llave Maestra Pollos", extensions: ["key"] }],
    });

    if (filePath && typeof filePath === "string") {
      currentKeyPath.value = filePath;
      verificando2FA.value = true;
      // Pequeña pausa para que se vea el "Leyendo" si es muy rápido
      await new Promise((r) => setTimeout(r, 500));

      const fileContent = await readFile(filePath);

      const isValid = await invoke<boolean>("validate_master_key_file", {
        fileContent: Array.from(fileContent),
        storedCodes: recoveryCodes.value,
      });

      if (isValid) {
        llaveValidada.value = true;
        input2FACode.value = recoveryCodes.value[0];
        // Pequeña pausa para que el usuario note el cambio antes de cerrar o proceder
        await new Promise((r) => setTimeout(r, 800));
        // Opcionalmente podemos auto-confirmar si queremos, pero mejor dejamos que el usuario vea el cambio
        // await procesarEliminacionCon2FA();
      } else {
        mostrarToast(
          "Esta llave no es válida para este sistema o es de una configuración anterior.",
          "error",
        );
      }
    }
  } catch (e) {
    console.error("Error al cargar llave maestra:", e);
    mostrarToast("Error al leer el archivo de llave.", "error");
  } finally {
    verificando2FA.value = false;
  }
};

const handleKeyFileDrop = async (e: DragEvent) => {
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (!file) return;

  // En Tauri (web context) el objeto File no tiene la ruta completa por seguridad,
  // pero podemos leerlo como ArrayBuffer y validarlo directamente.
  try {
    currentKeyPath.value = null; // En drop no tenemos el path absoluto habitualmente
    verificando2FA.value = true;
    const buffer = await file.arrayBuffer();
    const fileContent = new Uint8Array(buffer);

    // Pequeña pausa para feedback visual
    await new Promise((r) => setTimeout(r, 500));

    const isValid = await invoke<boolean>("validate_master_key_file", {
      fileContent: Array.from(fileContent),
      storedCodes: recoveryCodes.value,
    });

    if (isValid) {
      llaveValidada.value = true;
      input2FACode.value = recoveryCodes.value[0];
      await new Promise((r) => setTimeout(r, 800));
    } else {
      mostrarToast(
        "Este archivo no es una Llave Maestra válida para este sistema.",
        "error",
      );
    }
  } catch (err) {
    console.error("Error en drop:", err);
  } finally {
    verificando2FA.value = false;
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

  if (seccion === "sincronizacion") {
    // 🔎 SABUESO AGRESIVO AL ENTRAR
    try {
      const database = await initDB();
      // Forzamos lectura de las tablas "pesadas" que son las que se dañan
      await database.execute("SELECT count(*) FROM sheets");
      console.log("🔍 [Sabueso Agresivo] Verificando tablas de registros...");
    } catch (e) {
      const errorStr = String(e).toLowerCase();
      if (errorStr.includes("malformed") || errorStr.includes("code 11")) {
        console.error("🧨 [Sabueso Agresivo] Corrupción detectada en tablas de datos.");
        databaseMalformed.value = true;
      }
    }
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
    if (String(error).includes("malformed")) databaseMalformed.value = true;
    mostrarToast("No se pudieron cargar los galpones.", "error");
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
    if (String(error).includes("malformed")) databaseMalformed.value = true;
    mostrarToast("No se pudieron cargar los conjuntos.", "error");
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
    mostrarToast("No se pudo realizar la búsqueda.", "error");
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
    mostrarToast("No se pudo cargar la vista de detalle.", "error");
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
    const idUsuario = formatearIdParaUsuario(g.id).toLowerCase();
    const idConjuntoUsuario = formatearIdParaUsuario(g.conjunto_id).toLowerCase();

    return (
      g.id?.toLowerCase().includes(texto) ||
      idUsuario.includes(texto) ||
      g.nombre?.toLowerCase().includes(texto) ||
      g.granja?.toLowerCase().includes(texto) ||
      g.lote?.toLowerCase().includes(texto) ||
      g.galpon?.toLowerCase().includes(texto) ||
      g.conjunto_id?.toLowerCase().includes(texto) ||
      idConjuntoUsuario.includes(texto) ||
      g.conjunto_nombre?.toLowerCase().includes(texto)
    );
  });
});

const conjuntosFiltrados = computed(() => {
  const texto = busquedaConjuntos.value.trim().toLowerCase();

  if (!texto) return conjuntosLista.value;

  return conjuntosLista.value.filter((c) => {
    const idUsuario = formatearIdParaUsuario(c.id).toLowerCase();

    return (
      c.id?.toLowerCase().includes(texto) ||
      idUsuario.includes(texto) ||
      c.nombre?.toLowerCase().includes(texto) ||
      (c.descripcion || "").toLowerCase().includes(texto)
    );
  });
});

// ==========================================
// --- MODALES REUTILIZABLES DE MENSAJE Y CONFIRMACIÓN ---
// ==========================================

const modalConfirmacion = ref({
  visible: false,
  titulo: "",
  texto: "",
  onConfirm: null as Function | null,
  textoConfirmar: "Aceptar",
  tipo: "normal",
});

let confirmResolve: ((val: boolean) => void) | null = null;

const abrirConfirmacion = (
  titulo: string,
  texto: string,
  textoConfirmar = "Aceptar",
  tipo = "normal",
): Promise<boolean> => {
  return new Promise((resolve) => {
    confirmResolve = resolve;
    modalConfirmacion.value = {
      visible: true,
      titulo,
      texto,
      onConfirm: () => {
        if (confirmResolve) confirmResolve(true);
        cerrarConfirmacion();
      },
      textoConfirmar,
      tipo,
    };
  });
};

const cerrarConfirmacion = () => {
  if (confirmResolve) {
    confirmResolve(false);
    confirmResolve = null;
  }
  modalConfirmacion.value = {
    visible: false,
    titulo: "",
    texto: "",
    onConfirm: null,
    textoConfirmar: "Aceptar",
    tipo: "normal",
  };
};

const confirmarAccion = () => {
  if (modalConfirmacion.value.onConfirm) {
    modalConfirmacion.value.onConfirm();
  }
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
    const reveal = await abrirConfirmacion(
      "Exportación exitosa",
      `El archivo se guardó correctamente en:\n${rutaDestino}\n\n¿Deseas abrir la ubicación del archivo?`,
      "Abrir ubicación",
      "success",
    );
    if (reveal) {
      try {
        await revealItemInDir(rutaDestino);
      } catch (err) {
        console.error("Error al abrir la carpeta:", err);
        mostrarToast("No se pudo abrir la ubicación del archivo.", "error");
      }
    }
  } catch (error) {
    console.error("Error al exportar:", error);
    exportando.value = false;
    cerrarExportacion();
    mostrarToast(obtenerMensajeErrorLimpio(error), "error");
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

const formatearUbicacionDrive = (fechaStr: string) => {
  if (!fechaStr) return "—";
  try {
    const fecha = new Date(fechaStr);
    const año = fecha.getFullYear();
    const mesesFull = [
      "ENERO",
      "FEBRERO",
      "MARZO",
      "ABRIL",
      "MAYO",
      "JUNIO",
      "JULIO",
      "AGOSTO",
      "SEPTIEMBRE",
      "OCTUBRE",
      "NOVIEMBRE",
      "DICIEMBRE",
    ];
    const mes = mesesFull[fecha.getMonth()];
    return `${año} / ${mes}`;
  } catch (e) {
    return "—";
  }
};

// --- LÓGICA DE GOOGLE DRIVE ---
const {
  user: userDrive,
  loading: loadingDrive,
  backups: backupsDrive,
  login: loginDrive,
  signout: signoutDrive,
  listBackups: listBackupsDrive,
  uploadBackup: uploadBackupDrive,
  uploadFile: uploadFileDrive,
  restoreBackup: restoreBackupDrive,
  deleteBackup: deleteBackupDrive,
  isAuthenticated: authenticatedDrive,
  isDirty: isDirtyDrive, // Añadido para el indicador de estado
  isOnline: isOnlineDrive,
  syncError: syncErrorDrive,
  isDatabaseCorrupted: databaseMalformed, // 🛡️ Sincronizar estado de corrupción con useDrive
  // Identidad Cloud
  cloudAccountState,
  fetchAccountState,
  saveAccountState,
  resetLoading: resetLoadingDrive,
  hashString: hashStringDrive,
} = useDrive();

// --- GUARDIA DE INTEGRIDAD (NIST-Compliant) ---
const requiereSeguridadUrgente = computed(() => {
  // 🛡️ NO HACER NADA SI LA CONFIGURACIÓN NO HA CARGADO TODAVÍA
  if (!isConfigLoaded.value) return false;

  const cloudConfirmed = !!cloudAccountState.value?.twoFactor?.confirmed;
  const legacyMigrationNeeded =
    !cloudAccountState.value && backupsDrive.value.length > 0;
  const isConfirmedLocal = is2FAConfirmed.value;

  const result = (cloudConfirmed || legacyMigrationNeeded) && !isConfirmedLocal;

  if (result) {
    console.log("🛡️ [Guardia] REQUIERE SEGURIDAD DETECTADO:", {
      cloudConfirmed,
      legacyMigrationNeeded,
      isConfirmedLocal,
      cloudAccountState: cloudAccountState.value,
    });
  }

  return result;
});

watch(seccionActiva, () => {
  // 🛡️ Al cambiar de pestaña, cerramos cualquier modal de seguridad abierto
  // para evitar que se queden sobrepuestos en secciones no relacionadas.
  show2FASetupModal.value = false;
  show2FAVerifyModal.value = false;
  showLogoutConfirmModal.value = false;
  showMasterKeyUploadModal.value = false;
});

const syncStatus = computed(() => {
  const status = (() => {
    if (!authenticatedDrive.value) return "not-linked";
    if (databaseMalformed.value) return "error"; // 🛡️ Prioridad: Si hay malformed, es un error crítico
    if (
      !isOnlineDrive.value ||
      (syncErrorDrive.value &&
        (syncErrorDrive.value.includes("request for url") ||
          syncErrorDrive.value.includes("timeout") ||
          syncErrorDrive.value.includes("network") ||
          syncErrorDrive.value.includes("offline")))
    ) {
      return "offline";
    }
    if (loadingDrive.value) return "loading";
    if (syncErrorDrive.value) return "error";
    if (isDirtyDrive.value) return "pending";
    return "success";
  })();

  console.log(`📊 [SyncStatus] Calculado: ${status} | DB_Malformed: ${databaseMalformed.value} | Cloud_Error: ${syncErrorDrive.value}`);
  return status;
});

const syncTooltip = computed(() => {
  switch (syncStatus.value) {
    case "not-linked":
      return "Google Drive no vinculado";
    case "offline":
      return "Fallo de red (Se reintentará al conectar)";
    case "loading":
      return "Sincronizando...";
    case "error":
      return "Error de sincronización: " + syncErrorDrive.value;
    case "pending":
      return "Pendiente de sincronizar";
    default:
      return "Sincronizado con Drive";
  }
});

const ejecutarBackupManual = async () => {
  const success = await uploadBackupDrive(true);
  if (success) {
    mostrarToast("Copia de seguridad guardada con éxito en Google Drive");
  }
};

const iniciarLoginConSeguridad = async () => {
  try {
    await loginDrive();

    if (authenticatedDrive.value) {
      // 1. EL JUEZ: Consultamos la identidad oficial en Drive (AppDataFolder)
      const state = await fetchAccountState();

      if (state?.twoFactor?.confirmed && !is2FAConfirmed.value) {
        // Dejamos que el watcher (Guardia de Integridad) maneje la apertura del modal
        // al detectar el cambio en cloudAccountState para evitar duplicidad.
        console.log(
          "ℹ️ [Login] Identidad en nube detectada. El Guardia manejará el modal.",
        );
      } else {
        // 2. Si no hay estado oficial, revisamos backups (Modo Migración Legado)
        await listBackupsDrive();

        if (backupsDrive.value.length > 0) {
          // CASO C: Cuenta Heredada (Sin manifiesto pero con datos)
          console.log("ℹ️ [Login] Backups heredados encontrados.");
        } else {
          // CASO A: Usuario Nuevo Real
          // Dejamos que el watcher maneje la apertura si corresponde.
          console.log("ℹ️ [Login] Usuario nuevo detectado.");
          mostrarToast(
            "Conexión exitosa. Por seguridad, configura tu Authenticator.",
          );
        }
      }
    }
  } catch (err) {
    console.error("Error en login:", err);
  }
};

const eliminandoBackup = ref(false);

const confirmarEliminarBackup = async (fileId: string, _fileName: string) => {
  if (!is2FAEnabled.value) {
    const setup = await abrirConfirmacion(
      "Seguridad Requerida",
      "Para eliminar copias de seguridad, primero debes activar la seguridad de Google Authenticator. ¿Deseas configurarlo ahora?",
      "Configurar Ahora",
      "normal",
    );
    if (setup) iniciar2FASetup();
    return;
  }

  verifyTargetFileId.value = `DELETE_${fileId}`;
  input2FACode.value = "";
  llaveValidada.value = false;
  show2FAVerifyModal.value = true;
};

const confirmarRestaurarBackup = async (fileId: string) => {
  if (!is2FAEnabled.value) {
    const setup = await abrirConfirmacion(
      "Seguridad Requerida",
      "Para restaurar copias de seguridad, primero debes activar la seguridad de Google Authenticator. ¿Deseas configurarlo ahora?",
      "Configurar Ahora",
      "normal",
    );
    if (setup) iniciar2FASetup();
    return;
  }

  verifyTargetFileId.value = `RESTORE_${fileId}`;
  input2FACode.value = "";
  llaveValidada.value = false;
  show2FAVerifyModal.value = true;
};

const solicitarLogout2FA = () => {
  showLogoutConfirmModal.value = false;
  if (is2FAEnabled.value) {
    verifyTargetFileId.value = "SIGNOUT_DRIVE_ACTION";
    input2FACode.value = "";
    llaveValidada.value = false;
    show2FAVerifyModal.value = true;
  } else {
    signoutDrive();
  }
};

const modernizarRespaldo = async (fileId: string) => {
  const confirmed = await abrirConfirmacion(
    "Migración Profunda a V3",
    "Estás por modernizar una base de datos antigua al formato de 'Nivel 3 (Sincronización Delta)'.\n\nEste proceso:\n1. Convertirá IDs numéricos a UUIDs globales.\n2. Inyectará marcas de tiempo de alta precisión.\n3. Habilitará la sincronización inteligente entre dispositivos.\n\n Tus datos se mantendrán intactos. ¿Deseas continuar?",
    "Confirmar Migración",
    "info"
  );

  if (!confirmed) return;

  try {
    mostrarToast("Iniciando migración profunda... Por favor espera.");
    
    // 1. Restauramos el respaldo antiguo localmente primero (sin reiniciar la app)
    const successRestore = await restoreBackupDrive(fileId, true);
    if (!successRestore) throw new Error("No se pudo descargar el respaldo para migrar.");

    const database = await initDB();

    // 2. MIGRACIÓN PROFUNDA DE TABLA FILAS (Cambiar de INT a UUID)
    // Primero verificamos si ya es V3 inspeccionando el esquema real de la tabla 'filas'
    const checkTable = await database.select<{sql: string}[]>("SELECT sql FROM sqlite_master WHERE name='filas'");
    if (checkTable[0]?.sql.toLowerCase().includes("text primary key")) {
       mostrarToast("Este respaldo ya está en formato V3 o superior.");
       return;
    }

    console.log("🛠️ Re-estructurando tabla filas para Nivel 3 (UUID Migration)...");
    
    // a. Crear tabla temporal con el esquema nuevo (UUID y updated_at)
    await database.execute(`
      CREATE TABLE filas_modernizada (
          id TEXT PRIMARY KEY,
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
          updated_at INTEGER DEFAULT (strftime('%s', 'now')),
          FOREIGN KEY (sheet_id) REFERENCES sheets(id)
      )
    `);

    // b. Migrar datos generando nuevos UUIDs para cada fila antigua
    const oldRows = await database.select<any[]>("SELECT * FROM filas");
    for (const row of oldRows) {
      const newId = crypto.randomUUID();
      await database.execute(`
        INSERT INTO filas_modernizada 
        (id, sheet_id, dia, semana, fecha, alimento_cant, alimento_diario, alimento_acum, 
         medicina, gas_diario, gas_acum, mort_diaria, mort_acum, mort_porcentaje, observacion, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        newId, row.sheet_id, row.dia, row.semana, row.fecha, row.alimento_cant, row.alimento_diario,
        row.alimento_acum, row.medicina, row.gas_diario, row.gas_acum, row.mort_diaria,
        row.mort_acum, row.mort_porcentaje, row.observacion, Math.floor(Date.now()/1000)
      ]);
    }

    // c. Intercambiar tablas antiguas por las nuevas modernizadas
    await database.execute("DROP TABLE filas");
    await database.execute("ALTER TABLE filas_modernizada RENAME TO filas");
    
    // 3. Crear un nuevo respaldo V3 en la nube indicando la modernización
    mostrarToast("Arquitectura modernizada con éxito. Sincronizando nueva versión...");
    
    // Obtenemos el path real de la db para leer el binario
    const dbPath = await invoke<string>("get_db_path");
    const dbContent = await readFile(dbPath);
    const blob = new Blob([dbContent], { type: "application/x-sqlite3" });
    const fileToUpload = new File([blob], `pollos_backup_v3_modernized_${Date.now()}.db`, { type: "application/x-sqlite3" });
    
    await uploadFileDrive(fileToUpload, "backup");
    
    mostrarToast("✅ Proceso completado. La base de datos ahora es compatible con Sincronización Nivel 3.", "success");
    await listBackupsDrive(); // Refrescar lista de UI

  } catch (e) {
    console.error("Error en migración V3:", e);
    mostrarToast("Error crítico durante la migración: " + e, "error");
  }
};

const procesarEliminacionCon2FA = async () => {
  if (!verifyTargetFileId.value) return;

  // Permitimos continuar si hay secreto LOCAL O si hay un estado en la NUBE para validar identidad
  if (!twoFactorSecret.value && !cloudAccountState.value) return;

  try {
    verificando2FA.value = true;

    // Primero intentamos validación TOTP normal (si son 6 dígitos)
    let isValid = false;
    if (input2FACode.value.length === 6) {
      isValid = await invoke<boolean>("verify_2fa_code", {
        secretBase32: twoFactorSecret.value,
        code: input2FACode.value,
      });
    }

    // SI NO ES VÁLIDO TOTP, intentamos como CÓDIGO DE RECUPERACIÓN (Local o Cloud)
    if (!isValid) {
      if (
        verifyTargetFileId.value === "LOGIN_IDENTITY_UNLOCK" &&
        cloudAccountState.value
      ) {
        // --- VALIDACIÓN CONTRA LA NUBE (REINSTALACIÓN) ---
        const codeToVerify = input2FACode.value || "";
        const inputHash = await hashStringDrive(codeToVerify);
        const hashes =
          cloudAccountState.value.recovery?.recoveryCodeHashes || [];
        const index = hashes.indexOf(inputHash);

        if (index !== -1) {
          isValid = true;
          // NIST: Consumo único (Eliminar de la nube inmediatamente)
          const newState = JSON.parse(JSON.stringify(cloudAccountState.value));
          if (newState.recovery?.recoveryCodeHashes) {
            newState.recovery.recoveryCodeHashes.splice(index, 1);
            newState.recovery.failedAttempts = 0; // Reset intentos fallidos
            await saveAccountState(newState);
            console.log(
              "✅ Identidad desbloqueada y código de un solo uso consumido.",
            );
          }
        } else {
          // Incrementar intentos fallidos en la nube (Rate Limiting)
          const newState = JSON.parse(JSON.stringify(cloudAccountState.value));
          if (newState.recovery) {
            newState.recovery.failedAttempts =
              (newState.recovery.failedAttempts || 0) + 1;
            await saveAccountState(newState);

            if (newState.recovery.failedAttempts >= 5) {
              mostrarToast(
                "Demasiados intentos fallidos. Contacta a soporte.",
                "error",
              );
            } else {
              mostrarToast(
                `Código incorrecto. Intento ${newState.recovery.failedAttempts}/5`,
                "error",
              );
            }
          }
        }
      } else if (twoFactorSecret.value) {
        // --- VALIDACIÓN LOCAL NORMAL ---
        const db = await initDB();
        const res = await db.select<{ value: string }[]>(
          "SELECT value FROM app_config WHERE key = '2fa_recovery_codes'",
        );
        if (res && res.length > 0) {
          let codes: string[] = JSON.parse(res[0].value);
          const index = codes.indexOf(input2FACode.value.toUpperCase());
          if (index !== -1) {
            isValid = true;
            codes.splice(index, 1);
            await db.execute(
              "UPDATE app_config SET value = ? WHERE key = '2fa_recovery_codes'",
              [JSON.stringify(codes)],
            );
            recoveryCodes.value = codes;
          }
        }
      }
    }

    // --- VALIDACIÓN POR CÓDIGO DE SOPORTE (SISTEMA CRIPTOGRÁFICO) ---
    if (!isValid && input2FACode.value.trim() !== "") {
      try {
        const day = new Date().getDate();
        const salt = "SOPORTE-POLLOS-VIP-2024-SECRET-KEY"; // CLAVE SECRETA QUE SOLO TÚ CONOCES
        const msg = `${systemId.value}-${salt}-${day}`;

        const encoder = new TextEncoder();
        const data = encoder.encode(msg.toUpperCase());
        const hashBuffer = await crypto.subtle.digest("SHA-256", data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");

        // Usamos los primeros 10 caracteres del hash como código de rescate
        const supportCode = hashHex.substring(0, 10).toUpperCase();

        if (input2FACode.value.toUpperCase() === supportCode) {
          isValid = true;
          console.log("🛠️ Acceso de soporte CRIPTOGRÁFICO autorizado");
        }
      } catch (err) {
        console.error("Error en validación criptográfica:", err);
      }
    }

    if (isValid) {
      if (verifyTargetFileId.value === "LOGIN_IDENTITY_UNLOCK") {
        // CASO: DESBLOQUEO EXITOSO TRAS REINSTALACIÓN
        mostrarToast("¡Identidad validada!", "success");
        show2FAVerifyModal.value = false;
        verifyTargetFileId.value = null;

        // Si después de validar identidad detectamos que no hay 2FA local (reset o reinstalación)
        // forzamos la configuración inmediata
        if (requiereSeguridadUrgente.value) {
          console.log(
            "🛡️ Identidad recuperada, pero falta 2FA local. Forzando configuración.",
          );
          iniciar2FASetup();
        } else {
          seccionActiva.value = "sincronizacion";
        }
      } else if (verifyTargetFileId.value === "RESET_2FA_ACTION") {
        // CASO: RESET DE SEGURIDAD
        const database = await initDB();
        await database.execute(
          "DELETE FROM app_config WHERE key = '2fa_secret'",
        );
        await database.execute(
          "DELETE FROM app_config WHERE key = '2fa_recovery_codes'",
        );
        await database.execute(
          "DELETE FROM app_config WHERE key = '2fa_confirmed'",
        );

        twoFactorSecret.value = null;
        recoveryCodes.value = [];
        is2FAConfirmed.value = false;

        show2FAVerifyModal.value = false;
        verifyTargetFileId.value = null;

        if (llaveValidada.value) {
          if (currentKeyPath.value) {
            // Reemplazado modal nativo por modal personalizado
            showDeleteOldKeyConfirm.value = true;
          } else {
            // Caso de Drop (no tenemos el path)
            mostrarToast(
              "Recuerda eliminar el archivo de la Llave Maestra que usaste, ya que no servirá para futuras configuraciones.",
            );
          }
        }

        mostrarToast(
          "La vinculación anterior ha sido eliminada. Ahora puedes configurar un nuevo dispositivo desde el panel de seguridad.",
        );
        return;
      }

      // CASO: CERRAR SESIÓN DE DRIVE
      if (verifyTargetFileId.value === "SIGNOUT_DRIVE_ACTION") {
        show2FAVerifyModal.value = false;
        verifyTargetFileId.value = null;
        await signoutDrive();
        mostrarToast("Sesión de Google Drive cerrada correctamente.");
        return;
      }

      // CASO: RESPALDO (ELIMINACIÓN O RESTAURACIÓN)
      const targetId = verifyTargetFileId.value || "";
      if (
        !targetId ||
        targetId === "LOGIN_IDENTITY_UNLOCK" ||
        targetId === "SIGNOUT_DRIVE_ACTION" ||
        targetId === "RESET_2FA_ACTION"
      ) {
        return;
      }

      show2FAVerifyModal.value = false;
      verifyTargetFileId.value = null;

      if (targetId.startsWith("DELETE_")) {
        const fileId = targetId.replace("DELETE_", "");
        filaEliminandoId.value = fileId;
        await deleteBackupDrive(fileId);
        mostrarToast("La copia de seguridad ha sido eliminada con éxito.");
        listBackupsDrive();
      } else if (targetId.startsWith("RESTORE_")) {
        const fileId = targetId.replace("RESTORE_", "");
        await restoreBackupDrive(fileId);
      }
    } else {
      mostrarToast(
        "El código ingresado es incorrecto. Por favor, verifica tu aplicación Authenticator.",
        "error",
      );
    }
  } catch (e) {
    console.error("Error al procesar eliminación 2FA:", e);
    mostrarToast("Ocurrió un error al verificar el código.", "error");
  } finally {
    verificando2FA.value = false;
    filaEliminandoId.value = null;
    verifyTargetFileId.value = null;
  }
};

let syncInterval: any = null;

onMounted(async () => {
  // 🛡️ ESCUCHA GLOBAL DE LA VALLA DE SEGURIDAD
  // Si cualquier ventana (como la principal) detecta corrupción, el Admin debe enterarse
  listen("db-corruption-detected", (event) => {
    console.warn("🚨 [VALLA GLOBAL] Alerta de integridad recibida de otra ventana:", event.payload);
    databaseMalformed.value = true;
  });

  setConfirmHandler(async (msg, opts) => {
    let titulo = "Confirmación";
    let tipo = "normal";

    if (typeof opts === "string") {
      titulo = opts;
    } else if (opts && typeof opts === "object") {
      titulo = opts.title || titulo;
      tipo = opts.kind === "warning" ? "warning" : "normal";
    }

    return await abrirConfirmacion(titulo, msg, "Confirmar", tipo);
  });
  await initDB();

  cargarConfig2FA();

  // 🛡️ VERIFICAR SI VENIMOS DE UN RESCATE EXITOSO
  const flag = localStorage.getItem("db_recovery_flag");
  if (flag) {
    localStorage.removeItem("db_recovery_flag");
    recoveryType.value = flag === "local" ? "local" : "clean";
    showRecoverySuccessModal.value = true;
  }
});

watch(seccionActiva, (newVal) => {
  // Limpiar intervalo anterior si existe
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }

  if (newVal === "sincronizacion" && authenticatedDrive.value) {
    // 1. Carga inicial inmediata (con indicador visual)
    listBackupsDrive();

    // 2. Iniciar "Polling" cada 30 segundos (silencioso)
    syncInterval = setInterval(async () => {
      // SOLO refrescar si: estamos en la sección, estamos autenticados, NO estamos cargando y NO estamos eliminando
      if (
        seccionActiva.value === "sincronizacion" &&
        authenticatedDrive.value &&
        !loadingDrive.value &&
        !eliminandoBackup.value
      ) {
        // 🔎 SABUESO AGRESIVO: Buscamos corrupción en las tablas de datos reales (que es donde suele fallar)
        try {
          const database = await initDB();
          await database.execute("SELECT count(*) FROM sheets");
          await database.execute("SELECT id FROM filas LIMIT 1");
          console.log("🔍 [Sabueso] Integridad de tablas de datos OK.");
        } catch (e) {
          const errorStr = String(e).toLowerCase();
          if (errorStr.includes("malformed") || errorStr.includes("code 11")) {
            console.error("🧨 [Sabueso Agresivo] ¡TABLAS DE DATOS CORRUPTAS DETECTADAS!");
            databaseMalformed.value = true;
          }
        }

        console.log("🔄 Auto-refresco de backups (silent)...");
        listBackupsDrive(true);
      }
    }, 30000);
  }
});
const enviarWhatsAppSoporte = () => {
  const numero = "593999694629";
  const nombre = userDrive.value?.name || "(Nombre no disponible)";
  const correo = userDrive.value?.email || "(Email no disponible)";

  const mensaje = `Hola. Mi nombre es *${nombre}* y mi correo es *${correo}*.\n\nNo tengo acceso a mi dispositivo Authenticator ni a mi Llave Maestra. Necesito solicitar una Verificación de Identidad para restablecer mi acceso al sistema.\n\nMi IDENTIFICADOR DE SISTEMA es: *${systemId.value}*\n\n¿Podrías ayudarme con el código de rescate?`;
  const url = `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`;
  openUrl(url);
};

const enviarEmailSoporte = () => {
  const emailAdmin = "jhonjairoaraujocacuango@gmail.com";
  const nombre = userDrive.value?.name || "(Nombre no disponible)";
  const correo = userDrive.value?.email || "(Email no disponible)";

  const subject = "Solicitud de Código de Rescate 2FA";
  const body = `Hola. Mi nombre es ${nombre} y mi correo es ${correo}.\n\nNo tengo acceso a mi dispositivo Authenticator ni a mi Llave Maestra. Necesito solicitar una Verificación de Identidad para restablecer mi acceso al sistema.\n\nMi IDENTIFICADOR DE SISTEMA es: ${systemId.value}\n\n¿Podrías ayudarme con el código de rescate?`;
  const url = `mailto:${emailAdmin}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  openUrl(url);
};

const reabrirMain = async () => {
  const existing = await WebviewWindow.getByLabel("main");

  if (existing) {
    // Si la ventana está minimizada, la restauramos
    await existing.unminimize();
    // La mostramos (por si estaba oculta)
    await existing.show();
    // Técnica de enfoque forzado: traer al frente con alwaysOnTop momentáneo
    await existing.setAlwaysOnTop(true);
    await existing.setAlwaysOnTop(false);
    // Finalmente le damos el foco
    await existing.setFocus();
  } else {
    const win = new WebviewWindow("main", {
      title: "Sistema Gestión Pollos",
      width: 800,
      height: 600,
      resizable: true,
      center: true,
    });

    win.once("tauri://created", () => {
      console.log("✅ Ventana principal re-abierta");
    });
  }
};
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

        <div class="sidebar-divider"></div>

        <button
          class="sidebar-btn-back"
          @click="reabrirMain"
          :disabled="requiereSeguridadUrgente"
          :title="
            requiereSeguridadUrgente
              ? 'Debes configurar o restaurar tu seguridad 2FA primero'
              : ''
          "
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            class="btn-icon-sm"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
          {{
            requiereSeguridadUrgente
              ? "Seguridad Requerida"
              : "Volver al Sistema"
          }}
        </button>

        <button class="sidebar-btn" @click="cerrarSesion">Cerrar sesión</button>
      </aside>

      <main class="dashboard-content">
        <!-- --- BANNER DE ALERTA DE SEGURIDAD (INTEGRIDAD) --- -->
        <div
          v-if="requiereSeguridadUrgente"
          class="security-integrity-banner animate-fade-in"
        >
          <div class="integrity-icon">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <div class="integrity-text">
            <strong>Seguridad:</strong> Tu cuenta requiere protección 2FA. Por
            favor, <strong>configura una nueva</strong> en el
            <strong
              class="integrity-link"
              @click="cambiarSeccion('sincronizacion')"
              >Panel de Sincronización</strong
            >.
          </div>
        </div>

        <!-- --- 🛡️ VALLA DE SEGURIDAD: BANNER DE ERROR CRÍTICO (VISIBLE EN CUALQUIER SECCIÓN) --- -->
        <div
          v-if="databaseMalformed"
          class="sync-card malformed-alert animate-bounce-subtle"
          style="
            border: 3px solid #ef4444;
            background: #fff1f2;
            margin: 10px 20px 25px 20px;
            padding: 24px;
            display: flex;
            flex-direction: column;
            gap: 15px;
            box-shadow: 0 10px 30px rgba(239, 68, 68, 0.15);
            border-radius: 20px;
          "
        >
          <div
            class="header-with-icon"
            style="
              color: #b91c1c;
              display: flex;
              align-items: center;
              gap: 12px;
            "
          >
            <div
              style="
                background: #ef4444;
                color: white;
                width: 40px;
                height: 40px;
                border-radius: 12px;
                display: flex;
                align-items: center;
                justify-content: center;
              "
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="3"
                style="width: 24px; height: 24px"
              >
                <path
                  d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <h3 style="margin: 0; font-weight: 900; font-size: 20px">
              Error de Integridad Detectado (Base de Datos Corrupta)
            </h3>
          </div>
          <p
            style="
              color: #7f1d1d;
              margin: 0;
              line-height: 1.6;
              font-size: 15px;
              font-weight: 500;
            "
          >
            Se ha detectado un fallo crítico (<b>malformed disk image</b>) que impide guardar o leer tus registros.
            Para proteger tu información, es necesario ejecutar una reparación.
          </p>
          <button
            class="btn-danger"
            style="
              width: 100%;
              border-radius: 14px;
              padding: 14px;
              font-weight: 800;
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 10px;
              font-size: 16px;
              cursor: pointer;
              border: none;
              transition: transform 0.2s;
            "
            @click="repararBaseDeDatos"
          >
            🚀 Ejecutar Reparación de Emergencia Ahora
          </button>
        </div>

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
                    <div class="grupo-header">{{ formatearIdParaUsuario(grupo.id) }}</div>
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
                      {{ formatearIdParaUsuario(currentGalpon.codigo_conjunto) }}
                    </p>
                    <p class="sheet-id">
                      <strong>Código Galpón:</strong> {{ formatearIdParaUsuario(currentGalpon.id) }}
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
                      {{ formatearIdParaUsuario(galpones[0]?.codigo_conjunto) || "—" }}
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
                        <td :title="item.id">{{ formatearIdParaUsuario(item.id) }}</td>
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
                    <td :title="item.id">{{ formatearIdParaUsuario(item.id) }}</td>
                    <td>{{ item.nombre || "—" }}</td>
                    <td>{{ item.granja || "—" }}</td>
                    <td>{{ item.lote || "—" }}</td>
                    <td>{{ item.galpon || "—" }}</td>
                    <td>{{ item.fecha_ingreso || "—" }}</td>
                    <td>{{ item.procedencia || "—" }}</td>
                    <td>{{ item.cantidad ?? "—" }}</td>
                    <td :title="item.conjunto_id">{{ formatearIdParaUsuario(item.conjunto_id) }}</td>
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
                    <td :title="item.id">{{ formatearIdParaUsuario(item.id) }}</td>
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
            <div class="header-main-title">
              <h1>Sincronización en la Nube</h1>
              <div class="sync-status">
                <SyncIcon
                  :status="syncStatus"
                  :size="22"
                  show-tooltip
                  :tooltip-text="syncTooltip"
                />
              </div>
            </div>
            <p>
              Respalda tu información en Google Drive y restáurala cuando la
              necesites.
            </p>
          </div>

          <div class="sync-container">
            <div v-if="!authenticatedDrive" class="sync-card empty">
              <div class="sync-icon-circle">
                <SyncIcon status="not-linked" :size="44" />
              </div>
              <h2>Sin conexión a Google Drive</h2>
              <p>
                Debes vincular tu cuenta para habilitar los respaldos
                automáticos y manuales.
              </p>
              <div class="login-security-notice">
                <span class="warning-icon-small">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    class="svg-inline-icon"
                  >
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                </span>
                <p>
                  <strong>Importante:</strong> Al iniciar sesión, se te pedirá
                  configurar un Authenticator por seguridad obligatoria.
                </p>
              </div>
              <button
                class="btn-primary"
                @click="iniciarLoginConSeguridad"
                :disabled="loadingDrive"
              >
                {{
                  loadingDrive ? "Conectando..." : "Vincular Cuenta de Google"
                }}
              </button>

              <!-- Enlace de rescate para el usuario -->
              <p
                v-if="loadingDrive"
                class="text-xs text-center animate-fade-in"
                style="margin-top: 15px; color: #64748b"
              >
                ¿Cerraste la ventana por error?<br />
                <a
                  href="#"
                  @click.prevent="resetLoadingDrive"
                  style="
                    color: #3b82f6;
                    font-weight: 700;
                    text-decoration: underline;
                  "
                >
                  Click aquí para cancelar
                </a>
              </p>
            </div>

            <div v-else class="sync-layout">
              <!-- Perfil de Usuario Premium (Centrado y Vertical) -->
              <div class="sync-profile-standalone animate-fade-in">
                <div class="avatar-large-wrapper">
                  <img
                    v-if="userDrive?.picture"
                    :src="userDrive.picture"
                    class="user-avatar-hero"
                    referrerpolicy="no-referrer"
                  />
                  <div class="google-hero-badge">
                    <img
                      src="https://www.gstatic.com/images/branding/product/1x/drive_2020q4_48dp.png"
                      alt="Google Drive"
                    />
                  </div>
                </div>
                <div class="user-hero-text">
                  <h2 class="user-hero-name">
                    {{ userDrive?.name || "Usuario" }}
                  </h2>
                  <p class="user-hero-email">{{ userDrive?.email }}</p>
                  <button
                    class="btn-logout-minimal"
                    @click="showLogoutConfirmModal = true"
                    :disabled="!isOnlineDrive"
                    :title="
                      !isOnlineDrive
                        ? 'No disponible sin conexión a internet'
                        : 'Cerrar sesión en este dispositivo'
                    "
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      class="btn-icon-sm"
                    >
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                    Cerrar Sesión
                  </button>
                </div>
              </div>

              <!-- Sub-pestañas de Sincronización -->

              <!-- Sub-pestañas de Sincronización -->
              <div class="sync-tabs">
                <button
                  class="sync-tab-btn"
                  :class="{ active: subSeccionSync === 'backups' }"
                  @click="subSeccionSync = 'backups'"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    class="tab-icon"
                  >
                    <path
                      d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"
                    />
                    <path d="m3.3 7 8.7 5 8.7-5" />
                    <path d="M12 22V12" />
                  </svg>
                  Mis Backups
                </button>
                <button
                  class="sync-tab-btn"
                  :class="{ active: subSeccionSync === 'seguridad' }"
                  @click="subSeccionSync = 'seguridad'"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    class="tab-icon"
                  >
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                  Seguridad 2FA
                </button>
              </div>

              <!-- CONTENIDO: MIS BACKUPS -->
              <div
                v-if="subSeccionSync === 'backups'"
                class="sync-main-content"
              >
                <!-- Banner de advertencia si no hay 2FA -->
                <div v-if="!is2FAEnabled" class="security-warning-banner">
                  <div class="warning-icon">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      class="icon-md"
                    >
                      <path
                        d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"
                      />
                      <path d="M12 9v4" />
                      <path d="M12 17h.01" />
                    </svg>
                  </div>
                  <div class="warning-text">
                    <strong>Seguridad Desactivada:</strong> Por protección de
                    tus datos, <strong>algunas funciones</strong> estarán
                    bloqueadas hasta que actives el Authenticator en la pestaña
                    de Seguridad.
                  </div>
                </div>

                <!-- Botón de Acción Principal -->
                <div class="sync-main-actions">
                  <button
                    class="btn-primary btn-lg"
                    @click="ejecutarBackupManual"
                    :disabled="loadingDrive || !isOnlineDrive"
                    :title="
                      !isOnlineDrive
                        ? 'No se pueden subir archivos sin conexión a internet'
                        : 'Crear copia de seguridad en la nube'
                    "
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      class="btn-icon"
                    >
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
                    <button
                      class="btn-icon-only"
                      @click="() => listBackupsDrive()"
                      :title="
                        !isOnlineDrive
                          ? 'No se puede actualizar sin internet'
                          : 'Actualizar lista'
                      "
                      :disabled="loadingDrive || !isOnlineDrive"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <polyline points="23 4 23 10 17 10" />
                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                      </svg>
                    </button>
                  </div>

                  <div
                    v-if="loadingDrive && backupsDrive.length === 0"
                    class="list-loading"
                  >
                    Cargando copias de seguridad...
                  </div>

                  <div v-else-if="backupsDrive.length === 0" class="list-empty">
                    No se encontraron copias de seguridad en tu cuenta.
                  </div>

                  <table v-else class="backups-table">
                    <thead>
                      <tr>
                        <th>Nombre del Archivo</th>
                        <th>Arquitectura</th>
                        <th>Ubicación (Nivel)</th>
                        <th>Fecha</th>
                        <th>Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="file in backupsDrive" :key="file.id">
                        <td :title="file.name">
                          <div style="display: flex; align-items: center; gap: 8px">
                            <svg v-if="file.name.endsWith('.key')" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px; color: #f59e0b">
                              <path d="M15 6a5 5 0 1 0-5 5v3l-1 1v2l1 1h2l1-1v-2l1-1v-3a5 5 0 0 0 4-5z" /><circle cx="15" cy="6" r="1" />
                            </svg>
                            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px; color: #3b82f6">
                              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                            </svg>
                            {{ formatearNombreBackup(file.name) }}
                          </div>
                        </td>
                        <td>
                          <span 
                            class="location-badge"
                            :class="file.name.includes('delta') || file.name.includes('_v3') ? 'bg-indigo-100 text-indigo-700' : 'bg-amber-100 text-amber-700'"
                            style="font-size: 10px; border-radius: 4px; padding: 2px 6px;"
                          >
                            {{ file.name.includes('delta') || file.name.includes('_v3') ? 'V3 (Sync)' : 'Legacy' }}
                          </span>
                        </td>
                        <td>
                          <span class="location-badge">
                            {{ formatearUbicacionDrive(file.modifiedTime) }}
                          </span>
                        </td>
                        <td class="text-xs text-gray-500">
                          {{ new Date(file.modifiedTime).toLocaleString() }}
                        </td>
                        <td>
                          <div class="row-actions">
                            <!-- BOTÓN MIGRAR (Solo para Legacy) -->
                            <button
                               v-if="!file.name.includes('delta') && !file.name.includes('_v3') && !file.name.endsWith('.key')"
                               class="btn-primary btn-sm"
                               style="background: #f59e0b; border-color: #d97706;"
                               @click="modernizarRespaldo(file.id)"
                               title="Modernizar arquitectura para Sincronización Delta"
                            >
                               Migrar V3
                            </button>

                            <button
                              class="btn-danger btn-sm"
                              @click="confirmarRestaurarBackup(file.id)"
                              :disabled="
                                !!(
                                  loadingDrive ||
                                  eliminandoBackup ||
                                  !isOnlineDrive
                                )
                              "
                              :title="
                                !isOnlineDrive
                                  ? 'Se requiere conexión a internet'
                                  : !is2FAEnabled
                                    ? 'Haz clic para configurar seguridad y restaurar'
                                    : loadingDrive
                                      ? 'Espera a que termine la sincronización'
                                      : 'Restaurar esta versión'
                              "
                            >
                              Restaurar
                            </button>
                            <button
                              class="btn-secondary btn-sm btn-delete"
                              :title="
                                !isOnlineDrive
                                  ? 'No disponible sin conexión'
                                  : !is2FAEnabled
                                    ? 'Haz clic para configurar seguridad y eliminar'
                                    : loadingDrive
                                      ? 'Sincronización en curso...'
                                      : filaEliminandoId === file.id
                                        ? 'Eliminando...'
                                        : 'Eliminar permanentemente'
                              "
                              @click="
                                confirmarEliminarBackup(file.id, file.name)
                              "
                              :disabled="
                                !!(
                                  loadingDrive ||
                                  !isOnlineDrive ||
                                  (filaEliminandoId &&
                                    filaEliminandoId !== file.id)
                                )
                              "
                              :class="{
                                disabled: loadingDrive || !isOnlineDrive,
                              }"
                            >
                              <div
                                v-if="filaEliminandoId === file.id"
                                class="mini-spinner"
                              ></div>
                              <svg
                                v-else
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                class="icon-trash"
                              >
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path
                                  d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                                ></path>
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <!-- CONTENIDO: AJUSTES DE SEGURIDAD -->
              <div
                v-if="subSeccionSync === 'seguridad'"
                class="sync-main-content"
              >
                <div class="sync-card security-config-card">
                  <div
                    class="security-hero-icon"
                    :class="{ secure: is2FAEnabled }"
                  >
                    <svg
                      v-if="is2FAEnabled"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      class="hero-svg"
                    >
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      <path d="m9 12 2 2 4-4" />
                    </svg>
                    <svg
                      v-else
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      class="hero-svg"
                    >
                      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </div>
                  <h2>Protección de Datos con Authenticator</h2>
                  <p v-if="!is2FAEnabled">
                    Vincular tu cuenta te permite realizar acciones críticas
                    como borrar backups de forma segura desde tu teléfono, sin
                    depender de navegadores.
                  </p>
                  <p v-else>
                    Tu sistema está actualmente protegido. Necesitarás el código
                    de tu celular para eliminar cualquier copia de seguridad.
                  </p>

                  <div
                    class="security-status"
                    :class="{ enabled: is2FAEnabled }"
                  >
                    Estado:
                    <strong>{{
                      is2FAEnabled ? "ACTIVADO" : "DESACTIVADO"
                    }}</strong>
                  </div>

                  <button class="btn-primary btn-lg" @click="iniciar2FASetup">
                    {{
                      is2FAEnabled
                        ? "Re-configurar Authenticator"
                        : "Activar Protección Ahora"
                    }}
                  </button>

                  <div class="security-footer-info">
                    <p>
                      Funciona con cualquier aplicación de códigos (Google
                      Authenticator, Authy, Microsoft, etc.). No requiere
                      conexión a internet para verificar.
                    </p>
                  </div>
                </div>

                <!-- --- BOTÓN DE EMERGENCIA (BORRAR DESPUÉS DE USAR) --- -->
                <div
                  v-if="isDev"
                  class="sync-card emergency-zone"
                  style="
                    margin-top: 20px;
                    border: 2px dashed #ef4444;
                    background: #fff1f2;
                  "
                >
                  <h3
                    style="
                      color: #b91c1c;
                      display: flex;
                      align-items: center;
                      gap: 8px;
                    "
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      style="width: 20px; height: 20px"
                    >
                      <path
                        d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"
                      />
                      <path d="M12 9v4" />
                      <path d="M12 17h.01" />
                    </svg>
                    ZONA DE EMERGENCIA (DESARROLLO)
                  </h3>
                  <p style="color: #7f1d1d; font-size: 13px">
                    Usa esto SOLO si perdiste el celular y NO tienes códigos de
                    recuperación. Esto borrará toda protección 2FA de la base de
                    datos.
                  </p>
                  <button
                    class="btn-danger btn-lg"
                    style="
                      width: 100%;
                      margin-top: 10px;
                      background: #ef4444;
                      color: white;
                      border: none;
                    "
                    @click="forzarResetMaestro"
                  >
                    FORZAR RESETEO MAESTRO DE 2FA
                  </button>
                </div>
              </div>
            </div>
          </div>
        </template>
      </main>
    </div>
  </div>

  <!-- --- MODALES DE SEGURIDAD 2FA --- -->

  <!-- Modal de Configuración (QR) -->
  <div v-if="show2FASetupModal" class="modal-overlay">
    <div class="modal-box setup-2fa-box">
      <h3>Seguridad: Vincular Authenticator</h3>
      <p>
        Escanea este código QR con tu aplicación (Google Authenticator, Authy,
        etc.) para habilitar el borrado seguro.
      </p>

      <div v-if="setup2FAData" class="qr-container">
        <img :src="setup2FAData.qr" alt="QR 2FA" class="qr-image" />
        <div class="secret-display">
          <span>O ingresa esta clave manualmente:</span>
          <code>{{ setup2FAData.secret }}</code>
        </div>
      </div>

      <div class="verify-setup">
        <label
          >Para confirmar, ingresa el código de 6 dígitos que ves en tu
          móvil:</label
        >
        <input
          v-model="input2FACode"
          type="text"
          maxlength="6"
          placeholder="000000"
          class="totp-input"
          @keyup.enter="confirmar2FASetup"
        />
      </div>

      <div class="modal-actions">
        <button
          class="btn-secondary"
          @click="show2FASetupModal = false"
          :disabled="verificando2FA"
        >
          Cancelar
        </button>
        <button
          class="btn-primary"
          @click="confirmar2FASetup"
          :disabled="verificando2FA || input2FACode.length < 6"
        >
          {{ verificando2FA ? "Verificando..." : "Confirmar Vínculo" }}
        </button>
      </div>
    </div>
  </div>

  <!-- Modal de Códigos de Recuperación -->
  <div v-if="showRecoveryModal" class="modal-overlay">
    <div class="modal-box recovery-codes-box">
      <div class="security-header success">
        <div class="security-icon">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h3>Seguridad Activada: Llave Maestra</h3>
      </div>
      <p>
        Google Authenticator se vinculó con éxito. Para máxima seguridad, se ha
        generado una <strong>Llave Maestra Encriptada</strong>. Este archivo es
        la ÚNICA forma de recuperar el acceso si pierdes tu celular. Nadie más
        podrá leerla.
      </p>

      <div class="key-preview-box animate-scale-in">
        <div class="key-icon">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d="M15 6a5 5 0 1 0-5 5v3l-1 1v2l1 1h2l1-1v-2l1-1v-3a5 5 0 0 0 4-5z"
            />
            <circle cx="15" cy="6" r="1" />
          </svg>
        </div>
        <div class="key-status">
          Llave Maestra Generada (Protegida por AES-256)
        </div>
      </div>

      <div class="modal-actions-vertical">
        <button
          class="btn-secondary btn-full btn-with-icon"
          @click="descargarCodigosRecuperacion"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            class="btn-icon-sm"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Descargar Llave Maestra (.key)
        </button>

        <button
          v-if="haDescargadoCodigos"
          class="btn-primary btn-full animate-fade-in"
          @click="finalizarConfiguracion2FA"
        >
          He guardado mi archivo y deseo finalizar
        </button>

        <p v-else class="status-warning-text">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            class="inline-icon-xs"
          >
            <path
              d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
            />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          Debes descargar el archivo para habilitar la finalización.
        </p>

        <div v-if="subiendoADrive" class="drive-status-info">
          <div class="mini-spinner"></div>
          <span>Subiendo copia a Google Drive...</span>
        </div>
        <div v-if="subidaDriveExitosa" class="drive-status-info success">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            class="inline-icon-xs"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>Copia en Google Drive guardada</span>
        </div>
      </div>
    </div>
  </div>

  <div v-if="show2FAVerifyModal" class="modal-overlay">
    <div
      class="modal-box security-verify-box"
      @dragover.prevent
      @drop="handleKeyFileDrop"
    >
      <div class="security-header">
        <div class="security-icon">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </div>
        <h3>{{ modalSeguridadTitulo }}</h3>
      </div>
      <p v-html="modalSeguridadMensaje"></p>

      <div
        class="master-key-shortcut"
        :class="{ 'success-border': llaveValidada }"
        @click="cargarLlaveMaestra"
        @dragover.prevent
        @drop.prevent="handleKeyFileDrop"
      >
        <span v-if="verificando2FA">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            class="spin inline-icon-sm"
          >
            <path
              d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"
            />
            <path d="M12 6v6l4 2" />
          </svg>
          Leyendo Llave Maestra...
        </span>
        <span
          v-else-if="llaveValidada"
          style="
            color: #059669;
            font-weight: 700;
            display: flex;
            align-items: center;
            gap: 8px;
          "
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            style="width: 18px; height: 18px"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Llave Maestra Validada
        </span>
        <span v-else style="display: flex; align-items: center; gap: 8px">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            style="width: 20px; height: 20px"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Importar Llave Maestra (.key)
        </span>
      </div>

      <div v-if="llaveValidada" class="validation-success-info animate-fade-in">
        <p>
          La llave ha sido reconocida. El código de seguridad se ha
          auto-completado. Haz clic en <strong>Confirmar</strong> para
          continuar.
        </p>
      </div>

      <input
        v-model="input2FACode"
        type="text"
        :maxlength="showSupportMode ? 20 : 6"
        :placeholder="showSupportMode ? 'CÓDIGO DE SOPORTE' : '000000'"
        class="totp-input big"
        :class="{ 'support-active': showSupportMode }"
        @keyup.enter="procesarEliminacionCon2FA"
        autofocus
      />

      <!-- MODAL SOPORTE INFO -->
      <div v-if="!llaveValidada" class="support-area">
        <button class="btn-link-sm" @click="showSupportMode = !showSupportMode">
          {{
            showSupportMode
              ? "Volver a modo normal"
              : "¿Perdiste tu celular y Llave Maestra?"
          }}
        </button>

        <div v-if="showSupportMode" class="support-details animate-fade-in">
          <p class="text-sm">
            Envía tu Identificador al administrador para recibir un código de
            reset:
          </p>
          <div class="system-id-badge">{{ systemId }}</div>

          <div class="support-contact-card">
            <h4>Ponte en contacto</h4>
            <div class="contact-info-row">
              <span class="contact-label">WhatsApp:</span>
              <span class="contact-value">0999694629</span>
            </div>
            <div class="contact-info-row">
              <span class="contact-label">Correo:</span>
              <span class="contact-value text-xs"
                >jhonjairoaraujocacuango@gmail.com</span
              >
            </div>

            <div class="support-contact-options">
              <button class="btn-support-wa" @click="enviarWhatsAppSoporte">
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  class="btn-icon-xs"
                >
                  <path
                    d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"
                  />
                </svg>
                Enviar Mensaje
              </button>
              <button class="btn-support-mail" @click="enviarEmailSoporte">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  class="btn-icon-xs"
                >
                  <path
                    d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"
                  ></path>
                  <polyline points="22,6 12,13 2,6"></polyline>
                </svg>
                Enviar Correo
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="modal-actions">
        <button
          class="btn-secondary"
          @click="show2FAVerifyModal = false"
          :disabled="verificando2FA"
        >
          Cancelar
        </button>
        <button
          :class="
            verifyTargetFileId !== 'LOGIN_IDENTITY_UNLOCK'
              ? 'btn-danger'
              : 'btn-primary'
          "
          @click="procesarEliminacionCon2FA"
          :disabled="verificando2FA || input2FACode.length < 6"
        >
          {{ modalSeguridadBotonLabel }}
        </button>
      </div>
    </div>
  </div>

  <!-- MODAL DE CONFIRMACIÓN DE CIERRE DE SESIÓN -->
  <div v-if="showLogoutConfirmModal" class="modal-overlay">
    <div
      class="modal-box danger-modal animate-fade-in"
      style="max-width: 420px; text-align: center; padding: 40px"
    >
      <div class="modal-header-icon-danger">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          style="width: 64px; height: 64px"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
        </svg>
      </div>
      <h3
        style="
          text-align: center;
          margin-top: 0;
          margin-bottom: 12px;
          font-size: 24px;
        "
      >
        Cerrar Sesión de Drive
      </h3>
      <p style="text-align: center; color: #64748b; margin-bottom: 24px">
        Si desvinculas la cuenta, todas las funciones de nube se desactivarán.
      </p>

      <div class="modal-actions-vertical">
        <button class="btn-unlink-full" @click="solicitarLogout2FA">
          Cerrar Sesión en Google Drive
        </button>
        <button
          class="btn-cancel-modal"
          @click="showLogoutConfirmModal = false"
        >
          Cancelar
        </button>
      </div>
    </div>
  </div>

  <!-- MODAL PARA ELIMINAR LLAVE MAESTRA OBSOLETA (PERSONALIZADO) -->
  <div v-if="showDeleteOldKeyConfirm" class="modal-overlay">
    <div
      class="modal-box danger-modal animate-fade-in"
      style="max-width: 440px; text-align: center; padding: 40px"
    >
      <div class="modal-header-icon-danger">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          style="width: 64px; height: 64px"
        >
          <path
            d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
          ></path>
          <line x1="12" y1="9" x2="12" y2="13"></line>
          <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>
      </div>

      <h3 style="margin-top: 0; margin-bottom: 12px; font-size: 24px">
        Eliminar Llave Inútil
      </h3>
      <p style="text-align: center; color: #64748b; margin-bottom: 24px">
        Esta Llave Maestra ya no será válida para futuras configuraciones.
        ¿Deseas eliminar el archivo permanentemente de tu equipo?
      </p>

      <div class="modal-actions-vertical">
        <button class="btn-unlink-full" @click="confirmarEliminarLlaveInutil">
          Sí, eliminar archivo
        </button>
        <button
          class="btn-cancel-modal"
          @click="showDeleteOldKeyConfirm = false"
        >
          No, conservar archivo
        </button>
      </div>
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

  <!-- MODAL PREMIUM: RESPALDO DE LLAVE MAESTRA -->
  <Transition name="fade">
    <div v-if="showMasterKeyUploadModal" class="modal-overlay">
      <div class="modal-content premium-dialog animate-scale-in">
        <div class="modal-header-premium">
          <div class="modal-icon-wrapper blue">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <h3>Copia en la Nube</h3>
        </div>

        <div class="modal-body">
          <p class="text-center">
            La Llave Maestra se ha guardado en tu PC. <br />
            <strong
              >¿Deseas subir una copia cifrada a tu Google Drive para mayor
              seguridad?</strong
            >
          </p>
          <p class="text-muted text-sm text-center">
            Esto te permitirá recuperar tu cuenta incluso si pierdes el archivo
            en este equipo.
          </p>
        </div>

        <div class="modal-footer">
          <button
            class="btn-secondary"
            @click="cancelarSubidaLlave"
            :disabled="subiendoLlaveADrive"
          >
            No, solo en PC
          </button>
          <button
            class="btn-primary"
            @click="confirmarSubidaLlave"
            :disabled="subiendoLlaveADrive"
          >
            <span v-if="subiendoLlaveADrive" class="mini-spinner"></span>
            {{ subiendoLlaveADrive ? "Subiendo..." : "Sí, subir a Drive" }}
          </button>
        </div>
      </div>
    </div>
  </Transition>

  <!-- MODAL: RECUPERACIÓN EXITOSA (POST-RESTART) -->
  <Transition name="fade">
    <div v-if="showRecoverySuccessModal" class="modal-overlay">
      <div class="modal-content premium-dialog animate-scale-in">
        <div class="modal-header-premium">
          <div
            class="modal-icon-wrapper"
            :class="recoveryType === 'local' ? 'green' : 'orange'"
          >
            <svg
              v-if="recoveryType === 'local'"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
            >
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <svg
              v-else
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
            >
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
          </div>
          <h3>
            {{
              recoveryType === "local"
                ? "Reparación Exitosa"
                : "Sistema Aislado"
            }}
          </h3>
        </div>

        <div class="modal-body">
          <div v-if="recoveryType === 'local'">
            <p class="text-center">
              ¡Buenas noticias! Hemos recuperado tu sistema utilizando tu
              <strong>respaldo local automático</strong>.
            </p>
            <div
              class="info-notice-box"
              style="
                margin-top: 15px;
                background: #f0fdf4;
                border: 1px solid #bbf7d0;
                padding: 15px;
                border-radius: 16px;
              "
            >
              <p
                style="
                  margin: 0;
                  color: #166534;
                  font-size: 14px;
                  line-height: 1.5;
                "
              >
                Tus datos están intactos y al día. Puedes continuar trabajando
                de inmediato.
              </p>
            </div>
          </div>
          <div v-else>
            <p class="text-center">
              El archivo dañado ha sido aislado, pero
              <strong>no se encontró un respaldo local saludable</strong>.
            </p>
            <div
              class="info-notice-box"
              style="
                margin-top: 15px;
                background: #fffbeb;
                border: 1px solid #fef3c7;
                padding: 15px;
                border-radius: 16px;
              "
            >
              <p
                style="
                  margin: 0;
                  color: #92400e;
                  font-size: 14px;
                  line-height: 1.5;
                "
              >
                <b>Siguiente paso:</b> La aplicación se ha iniciado en blanco.
                Ve a Sincronización para restaurar tu última copia de la nube.
              </p>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button
            class="btn-primary"
            style="width: 100%; height: 50px; font-size: 16px"
            @click="cerrarRecoverySuccessModal"
          >
            {{
              recoveryType === "local"
                ? "Excelente, Continuar"
                : "Ir a Sincronización Ahora"
            }}
          </button>
        </div>
      </div>
    </div>
  </Transition>

  <!-- SISTEMA DE TOAST PREMIUM -->
  <Transition name="toast">
    <div
      v-if="toast.show"
      class="toast-container"
      :class="[toast.type, { dragging: draggingToast }]"
      :style="{ transform: `translateY(${toastY}px)` }"
      @mousedown="handleToastMouseDown"
    >
      <div class="toast-swipe-indicator"></div>
      <div class="toast-icon">
        <svg
          v-if="toast.type === 'success'"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="3"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <svg
          v-else-if="toast.type === 'error'"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="3"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </div>
      <div class="toast-content">
        {{ toast.message }}
      </div>
    </div>
  </Transition>
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
  position: relative;
  z-index: 10000; /* Por encima del modal-overlay (9999) */
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
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
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

.login-security-notice {
  margin: 15px 0 25px 0;
  padding: 12px 18px;
  background: #f0f9ff;
  border-radius: 12px;
  border: 1px solid #bae6fd;
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 400px;
}

.login-security-notice p {
  margin: 0 !important;
  font-size: 13px !important;
  color: #0369a1 !important;
  line-height: 1.4;
  text-align: left !important;
}

.warning-icon-small {
  font-size: 20px;
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

.list-empty,
.list-loading {
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

.location-badge {
  display: inline-block;
  padding: 4px 10px;
  background-color: #f0f4f8;
  color: #2d3748;
  border-radius: 6px;
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  border: 1px solid #d1d9e6;
  white-space: nowrap;
}

[theme="dark"] .location-badge {
  background-color: #2d3748;
  color: #edf2f7;
  border-color: #4a5568;
}
.row-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.btn-delete {
  padding: 6px !important;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #a0aec0 !important;
  border: 1px solid #e2e8f0 !important;
  background: white !important;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-delete:hover {
  color: #e53e3e !important;
  border-color: #feb2b2 !important;
  background: #fff5f5 !important;
}

.btn-delete:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* BANNER INTEGRIDAD */
.security-integrity-banner {
  flex-shrink: 0;
  background: #991b1b;
  color: white;
  padding: 12px 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 15px;
  z-index: 1000;
  font-size: 16px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  margin-bottom: 7px;
  border-radius: 12px;
}

.integrity-icon {
  width: 42px;
  height: 42px;
  background: white;
  border-radius: 12px;
  display: flex !important;
  align-items: center;
  justify-content: center;
  color: #ef4444;
  box-shadow: 0 4px 12px rgba(239, 68, 68, 0.15);
  flex-shrink: 0;
}

.integrity-link {
  text-decoration: underline;
  cursor: pointer;
  color: #ffffff;
  transition: color 0.2s;
}

.integrity-link:hover {
  color: #fca5a5;
}

.integrity-icon svg {
  width: 22px;
  height: 22px;
}

.sidebar-btn-back:disabled {
  opacity: 0.4;
  background: rgba(255, 255, 255, 0.02);
  cursor: not-allowed;
}

.icon-trash {
  width: 18px;
  height: 18px;
}
.mini-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(0, 0, 0, 0.1);
  border-top: 2px solid #ef4444;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.setup-2fa-box,
.verify-delete-box {
  text-align: center;
}

.qr-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 15px;
  margin: 20px 0;
  padding: 15px;
  background: #fdfdfd;
  border: 1px dashed #ddd;
  border-radius: 12px;
}

.qr-image {
  width: 200px;
  height: 200px;
  border: 4px solid #fff;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
}

.secret-display {
  font-size: 12px;
  color: #666;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.secret-display code {
  font-size: 14px;
  font-weight: 700;
  color: #222;
  letter-spacing: 1px;
}

.totp-input {
  width: 100%;
  padding: 12px;
  font-size: 18px;
  text-align: center;
  letter-spacing: 4px;
  border: 2px solid #e5e7eb;
  border-radius: 10px;
  margin-top: 10px;
  font-weight: 700;
}

.totp-input.big {
  font-size: 28px;
  height: 60px;
  border-color: #ef4444;
  color: #ef4444;
  margin-bottom: 20px;
}

.totp-input:focus {
  border-color: #2563eb;
  outline: none;
}

.security-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.security-icon {
  width: 60px;
  height: 60px;
  border-radius: 18px;
  display: flex !important;
  align-items: center;
  justify-content: center;
  margin-bottom: 10px;
}

.security-icon svg {
  width: 32px;
  height: 32px;
}
.sync-tabs {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
  border-bottom: 2px solid #e5e7eb;
  padding-bottom: 10px;
}

.header-main-title {
  display: flex;
  align-items: center;
  gap: 15px;
  flex-wrap: wrap;
}

.sync-live-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  background: #eff6ff;
  color: #2563eb;
  border-radius: 99px;
  font-size: 13px;
  font-weight: 700;
  border: 1px solid #dbeafe;
}

.sync-live-badge.success {
  background: #ecfdf5;
  color: #059669;
  border-color: #d1fae5;
}

.badge-icon {
  width: 14px;
  height: 14px;
}

.mini-spinner-blue {
  width: 14px;
  height: 14px;
  border: 2px solid #2563eb22;
  border-top-color: #2563eb;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.sidebar-divider {
  margin: 15px 0;
  height: 1px;
  background: rgba(255, 255, 255, 0.1);
}

.sidebar-btn-back {
  width: 100%;
  padding: 12px 15px;
  border: none;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  color: #94a3b8;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
  transition: all 0.2s ease;
  margin-top: auto;
}

.sidebar-btn-back:hover {
  background: rgba(255, 255, 255, 0.15);
  color: white;
}

.btn-logout-minimal {
  margin: 24px auto 0 auto;
  background: white;
  color: #ef4444;
  border: 1px solid #fee2e2;
  padding: 10px 24px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  box-shadow: 0 4px 10px -2px rgba(220, 38, 38, 0.05);
}

.btn-icon-sm {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.btn-with-icon {
  display: flex !important;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.inline-icon-xs {
  width: 14px;
  height: 14px;
  display: inline-block;
  vertical-align: middle;
}

.inline-icon-sm {
  width: 18px;
  height: 18px;
  display: inline-block;
  vertical-align: middle;
}

.svg-inline-icon {
  width: 100%;
  height: 100%;
}

.tab-icon {
  width: 18px;
  height: 18px;
}

.icon-md {
  width: 24px;
  height: 24px;
}

.hero-svg {
  width: 64px;
  height: 64px;
}

.security-hero-icon.secure {
  color: #10b981;
}

.btn-logout-minimal:hover {
  background: #fef2f2;
  border-color: #fecaca;
  transform: translateY(-2px);
  box-shadow: 0 8px 15px -3px rgba(220, 38, 38, 0.1);
}

.sync-tab-btn {
  padding: 10px 20px;
  border: none;
  background: transparent;
  font-weight: 700;
  cursor: pointer;
  color: #6b7280;
  border-radius: 8px;
  transition: all 0.2s;
}

.sync-tab-btn.active {
  background: #2563eb;
  color: white;
}

.security-warning-banner {
  display: flex;
  align-items: center;
  gap: 15px;
  background: #fffbeb;
  border: 1px solid #fcd34d;
  color: #92400e;
  padding: 15px;
  border-radius: 12px;
  margin-bottom: 20px;
  margin-top: -30px;
}

.warning-icon {
  font-size: 24px;
}

.warning-text strong {
  color: #b45309;
}

.sync-profile-standalone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  margin: 0 auto 40px auto;
  background: white;
  border-radius: 24px;
  border: 1px solid #e2e8f0;
  width: fit-content;
  min-width: 320px;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05);
}

.avatar-large-wrapper {
  position: relative;
  margin-bottom: 20px;
}

.user-avatar-hero {
  width: 100px;
  height: 100px;
  border-radius: 30px;
  object-fit: cover;
  border: 4px solid white;
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.1);
}

.google-hero-badge {
  position: absolute;
  bottom: -4px;
  right: -4px;
  background: white;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
}

.google-hero-badge img {
  width: 18px;
  height: 18px;
}

.user-hero-text {
  text-align: center;
}

.user-hero-name {
  font-size: 26px;
  font-weight: 850;
  color: #0f172a;
  margin: 0 0 4px 0;
  letter-spacing: -1px;
}

.user-hero-email {
  font-size: 15px;
  color: #64748b;
  margin: 0;
  font-weight: 500;
}

.modal-actions-vertical {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
}

.btn-unlink-full {
  background: #ef4444;
  color: white;
  border: none;
  padding: 12px;
  border-radius: 8px;
  font-weight: 700;
  cursor: pointer;
  width: 100%;
}

.btn-cancel-modal {
  background: #f8fafc;
  color: #64748b;
  border: 1px solid #e2e8f0;
  padding: 12px;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
}

.modal-header-icon-danger {
  font-size: 40px;
  text-align: center;
  margin-bottom: 20px;
}

.security-config-card {
  padding: 40px !important;
  text-align: center;
}

.security-hero-icon {
  font-size: 60px;
  margin-bottom: 20px;
}

.security-status {
  display: inline-block;
  padding: 8px 16px;
  background: #fee2e2;
  color: #991b1b;
  border-radius: 20px;
  font-size: 12px;
  margin-bottom: 20px;
}

.security-status.enabled {
  background: #dcfce7;
  color: #166534;
}

.security-footer-info {
  margin-top: 30px;
  font-size: 12px;
  color: #94a3b8;
}

.danger-zone {
  border: 1px dashed #ef4444 !important;
  background: #fff5f5 !important;
  margin-top: 20px;
}

.btn-unlink-big {
  background: #fff;
  border: 1px solid #ef4444;
  color: #ef4444;
  padding: 10px 20px;
  border-radius: 8px;
  font-weight: 700;
  cursor: pointer;
}

.btn-delete.disabled {
  opacity: 0.3;
  cursor: not-allowed;
  filter: grayscale(1);
}

/* Estilos Drive Status */
.drive-status-info {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-size: 13px;
  color: #3b82f6;
  background: #eff6ff;
  padding: 10px;
  border-radius: 8px;
  border: 1px solid #dbeafe;
}

.drive-status-info.success {
  color: #059669;
  background: #ecfdf5;
  border-color: #d1fae5;
  font-weight: 600;
}

/* Estilos Recovery Codes */
.recovery-codes-box {
  max-width: 450px !important;
  text-align: center;
}

.security-header.success {
  margin-bottom: 20px;
}

.security-header.success .security-icon {
  background: #ecfdf5;
  color: #10b981;
  border: 1px solid rgba(16, 185, 129, 0.2);
  box-shadow: 0 8px 16px rgba(16, 185, 129, 0.1);
}

/* Estilos Mandatorios Recovery */
.modal-actions-vertical {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 20px;
}

.status-warning-text {
  color: #b45309;
  font-size: 13px;
  font-weight: 600;
  margin: 0;
  background: #fffbeb;
  padding: 8px;
  border-radius: 6px;
  border: 1px solid #fde68a;
}

.animate-fade-in {
  animation: fadeIn 0.4s ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Estilos Master Key Shortcut */
.master-key-shortcut {
  display: block;
  width: fit-content;
  margin: 10px auto 20px auto;
  padding: 10px 18px;
  background: #f0f7ff;

  border: 1px dashed #3b82f6;
  border-radius: 8px;
  cursor: pointer;
  color: #2563eb;
  font-size: 13px;
  font-weight: 600;
  transition: all 0.2s;
  display: inline-block;
}

.master-key-shortcut:hover {
  background: #dbeafe;
  color: #1d4ed8;
  transform: translateY(-1px);
}

.master-key-shortcut.success-border {
  border: 2px solid #059669;
  background: #ecfdf5;
  cursor: default;
}

.validation-success-info {
  margin-top: -10px;
  margin-bottom: 20px;
  background: #f0fdf4;
  border-left: 4px solid #059669;
  padding: 12px 16px;
  border-radius: 8px;
  text-align: left;
}

.validation-success-info p {
  margin: 0;
  font-size: 13px;
  color: #065f46;
  line-height: 1.5;
}

.validation-success-info strong {
  color: #047857;
}

.animate-fade-in {
  animation: fadeIn 0.3s ease-out;
}

.support-area {
  margin-top: 5px;
  margin-bottom: 15px;
}

.btn-link-sm {
  background: none;
  border: none;
  color: #6366f1;
  font-size: 12px;
  text-decoration: underline;
  cursor: pointer;
  padding: 5px;
}

.btn-link-sm:hover {
  color: #4f46e5;
}

.support-details {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 10px;
  margin-top: 8px;
}

.support-details p {
  font-size: 11px;
  margin-bottom: 5px !important;
  color: #64748b;
}

.system-id-badge {
  display: inline-block;
  background: #334155;
  color: #f8fafc;
  padding: 4px 10px;
  border-radius: 4px;
  font-family: monospace;
  font-weight: 700;
  font-size: 16px;
  letter-spacing: 2px;
}

.totp-input.support-active {
  border-color: #6366f1;
  color: #4f46e5;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(5px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.key-preview-box {
  background: #fcfdfe;
  border-radius: 24px;
  padding: 45px 30px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 25px;
  margin: 25px 0;
  border: 1px solid #eef2f7;
  box-shadow:
    0 10px 30px -5px rgba(0, 0, 0, 0.03),
    inset 0 2px 4px rgba(255, 255, 255, 0.8);
  position: relative;
  overflow: hidden;
}

.key-preview-box::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 6px;
  background: linear-gradient(90deg, #10b981, #3b82f6);
  opacity: 0.8;
}

.key-icon {
  width: 80px;
  height: 80px;
  background: #ffffff;
  border-radius: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #10b981;
  box-shadow: 0 12px 20px -8px rgba(16, 185, 129, 0.2);
  border: 1px solid #e2e8f0;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  z-index: 1;
}

.key-icon svg {
  width: 38px;
  height: 38px;
  filter: drop-shadow(0 0 5px rgba(16, 185, 129, 0.2));
}

.key-status {
  color: #334155;
  font-family: "JetBrains Mono", "Courier New", Courier, monospace;
  font-size: 13px;
  text-align: center;
  letter-spacing: -0.2px;
  z-index: 1;
  background: #ffffff;
  padding: 12px 24px;
  border-radius: 14px;
  border: 1px solid #e2e8f0;
  font-weight: 700;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.02);
}

.recovery-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 15px;
  background: #fff;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.code-number {
  color: #94a3b8;
  font-weight: 600;
  font-size: 13px;
}

.code-text {
  font-family: "Courier New", Courier, monospace;
  font-weight: 700;
  letter-spacing: 2px;
  color: #1e293b;
  font-size: 18px;
}

.btn-full {
  width: 100%;
  padding: 14px;
  background: #10b981 !important;
}

.btn-full:hover {
  background: #059669 !important;
}
/* --- TOAST STYLES PREMIUM --- */
.toast-container {
  position: fixed;
  bottom: 30px;
  right: 30px;
  z-index: 9999;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 24px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.12);
  border: 1px solid rgba(0, 0, 0, 0.05);
  max-width: 400px;
  cursor: grab;
  user-select: none;
  transition: transform 0.1s ease-out;
}

.toast-container.dragging {
  transition: none;
  cursor: grabbing;
  box-shadow: 0 15px 50px rgba(0, 0, 0, 0.15);
}

.toast-swipe-indicator {
  position: absolute;
  top: 6px;
  left: 50%;
  transform: translateX(-50%);
  width: 30px;
  height: 4px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 2px;
}
.toast-container.success {
  border-left: 5px solid #10b981;
}
.toast-container.error {
  border-left: 5px solid #ef4444;
}
.toast-icon {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.toast-container.success .toast-icon {
  color: #10b981;
}
.toast-container.error .toast-icon {
  color: #ef4444;
}
.toast-content {
  color: #1f2937;
  font-size: 14px;
  font-weight: 600;
}
.toast-enter-active,
.toast-leave-active {
  transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}
.toast-enter-from {
  opacity: 0;
  transform: translate(30px, 0) scale(0.9);
}
.toast-leave-to {
  opacity: 0;
  transform: translate(0, 20px) scale(0.9);
}
/* --- PREMIUM MODAL STYLES --- */
.premium-dialog {
  background: #ffffff;
  border-radius: 20px;
  width: 100%;
  max-width: 460px;
  overflow: hidden;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.8);
}

.modal-header-premium {
  padding: 30px 30px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 15px;
}

.modal-icon-wrapper {
  width: 60px;
  height: 60px;
  border-radius: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 5px;
}

.modal-icon-wrapper.blue {
  background: #eff6ff;
  color: #2563eb;
}

.modal-icon-wrapper svg {
  width: 32px;
  height: 32px;
}

.modal-header-premium h3 {
  margin: 0;
  font-size: 22px;
  font-weight: 800;
  color: #1f2937;
}

.modal-body {
  padding: 20px 30px;
}

.modal-footer {
  padding: 20px 30px 30px;
  display: flex;
  gap: 12px;
}

.modal-footer button {
  flex: 1;
  padding: 12px;
  font-size: 15px;
  font-weight: 700;
  border-radius: 12px;
}

.text-center {
  text-align: center;
}
.text-muted {
  color: #6b7280;
}
.text-sm {
  font-size: 13px;
}

.animate-scale-in {
  animation: scaleIn 0.3s cubic-bezier(0.165, 0.84, 0.44, 1);
}

@keyframes scaleIn {
  from {
    opacity: 0;
    transform: scale(0.9);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.mini-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  display: inline-block;
  margin-right: 8px;
  vertical-align: middle;
  animation: spin 0.8s linear infinite;
}

/* --- MONITOR DE SINCRONIZACIÓN (V3 Flash) --- */
.sync-status {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  background: #ffffff;
  cursor: help;
  transition: all 0.2s ease;
}

.sync-status:hover {
  background: #f8fafc;
  border-color: #94a3b8;
}

.sync-icon-status {
  width: 22px;
  height: 22px;
}

.sync-icon-status.spin {
  animation: spin-cloud 2s linear infinite;
}

.sync-icon-status.pending {
  filter: drop-shadow(0 0 3px rgba(245, 158, 11, 0.4));
}

.sync-icon-status.disconnected {
  opacity: 0.5;
}

.sync-icon-status.success {
  filter: drop-shadow(0 0 3px rgba(16, 185, 129, 0.4));
}

@keyframes spin-cloud {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.support-contact-options {
  display: flex;
  gap: 10px;
  margin-top: 15px;
  justify-content: center;
}

.support-contact-card {
  margin-top: 15px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 16px;
  text-align: left;
}

.support-contact-card h4 {
  margin: 0 0 10px;
  font-size: 14px;
  color: #1e293b;
  text-align: center;
}

.contact-info-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 6px;
  font-size: 13px;
}

.contact-label {
  color: #64748b;
  font-weight: 500;
}

.contact-value {
  color: #1e293b;
  font-weight: 700;
}

.text-xs {
  font-size: 11px;
}

.btn-support-wa,
.btn-support-mail {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  border: none;
  transition: transform 0.2s;
}

.btn-support-wa {
  background: #25d366;
  color: #fff;
}

.btn-support-mail {
  background: #3b82f6;
  color: #fff;
}

.btn-support-wa:hover,
.btn-support-mail:hover {
  transform: translateY(-2px);
  filter: brightness(1.1);
}
</style>
