import { ref, computed, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { fetch } from "@tauri-apps/plugin-http";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useNotify } from "./useNotify";

export type ConfirmHandler = (
  message: string,
  options?: string | { title?: string; kind?: "error" | "info" | "warning" },
) => Promise<boolean>;
const currentConfirmHandler = ref<ConfirmHandler>(ask);

export const setConfirmHandler = (handler: ConfirmHandler) => {
  currentConfirmHandler.value = handler;
};

export interface GoogleUser {
  name: string;
  email: string;
  picture: string;
}

export interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
  size: string;
}

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = "http://127.0.0.1:14210";
const SCOPES =
  "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email";

const user = ref<GoogleUser | null>(
  JSON.parse(localStorage.getItem("google_user_cache") || "null"),
);
const loading = ref(false);

const backups = ref<DriveFile[]>(JSON.parse(localStorage.getItem("google_backups_cache") || "[]"));
const isBackupSafetyLockActive = ref(false);
const isOnline = ref(window.navigator.onLine);
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
const syncError = ref<string | null>(
  localStorage.getItem("google_sync_error_cache"),
);
const isDatabaseCorrupted = ref(false);

const deviceId = ref<string>(localStorage.getItem("app_device_id") || "");
if (!deviceId.value) {
  deviceId.value = crypto.randomUUID();
  localStorage.setItem("app_device_id", deviceId.value);
}

// 🛡️ [SINGLETON] Listener de almacenamiento (Global, una sola vez)
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === "google_access_token") {
      accessToken.value = event.newValue;
    }
    if (event.key === "google_refresh_token") {
      refreshToken.value = event.newValue;
    }
  });

  const checkStatus = async () => {
    let online = window.navigator.onLine;
    if (online) {
      try {
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
        online = false;
      }
    }
    if (online !== isOnline.value) {
      isOnline.value = online;
      if (online) syncError.value = null;
    }
  };

  window.addEventListener("online", checkStatus);
  window.addEventListener("offline", () => (isOnline.value = false));
  setInterval(checkStatus, 1500);
}

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

const cloudAccountState = ref<AccountState | null>(
  JSON.parse(localStorage.getItem("google_account_state_cache") || "null"),
);

