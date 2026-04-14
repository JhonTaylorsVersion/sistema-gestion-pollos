import { ref, onMounted, computed } from "vue";

import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { fetch } from "@tauri-apps/plugin-http";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useNotify } from "./useNotify";

export interface GoogleUser {
  name: string;
  email: string;
  picture: string;
}

export interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string; // Cambiado de createdTime a modifiedTime
  size: string;
}

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = "http://127.0.0.1:14210";
const SCOPES =
  "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email";

const user = ref<GoogleUser | null>(null);
const loading = ref(false);
const backups = ref<DriveFile[]>([]);
const accessToken = ref<string | null>(
  localStorage.getItem("google_access_token"),
);
const refreshToken = ref<string | null>(
  localStorage.getItem("google_refresh_token"),
);

const lastAutoUploadTime = ref<number>(0);
const dailyFileId = ref<string | null>(null);
let deferredTimer: any = null;

export const isDirty = ref(false);
export const syncError = ref<string | null>(null);
export const isOnline = ref(window.navigator.onLine);
export const isDatabaseCorrupted = ref(false);

if (typeof window !== "undefined") {
  const checkStatus = async () => {
    // 1. Chequeo rápido del navegador
    let online = window.navigator.onLine;

    // 2. Si el navegador dice que sí, validamos con un fetch rápido (latido)
    // Solo si el estado anterior era online, para evitar bucles de fetch si ya sabemos que estamos offline
    if (online) {
      try {
        // Petición ligera solo de cabeceras
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        await window.fetch("https://www.google.com/favicon.ico", {
          mode: "no-cors",
          method: "HEAD",
          signal: controller.signal,
          cache: "no-store",
        });
        clearTimeout(timeoutId);
        online = true;
      } catch (e) {
        // Si el fetch falla, realmente no hay internet funcional
        online = false;
      }
    }

    if (online !== isOnline.value) {
      console.log(
        online ? "🌐 Internet detectado (Real)" : "🚫 Internet perdido (Real)",
      );
      isOnline.value = online;
      if (online) syncError.value = null;
    }
  };

  window.addEventListener("online", () => {
    console.log("🌐 Evento Online detectado");
    checkStatus();
  });

  window.addEventListener("offline", () => {
    console.log("🚫 Evento Offline detectado");
    isOnline.value = false;
  });

  // Polling de seguridad cada 1.5 segundos por seguridad crítica en backups/restores
  setInterval(checkStatus, 1500);


  // Un check inicial al cargar
  setTimeout(checkStatus, 1000);
}

console.log(
  "💿 useDrive.ts: Cargando estado global. Token:",
  localStorage.getItem("google_access_token") ? "PRESENTE" : "AUSENTE",
);

export async function hashString(str: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(str.toUpperCase().trim());
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface AccountState {
  schemaVersion: number;
  cloudAccountId?: string;
  appAccountInitialized: boolean;
  twoFactor: {
    enabled: boolean;
    confirmed: boolean;
    method: "totp" | "none";
    enrolledAt?: string;
    secretStoredMode: "local_only" | "cloud_encrypted";
  };
  recovery: {
    hasRecoveryCodes: boolean;
    recoveryCodeHashes?: string[];
    hasMasterKey: boolean;
    masterKeyVerifier?: string;
    updatedAt?: string;
    failedAttempts: number;
  };
  backups: {
    hasAnyBackup: boolean;
    lastBackupAt?: string;
  };
  devicePolicy: {
    require2faOnNewInstall: boolean;
  };
}

const cloudAccountState = ref<AccountState | null>(null);

export function useDrive() {
  const { mostrarToast } = useNotify();

  const login = async (force: boolean = false) => {
    // 🛡️ GUARDIA: Si ya hay un login en curso, no permitir otro para evitar conflictos de puertos
    if (loading.value) {
      console.warn(
        "⚠️ [useDrive] Intento de login duplicado bloqueado para evitar conflictos.",
      );
      return false;
    }

    try {
      loading.value = true;
      const promptValue = force ? "select_account login" : "consent";
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=code&scope=${SCOPES}&access_type=offline&prompt=${promptValue}`;

      // 1. Iniciamos el servidor de escucha
      const serverTask = invoke<string>("start_oauth_server", {
        authUrlBase: authUrl,
      });

      // 2. Lanzar el navegador
      await openUrl(authUrl);

      // 🛡️ [MEJORA UX]: Timeout de seguridad por si el usuario cierra el navegador
      let timeoutId: any;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error("TIEMPO_EXCEDIDO"));
        }, 120000); // 2 minutos máximo de espera
      });

      // 3. Esperar el código o el timeout
      const code = await Promise.race([serverTask, timeoutPromise]);
      clearTimeout(timeoutId);

      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri: REDIRECT_URI,
          grant_type: "authorization_code",
        }).toString(),
      });

      const data = (await response.json()) as any;

      if (data.access_token) {
        setTokens(data.access_token, data.refresh_token);
        await fetchUserInfo();
        return true;
      }
      return false;
    } catch (error) {
      console.error("Login Error:", error);
      const isTimeout = (error as Error).message === "TIEMPO_EXCEDIDO";
      
      mostrarToast(
        isTimeout 
          ? "El tiempo de espera para iniciar sesión ha expirado. Por favor, intenta de nuevo."
          : "Error al iniciar sesión con Google. Por favor, verifica tu conexión o intenta de nuevo.",
        isTimeout ? "info" : "error",
      );
      return false;
    } finally {
      loading.value = false;
    }
  };

  const setTokens = (access: string, refresh?: string) => {
    accessToken.value = access;
    localStorage.setItem("google_access_token", access);
    if (refresh) {
      refreshToken.value = refresh;
      localStorage.setItem("google_refresh_token", refresh);
    }
  };

  const signout = () => {
    accessToken.value = null;
    refreshToken.value = null;
    user.value = null;
    dailyFileId.value = null;
    localStorage.removeItem("google_access_token");
    localStorage.removeItem("google_refresh_token");
  };

  const refreshAccessToken = async () => {
    if (!refreshToken.value) return false;
    try {
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          refresh_token: refreshToken.value,
          grant_type: "refresh_token",
        }).toString(),
      });
      const data = (await response.json()) as any;
      if (data.access_token) {
        setTokens(
          data.access_token,
          data.refresh_token || (refreshToken.value as string),
        );
        return true;
      }
    } catch (error) {
      console.error("Refresh Token Error:", error);
    }
    return false;
  };

  const fetchWithAuth = async (url: string, options: any = {}) => {
    let response = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${accessToken.value}`,
      },
    });

    if (response.status === 401) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        response = await fetch(url, {
          ...options,
          headers: {
            ...options.headers,
            Authorization: `Bearer ${accessToken.value}`,
          },
        });
      } else {
        signout();
        throw new Error("Sesión expirada");
      }
    }

    return response;
  };

  const fetchUserInfo = async () => {
    try {
      const response = await fetchWithAuth(
        "https://www.googleapis.com/oauth2/v3/userinfo",
      );
      const data = (await response.json()) as any;
      console.log("Respuesta Completa de Google UserInfo:", data);

      user.value = {
        name: data.name || "Usuario",
        email: data.email || "Sin correo",
        picture: data.picture || "",
      };

      console.log("Perfil Procesado:", user.value);
    } catch (error) {
      console.error("User Info Error:", error);
    }
  };

  const listBackups = async (silent = false) => {
    try {
      if (!silent) loading.value = true;
      // IMPORTANTE: Codificamos el query para evitar errores de interpretación (espacios -> %20)
      const query = "name contains 'pollos_backup_' and trashed = false";
      const response = await fetchWithAuth(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&orderBy=modifiedTime desc&fields=files(id, name, modifiedTime, size)`,
      );
      const data = (await response.json()) as any;
      backups.value = data.files || [];

      // Si el archivo que teníamos en caché para hoy no aparece en la lista fresca, lo olvidamos
      const dateStr = new Date().toISOString().slice(0, 10);
      const todayFileName = `pollos_backup_${dateStr}.db`;
      const existsInList = backups.value.some((f) => f.name === todayFileName);
      if (!existsInList) {
        dailyFileId.value = null;
      }
    } catch (error) {
      console.error("List Backups Error:", error);
    } finally {
      if (!silent) loading.value = false;
    }
  };

  // --- NUEVA LÓGICA DE CARPETAS ---
  const currentMonthFolderId = ref<string | null>(null);
  const securityKeysFolderId = ref<string | null>(null);


  const getOrCreateFolder = async (name: string, parentId?: string) => {
    try {
      let query = `name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
      if (parentId) {
        query += ` and '${parentId}' in parents`;
      }

      const response = await fetchWithAuth(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id)`,
      );
      const data = (await response.json()) as any;

      if (data.files && data.files.length > 0) {
        return data.files[0].id;
      }

      // NO EXISTE: Crear
      console.log(`📁 Creando carpeta: ${name}`);
      const metadata: any = {
        name,
        mimeType: "application/vnd.google-apps.folder",
      };
      if (parentId) metadata.parents = [parentId];

      const createResponse = await fetchWithAuth(
        "https://www.googleapis.com/drive/v3/files",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(metadata),
        },
      );
      const createdData = (await createResponse.json()) as any;
      return createdData.id;
    } catch (e) {
      console.error(`Error en getOrCreateFolder (${name}):`, e);
      return null;
    }
  };

  const ensureFolderHierarchy = async () => {
    // Si ya lo tenemos de esta sesión, no repetimos
    if (currentMonthFolderId.value) return currentMonthFolderId.value;

    try {
      // 1. Root
      const rootId = await getOrCreateFolder("SistemaGestionPollos_Backups");
      if (!rootId) return null;

      // 2. Año
      const yearStr = new Date().getFullYear().toString();
      const yearId = await getOrCreateFolder(yearStr, rootId);
      if (!yearId) return null;

      // 3. Mes
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
      const mesActualStr = mesesFull[new Date().getMonth()];
      const monthId = await getOrCreateFolder(mesActualStr, yearId);

      currentMonthFolderId.value = monthId;
      return monthId;
    } catch (e) {
      console.error("Error asegurando jerarquía de carpetas:", e);
      return null;
    }
  };

  const ensureSecurityKeysFolder = async () => {
    if (securityKeysFolderId.value) return securityKeysFolderId.value;
    try {
      const rootId = await getOrCreateFolder("SistemaGestionPollos_Backups");
      if (!rootId) return null;
      const folderId = await getOrCreateFolder("LLAVES DE SEGURIDAD", rootId);
      securityKeysFolderId.value = folderId;
      return folderId;
    } catch (e) {
      console.error("Error asegurando carpeta de llaves:", e);
      return null;
    }
  };

  const findTodayBackup = async (datePrefix: string, parentId?: string) => {

    try {
      // Buscamos cualquier archivo que EMPIECE con el prefijo de hoy
      let query = `name contains '${datePrefix}' and trashed = false`;
      if (parentId) query += ` and '${parentId}' in parents`;

      const response = await fetchWithAuth(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id, name)`,
      );
      const data = (await response.json()) as any;
      if (data.files && data.files.length > 0) {
        // Devolvemos el ID del primer encuentro para hoy
        return data.files[0].id;
      }
    } catch (e) {
      console.error("Error buscando backup de hoy:", e);
    }
    return null;
  };

  const uploadBackup = async (manual = true, force = false) => {
    if (!accessToken.value) return;

    const now = Date.now();
    const COOLDOWN_TIME = 500; // ⚡ Sincronización casi instantánea

    if (!manual && !force && now - lastAutoUploadTime.value < COOLDOWN_TIME) {
      if (deferredTimer) return;

      const remaining = COOLDOWN_TIME + 100 - (now - lastAutoUploadTime.value);
      deferredTimer = setTimeout(() => {
        deferredTimer = null;
        uploadBackup(false, true);
      }, remaining);

      return;
    }

    if (deferredTimer) {
      clearTimeout(deferredTimer);
      deferredTimer = null;
    }

    try {
      loading.value = true;
      syncError.value = null; // Limpiar errores previos al iniciar

      if (!isOnline.value) {
        throw new Error("Sin conexión a internet");
      }

      // 🛡️ VALLA DE SEGURIDAD: Control de Integridad antes de subir
      console.log("🔍 [Drive] Validando integridad de la base de datos antes de subir...");
      try {
        const { default: Database } = await import("@tauri-apps/plugin-sql");
        const dbIntegrity = await Database.load("sqlite:pollos.db");
        const check = await dbIntegrity.select<any[]>("PRAGMA integrity_check");
        await dbIntegrity.close();

        if (!check || check[0]["integrity_check"] !== "ok") {
          isDatabaseCorrupted.value = true;
          throw new Error(
            "La base de datos local está dañada. Subida cancelada para proteger el respaldo de la nube.",
          );
        }
        console.log("✅ [Drive] Integridad verificada. Procediendo con el backup.");
      } catch (err: any) {
        if (err.message?.includes("malformed")) {
          isDatabaseCorrupted.value = true;
        }
        throw err;
      }

      // 📂 Asegurar carpetas Raíz -> Año -> Mes
      const folderId = await ensureFolderHierarchy();
      if (!folderId) {
        console.warn("⚠️ No se pudo obtener la carpeta destino en Drive.");
      }

      const dbPath = await invoke<string>("get_db_path");
      const dbContent = await readFile(dbPath);

      const nowObj = new Date();
      const dateStr = nowObj.toISOString().slice(0, 10); // YYYY-MM-DD
      const timeStr = nowObj
        .toLocaleTimeString("es-EC", { hour12: false })
        .replace(/:/g, "-");

      const datePrefix = `pollos_backup_${dateStr}`;
      const newFileName = `${datePrefix}_${timeStr}.db`;

      // Buscamos si ya existe una copia de HOY (sin importar la hora que tenga el nombre)
      const existingId = await findTodayBackup(
        datePrefix,
        folderId || undefined,
      );

      let response;

      if (existingId) {
        // 1. ACTUALIZAR NOMBRE (Metadata)
        console.log(`☁️ Renombrando backup de hoy a: ${newFileName}`);
        await fetchWithAuth(
          `https://www.googleapis.com/drive/v3/files/${existingId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: newFileName }),
          },
        );

        // 2. ACTUALIZAR CONTENIDO (Media)
        console.log(
          `☁️ Actualizando contenido de backup diario ID: ${existingId}`,
        );
        response = await fetchWithAuth(
          `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=media`,
          {
            method: "PATCH",
            body: dbContent,
          },
        );
      } else {
        // CREAR (POST Multipart)
        console.log(`☁️ Creando copia inicial para hoy: ${newFileName}`);
        const metadata: any = {
          name: newFileName,
          mimeType: "application/octet-stream",
        };
        if (folderId) metadata.parents = [folderId];

        const formData = new FormData();
        formData.append(
          "metadata",
          new Blob([JSON.stringify(metadata)], { type: "application/json" }),
        );
        formData.append(
          "file",
          new Blob([dbContent], { type: "application/octet-stream" }),
        );

        response = await fetchWithAuth(
          "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
          {
            method: "POST",
            body: formData,
          },
        );

        const data = (await response.json()) as any;
        if (data.id) dailyFileId.value = data.id;
      }

      if (response.ok) {
        lastAutoUploadTime.value = Date.now();
        isDirty.value = false; // Reset glocal dirty flag
        syncError.value = null; // Clear error on success

        await listBackups();
        return true;
      } else {
        throw new Error("Fallo en la comunicación con Google Drive.");
      }
    } catch (error) {
      console.error("Upload Error:", error);

      const msg = typeof error === "string" ? error : (error as Error).message;
      syncError.value = msg; // Guardar el error para la UI

      if (manual) {
        mostrarToast(`Error al subir copia de seguridad: ${msg}`, "error");
      }
      return false;
    } finally {
      loading.value = false;
    }
  };

  // ... (restoreBackup logic) ...

  const uploadFile = async (file: File, folderType: "backup" | "security" = "backup") => {

    if (!accessToken.value) return;
    try {
      loading.value = true;
      const folderId = folderType === "security"
        ? await ensureSecurityKeysFolder()
        : await ensureFolderHierarchy();


      const metadata: any = {
        name: file.name,
        mimeType: file.type || "application/octet-stream",
      };
      if (folderId) metadata.parents = [folderId];

      const formData = new FormData();
      formData.append(
        "metadata",
        new Blob([JSON.stringify(metadata)], { type: "application/json" }),
      );
      formData.append("file", file);

      const response = await fetchWithAuth(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
        {
          method: "POST",
          body: formData,
        },
      );

      if (response.ok) {
        return true;
      } else {
        throw new Error("Error en la respuesta de Google.");
      }
    } catch (e) {
      console.error("uploadFile Error:", e);
      return false;
    } finally {
      loading.value = false;
    }
  };

  const restoreBackup = async (fileId: string) => {
    try {
      const confirmed = await ask(
        "¿Estás seguro? Se reemplazarán todos los datos actuales y la app se reiniciará.",
        {
          title: "Confirmar Restauración",
          kind: "warning",
        },
      );

      if (!confirmed) return;

      loading.value = true;
      const response = await fetchWithAuth(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
        { responseType: 1 }, // Binary
      );

      if (!response.ok) {
        if (response.status === 404) {
          mostrarToast(
            "El archivo de seguridad ya no existe en Google Drive. Es posible que haya sido eliminado permanentemente desde otro dispositivo.",
            "error",
          );
          // Aprovechamos para limpiar la lista
          await listBackups(true);
        } else {
          throw new Error(`Error de descarga (${response.status})`);
        }
        return;
      }

      const content = await response.arrayBuffer();

      // Validación extra: si el contenido es demasiado pequeño, probablemente no sea un .db válido
      if (content.byteLength < 100) {
        throw new Error("El archivo descargado parece estar corrupto o vacío.");
      }

      const dbPath = await invoke<string>("get_db_path");

      // 🛡️ CREAR BACKUP LOCAL DE EMERGENCIA ANTES DE REEMPLAZAR
      try {
        const currentDB = await readFile(dbPath);
        await writeFile(dbPath + ".bak", currentDB);
        console.log(
          "📦 Backup local de emergencia creado en:",
          dbPath + ".bak",
        );
      } catch (e) {
        console.warn("⚠️ No se pudo crear backup temporal de seguridad:", e);
      }

      await writeFile(dbPath, new Uint8Array(content));

      mostrarToast(
        "La base de datos se ha restaurado con éxito. La aplicación se reiniciará ahora para aplicar los cambios.",
        "info",
      );

      await invoke("restart_app");
    } catch (error) {
      console.error("Restore Error:", error);
      const msg = typeof error === "string" ? error : (error as Error).message;
      mostrarToast(
        `Error al restaurar: ${msg}\n\nEs posible que la base de datos esté bloqueada por el programa. Intenta cerrar otras ventanas o reinicia la app.`,
        "error",
      );
    } finally {
      loading.value = false;
    }
  };

  const deleteBackup = async (fileId: string) => {
    try {
      loading.value = true;
      const response = await fetchWithAuth(
        `https://www.googleapis.com/drive/v3/files/${fileId}`,
        { method: "DELETE" },
      );

      if (response.ok) {
        // Refrescamos la lista inmediatamente
        await listBackups(true);
        return true;
      } else {
        const errorData = (await response.json()) as any;
        throw new Error(
          errorData.error?.message || "Error al eliminar de Drive",
        );
      }
    } catch (error) {
      console.error("Delete Error:", error);
      throw error;
    } finally {
      loading.value = false;
    }
  };

  // --- GESTIÓN DE ESTADO DE CUENTA (AppDataFolder) ---

  const fetchAccountState = async () => {
    try {
      loading.value = true;
      console.log("🔍 Buscando estado de cuenta en AppDataFolder...");

      const response = await fetchWithAuth(
        `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name='account_state.json'&fields=files(id, name)`,
      );

      const data = (await response.json()) as any;

      if (data.files && data.files.length > 0) {
        const fileId = data.files[0].id;
        const contentResponse = await fetchWithAuth(
          `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
        );

        if (contentResponse.ok) {
          const state = (await contentResponse.json()) as AccountState;
          cloudAccountState.value = state;
          console.log("✅ Estado de cuenta recuperado:", state);
          return state;
        }
      }

      console.log("ℹ️ No se encontró un estado de cuenta previo.");
      cloudAccountState.value = null;
      return null;
    } catch (e) {
      console.error("Error al obtener AccountState:", e);
      return null;
    } finally {
      loading.value = false;
    }
  };

  const saveAccountState = async (state: AccountState) => {
    try {
      loading.value = true;
      console.log("💾 Guardando estado de cuenta en AppDataFolder...");

      // 1. Buscar si ya existe para sobrescribir
      const searchResponse = await fetchWithAuth(
        `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name='account_state.json'&fields=files(id)`,
      );
      const searchData = (await searchResponse.json()) as any;
      const existingId =
        searchData.files && searchData.files.length > 0
          ? searchData.files[0].id
          : null;

      const metadata = {
        name: "account_state.json",
        mimeType: "application/json",
        parents: existingId ? undefined : ["appDataFolder"],
      };

      const formData = new FormData();
      formData.append(
        "metadata",
        new Blob([JSON.stringify(metadata)], { type: "application/json" }),
      );
      formData.append(
        "file",
        new Blob([JSON.stringify(state)], { type: "application/json" }),
      );

      let response;
      if (existingId) {
        response = await fetchWithAuth(
          `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart`,
          {
            method: "PATCH",
            body: formData,
          },
        );
      } else {
        response = await fetchWithAuth(
          "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
          {
            method: "POST",
            body: formData,
          },
        );
      }

      if (response.ok) {
        cloudAccountState.value = state;
        console.log("✅ Estado de cuenta guardado exitosamente.");
        return true;
      } else {
        const errorText = await response.text();
        console.error("❌ Error de Google Drive al guardar estado:", {
          status: response.status,
          body: errorText
        });
        throw new Error(`Drive Error ${response.status}: ${errorText}`);
      }
    } catch (e) {
      console.error("🚨 Error crítico al guardar AccountState:", e);
      return false;
    } finally {
      loading.value = false;
    }
  };

  // --- Sincronización entre ventanas ---
  // Escuchamos cambios en localStorage para actualizar el estado si otra ventana inicia sesión
  if (typeof window !== "undefined") {
    window.addEventListener("storage", (event) => {
      console.log(
        "📢 [useDrive] Cambios en almacenamiento detectados:",
        event.key,
        "->",
        event.newValue ? "TOKEN PRESENTE" : "BORRADO",
      );
      if (event.key === "google_access_token") {
        accessToken.value = event.newValue;
        if (event.newValue) fetchUserInfo();
      }
      if (event.key === "google_refresh_token") {
        refreshToken.value = event.newValue;
      }
    });
  }

  onMounted(() => {
    if (accessToken.value) {
      fetchUserInfo();
    }
  });

  return {
    user,
    loading,
    backups,
    login,
    signout,
    listBackups,
    uploadBackup,
    uploadFile,
    restoreBackup,
    deleteBackup,
    isAuthenticated: computed(() => !!accessToken.value),

    // Identidad
    cloudAccountState,
    fetchAccountState,
    saveAccountState,
    resetLoading: () => (loading.value = false),
    hashString,

    isDirty,
    syncError,
    isOnline,
    isDatabaseCorrupted,
  };
}