// --- COMPOSABLE ---
export function useDrive() {
  const { mostrarToast } = useNotify();

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
    localStorage.removeItem("google_user_cache");
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
    } catch (err: any) {
      console.error("Refresh Error:", err);
    }
    return false;
  };

  const fetchWithAuth = async (url: string, options: any = {}) => {
    if (!accessToken.value) throw new Error("NO_TOKEN");
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
    if (!isOnline.value || !accessToken.value) return;
    try {
      const response = await fetchWithAuth(
        "https://www.googleapis.com/oauth2/v3/userinfo",
      );
      if (!response.ok) return;
      const data = (await response.json()) as any;
      user.value = {
        name: data.name || "Usuario",
        email: data.email || "Sin correo",
        picture: data.picture || "",
      };
      localStorage.setItem("google_user_cache", JSON.stringify(user.value));
    } catch (e) {}
  };

  const login = async (force = false) => {
    if (loading.value) return false;
    try {
      loading.value = true;
      const promptValue = force ? "select_account login" : "consent";
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=code&scope=${SCOPES}&access_type=offline&prompt=${promptValue}`;

      const serverTask = invoke<string>("start_oauth_server", { authUrlBase: authUrl });
      await openUrl(authUrl);

      const code = await serverTask;
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
    } catch (e) {
      console.error("Login Error:", e);
      mostrarToast("Error al conectar con Google.", "error");
      return false;
    } finally {
      loading.value = false;
    }
  };

  const listBackups = async (silent = false) => {
    if (!isOnline.value || !accessToken.value) return;
    try {
      if (!silent) loading.value = true;
      const query = "name contains 'pollos_backup_' and trashed = false";
      // 🛡️ BUST-CACHE: Añadimos un timestamp para forzar a Google a ignorar cualquier caché del listado
      const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&orderBy=modifiedTime desc&fields=files(id, name, modifiedTime, size)&t=${Date.now()}`;
      
      const response = await fetchWithAuth(url);
      const data = (await response.json()) as any;
      backups.value = data.files || [];
      localStorage.setItem("google_backups_cache", JSON.stringify(backups.value));
    } catch (e) {
      console.error("List Error:", e);
    } finally {
      if (!silent) loading.value = false;
    }
  };

  const deltasFolderId = ref<string | null>(null);

  const getOrCreateFolder = async (name: string, parentId?: string) => {
    try {
      let query = `name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
      if (parentId) query += ` and '${parentId}' in parents`;

      const response = await fetchWithAuth(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id)`,
      );
      const data = (await response.json()) as any;

      if (data.files && data.files.length > 0) return data.files[0].id;

      const metadata: any = { name, mimeType: "application/vnd.google-apps.folder" };
      if (parentId) metadata.parents = [parentId];

      const createResponse = await fetchWithAuth("https://www.googleapis.com/drive/v3/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(metadata),
      });
      const created = (await createResponse.json()) as any;
      return created.id;
    } catch (e) {
      return null;
    }
  };

  const ensureDeltasFolder = async () => {
    if (deltasFolderId.value) return deltasFolderId.value;
    const rootId = await getOrCreateFolder("SistemaGestionPollos_Backups");
    if (!rootId) return null;
    const folderId = await getOrCreateFolder("AppSync_Deltas", rootId);
    deltasFolderId.value = folderId;
    return folderId;
  };

  const uploadBackup = async (manual = true, force = false) => {
    if (!accessToken.value || !isOnline.value) return "skipped";

    // 🚩 Marcamos como sucio desde el inicio si hay un intento de backup.
    // Solo se limpiará cuando una subida física tenga éxito.
    isDirty.value = true;

    const now = Date.now();
    const COOLDOWN_TIME = 60000;

    if (!manual && !force && now - lastAutoUploadTime.value < COOLDOWN_TIME) {
      if (deferredTimer) {
        console.log("⏳ [Drive] Backup automático ya está programado en diferido. Esperando...");
        return "skipped";
      }
      const remaining = COOLDOWN_TIME - (now - lastAutoUploadTime.value);
      console.log(`⏳ [Drive] Cooldown activo. Programando subida automática en ${Math.round(remaining / 1000)}s. Estado: PENDIENTE.`);
      
      deferredTimer = setTimeout(() => {
        deferredTimer = null;
        uploadBackup(false, true);
      }, remaining);
      return "skipped";
    }

    // 🛡️ [Seguro de Vida de Datos]
    const hasRestored = localStorage.getItem("last_restore_completed") === "true";
    const hasCloudData = backups.value.length > 0;
    
    if (hasCloudData && !hasRestored) {
        isBackupSafetyLockActive.value = true;
        if (!manual) {
            console.warn("🛡️ [Drive] SUBIDA AUTO-BLOQUEADA: Riesgo de sobreescritura. Restaure primero.");
            isDirty.value = true;
            return "skipped";
        }
    } else {
        isBackupSafetyLockActive.value = false;
    }

    try {
      loading.value = true;
      console.log(`🚀 [Drive] INICIANDO SUBIDA FÍSICA (${manual ? "Manual" : "Automática/Forzada"}).`);

      const dbPath = await invoke<string>("get_db_path");
      const { default: Database } = await import("@tauri-apps/plugin-sql");
      const dbCheckpoint = await Database.load("sqlite:pollos.db");
      await dbCheckpoint.execute("PRAGMA wal_checkpoint(FULL)");

      const dbContent = await readFile(dbPath);
      const dateStr = new Date().toISOString().slice(0, 10);
      const fileName = `pollos_backup_v3_${dateStr}.db`;

      const rootId = await getOrCreateFolder("SistemaGestionPollos_Backups");
      const yearId = await getOrCreateFolder(new Date().getFullYear().toString(), rootId);
      const meses = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
      const monthId = await getOrCreateFolder(meses[new Date().getMonth()], yearId);

      const checkQuery = `name = '${fileName}' and '${monthId}' in parents and trashed = false`;
      const checkRes = await fetchWithAuth(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(checkQuery)}&fields=files(id)`);
      const checkData = await checkRes.json() as any;
      const existingId = checkData.files?.[0]?.id;

      const metadata = { name: fileName, parents: existingId ? undefined : [monthId] };
      const formData = new FormData();
      formData.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
      formData.append("file", new Blob([dbContent], { type: "application/octet-stream" }));

      const url = existingId 
        ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart&fields=id,name,modifiedTime`
        : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime";

      const response = await fetchWithAuth(url, { method: existingId ? "PATCH" : "POST", body: formData });

      if (response.ok) {
        const updatedFile = await response.json() as DriveFile;
        console.log("📝 [Drive] VERIFICACIÓN DE SUBIDA:");
        console.log(`   - Archivo Planeado: ${fileName}`);
        console.log(`   - Archivo en Drive:  ${updatedFile.name}`);
        console.log(`   - ID de Google:     ${updatedFile.id}`);
        console.log(`   - Última Modificación oficial: ${updatedFile.modifiedTime}`);
        console.log(`   - Estado: CONFIRMADO Y ACTUALIZADO ✅`);

        lastAutoUploadTime.value = Date.now();
        isDirty.value = false;

        // 🚀 Optimización UX: Actualizar la lista en memoria ANTES de volver a pedirla
        const idx = backups.value.findIndex(f => f.id === updatedFile.id);
        if (idx !== -1) {
          backups.value[idx] = { ...backups.value[idx], ...updatedFile };
        } else {
          backups.value.unshift(updatedFile);
        }
        localStorage.setItem("google_backups_cache", JSON.stringify(backups.value));

        await listBackups(true);
        return true;
      }
      return false;
    } catch (e) {
      console.error("Backup Error:", e);
      return false;
    } finally {
      loading.value = false;
    }
  };

  const uploadFile = async (data: string | File | Uint8Array, remoteName: string) => {
    if (!accessToken.value || !isOnline.value) return false;
    try {
      loading.value = true;
      const rootId = await getOrCreateFolder("SistemaGestionPollos_Backups");
      const folderId = await getOrCreateFolder("Security_Keys", rootId);

      let content: Uint8Array;
      if (typeof data === "string") {
        content = await readFile(data);
      } else if (data instanceof File) {
        content = new Uint8Array(await data.arrayBuffer());
      } else {
        content = data;
      }

      const metadata = { name: remoteName, parents: [folderId] };
      const formData = new FormData();
      formData.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
      
      // Fix for TypeScript type mismatch with SharedArrayBuffer/ArrayBuffer
      const blobPart: any = content;
      formData.append("file", new Blob([blobPart], { type: "application/octet-stream" }));

      const response = await fetchWithAuth("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime", {
        method: "POST",
        body: formData,
      });
      return response.ok;
    } catch (e) {
      return false;
    } finally {
      loading.value = false;
    }
  };

  const restoreBackup = async (fileId: string, skipRestart = false) => {
    try {
      loading.value = true;
      const dbPath = await invoke<string>("get_db_path");
      const response = await fetchWithAuth(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
      if (!response.ok) throw new Error("Error al descargar");

      const buffer = await response.arrayBuffer();
      await writeFile(dbPath + ".pending", new Uint8Array(buffer));
      
      if (skipRestart) {
        // En modo migración, aplicamos el archivo pendiente inmediatamente al path real
        await writeFile(dbPath, new Uint8Array(buffer));
        return true;
      }

      localStorage.setItem("db_recovery_flag", "clean");
      localStorage.setItem("last_restore_completed", "true"); // 🛡️ Desbloquea el Seguro de Vida de Datos
      await invoke("restart_app");
      return true;
    } catch (e) {
      mostrarToast("Error al restaurar el respaldo.", "error");
      return false;
    } finally {
      loading.value = false;
    }
  };

  const deleteBackup = async (fileId: string) => {
    try {
      loading.value = true;
      const response = await fetchWithAuth(`https://www.googleapis.com/drive/v3/files/${fileId}`, { method: "DELETE" });
      if (response.ok) {
        await listBackups(true);
        return true;
      }
      return false;
    } catch (e) {
      return false;
    } finally {
      loading.value = false;
    }
  };

  const fetchAccountState = async () => {
    if (!accessToken.value || !isOnline.value) return null;
    try {
      const query = "name = 'account_state.json' and trashed = false";
      const response = await fetchWithAuth(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&spaces=appDataFolder&fields=files(id)`);
      const data = await response.json() as any;
      const fileId = data.files?.[0]?.id;
      if (fileId) {
        const res = await fetchWithAuth(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
        if (res.ok) {
          const state = await res.json() as AccountState;
          cloudAccountState.value = state;
          localStorage.setItem("google_account_state_cache", JSON.stringify(state));
          return state;
        }
      }
    } catch (e) {}
    return null;
  };

  const saveAccountState = async (state: AccountState) => {
    if (!accessToken.value || !isOnline.value) return false;
    try {
      const query = "name = 'account_state.json' and trashed = false";
      const check = await fetchWithAuth(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&spaces=appDataFolder&fields=files(id)`);
      const checkData = await check.json() as any;
      const existingId = checkData.files?.[0]?.id;

      const metadata = { name: "account_state.json", parents: existingId ? undefined : ["appDataFolder"] };
      const formData = new FormData();
      formData.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
      formData.append("file", new Blob([JSON.stringify(state)], { type: "application/json" }));

      const url = existingId 
        ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart`
        : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";

      const res = await fetchWithAuth(url, { method: existingId ? "PATCH" : "POST", body: formData });
      if (res.ok) {
        cloudAccountState.value = state;
        localStorage.setItem("google_account_state_cache", JSON.stringify(state));
        return true;
      }
    } catch (e) {}
    return false;
  };

  const pushDeltas = async (getMutations: () => Promise<any[]>, markSynced: (ids: number[]) => Promise<void>) => {
    if (!accessToken.value || !isOnline.value) return false;
    try {
      const mutations = await getMutations();
      if (mutations.length === 0) return true;
      
      loading.value = true;
      const folderId = await ensureDeltasFolder();
      const timestamp = Date.now();
      const fileName = `delta_${timestamp}_${deviceId.value}.json`;

      const payload = {
        deviceId: deviceId.value,
        timestamp,
        mutations: mutations.map(m => ({
          ...m,
          payload: typeof m.payload === "string" ? JSON.parse(m.payload) : m.payload
        }))
      };

      const metadata = { name: fileName, parents: folderId ? [folderId] : undefined };
      const formData = new FormData();
      formData.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
      formData.append("file", new Blob([JSON.stringify(payload)], { type: "application/json" }));

      const res = await fetchWithAuth("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
        method: "POST",
        body: formData
      });

      if (res.ok) {
        await markSynced(mutations.map(m => m.id));
        return true;
      }
      return false;
    } catch (e) {
      return false;
    } finally {
      loading.value = false;
    }
  };

  const pullDeltas = async (isProcessed: (id: string) => Promise<boolean>, markProcessed: (id: string) => Promise<void>, applyMutation: (m: any) => Promise<void>, refreshUI: () => Promise<void>) => {
    if (!accessToken.value || !isOnline.value) return false;
    
    // 🛡️ Bloqueo de Deltas si el Seguro de Vida está activo para evitar errores de Foreign Key (787)
    const hasRestored = localStorage.getItem("last_restore_completed") === "true";
    const hasCloudData = backups.value.length > 0;
    if (hasCloudData && !hasRestored) {
        console.warn("🛡️ [Drive] PULL-DELTAS BLOQUEADO: Debe restaurar el archivo principal primero.");
        return false;
    }

    try {
      loading.value = true;
      const folderId = await ensureDeltasFolder();
      if (!folderId) return false;

      const query = `'${folderId}' in parents and name contains 'delta_' and trashed = false`;
      const res = await fetchWithAuth(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id, name, modifiedTime)&orderBy=name asc`);
      const data = await res.json() as any;
      const files = data.files || [];

      files.sort((a: any, b: any) => {
        const getTs = (name: string) => {
          const parts = name.replace(".json", "").split("_");
          if (parts[1]?.length === 13 && /^\d+$/.test(parts[1])) return parseInt(parts[1]);
          if (parts[2] && /^\d+$/.test(parts[2])) return parseInt(parts[2]);
          return 0;
        };
        const tsA = getTs(a.name);
        const tsB = getTs(b.name);
        return tsA !== tsB ? tsA - tsB : new Date(a.modifiedTime).getTime() - new Date(b.modifiedTime).getTime();
      });

      let appliedAny = false;
      for (const file of files) {
        if (file.name.includes(`_${deviceId.value}.json`)) continue;
        if (await isProcessed(file.id)) continue;

        try {
          const contentRes = await fetchWithAuth(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`);
          if (contentRes.ok) {
            const delta = await contentRes.json() as any;
            for (const m of delta.mutations || []) {
              await applyMutation(m);
            }
            await markProcessed(file.id);
            appliedAny = true;
          }
        } catch (e) {
          console.error(`Error procesando delta ${file.name}:`, e);
        }
      }

      if (appliedAny) await refreshUI();
      return true;
    } catch (e) {
      return false;
    } finally {
      loading.value = false;
    }
  };

  return {
    user, loading, backups, login, signout, listBackups, uploadBackup, uploadFile, restoreBackup, deleteBackup,
    isAuthenticated: computed(() => !!accessToken.value),
    cloudAccountState, fetchAccountState, saveAccountState, resetLoading: () => (loading.value = false),
    hashString, isDirty, syncError, isOnline, isDatabaseCorrupted, pushDeltas, pullDeltas, fetchUserInfo,
    isBackupSafetyLockActive,
    deviceId: computed(() => deviceId.value),
  };
}
