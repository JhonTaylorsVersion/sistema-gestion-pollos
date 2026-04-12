import { ref, onMounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { ask, message } from "@tauri-apps/plugin-dialog";
import { fetch } from "@tauri-apps/plugin-http";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { openUrl } from "@tauri-apps/plugin-opener";

export interface GoogleUser {
  name: string;
  email: string;
  picture: string;
}

export interface DriveFile {
  id: string;
  name: string;
  createdTime: string;
  size: string;
}

const CLIENT_ID = "REDACTED_CLIENT_ID";
const CLIENT_SECRET = "REDACTED_CLIENT_SECRET";
const REDIRECT_URI = "http://127.0.0.1:14210";
const SCOPES = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email";

const user = ref<GoogleUser | null>(null);
const loading = ref(false);
const backups = ref<DriveFile[]>([]);
const accessToken = ref<string | null>(localStorage.getItem("google_access_token"));
const refreshToken = ref<string | null>(localStorage.getItem("google_refresh_token"));

const lastAutoUploadTime = ref<number>(0);
const dailyFileId = ref<string | null>(null);

export function useDrive() {


  const login = async () => {
    try {
      loading.value = true;
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=code&scope=${SCOPES}&access_type=offline&prompt=consent`;

      // Lanzar el navegador desde el frontend
      await openUrl(authUrl);

      const code = await invoke<string>("start_oauth_server", { authUrlBase: authUrl });
      
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

      const data = await response.json() as any;

      if (data.access_token) {
        setTokens(data.access_token, data.refresh_token);
        await fetchUserInfo();
      }
    } catch (error) {
      console.error("Login Error:", error);
      await message("Error al iniciar sesión con Google. Por favor, verifica tu conexión o intenta de nuevo.", {
        title: "Error de Conexión",
        kind: "error",
      });
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
      const data = await response.json() as any;
      if (data.access_token) {
        setTokens(data.access_token, data.refresh_token || refreshToken.value as string);
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
      const response = await fetchWithAuth("https://www.googleapis.com/oauth2/v3/userinfo");
      const data = await response.json() as any;
      console.log("Respuesta Completa de Google UserInfo:", data);
      
      user.value = {
        name: data.name || "Usuario",
        email: data.email || "Sin correo",
        picture: data.picture || ""
      };
      
      console.log("Perfil Procesado:", user.value);
    } catch (error) {
      console.error("User Info Error:", error);
    }
  };

  const listBackups = async () => {
    try {
      loading.value = true;
      const response = await fetchWithAuth(
        "https://www.googleapis.com/drive/v3/files?q=name contains 'pollos_backup_' and trashed = false&orderBy=createdTime desc&fields=files(id, name, createdTime, size)"
      );
      const data = await response.json() as any;
      backups.value = data.files || [];
    } catch (error) {
      console.error("List Backups Error:", error);
    } finally {
      loading.value = false;
    }
  };

  const findTodayBackup = async (fileName: string) => {
    if (dailyFileId.value) return dailyFileId.value;

    try {
      const query = `name = '${fileName}' and trashed = false`;
      const response = await fetchWithAuth(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id)`
      );
      const data = await response.json() as any;
      if (data.files && data.files.length > 0) {
        dailyFileId.value = data.files[0].id;
        return dailyFileId.value;
      }
    } catch (e) {
      console.error("Error buscando backup de hoy:", e);
    }
    return null;
  };

  const uploadBackup = async (manual = true, force = false) => {
    if (!accessToken.value) return;

    // Cooldown para automáticos (5 minutos = 300000 ms)
    const now = Date.now();
    if (!manual && !force && (now - lastAutoUploadTime.value < 300000)) {
       console.log("☁️ Sincronización omitida (cooldown de 5 min activo)");
       return;
    }

    try {
      loading.value = true;
      const dbPath = await invoke<string>("get_db_path");
      const dbContent = await readFile(dbPath);
      
      const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const fileName = `pollos_backup_${dateStr}.db`;

      const existingId = await findTodayBackup(fileName);

      let response;

      if (existingId) {
        // ACTUALIZAR (PATCH)
        console.log(`☁️ Actualizando backup de hoy ID: ${existingId}`);
        response = await fetchWithAuth(
          `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=media`,
          {
            method: "PATCH",
            body: dbContent,
          }
        );
      } else {
        // CREAR (POST Multipart)
        console.log(`☁️ Creando nuevo backup diario: ${fileName}`);
        const metadata = {
          name: fileName,
          mimeType: "application/octet-stream",
        };

        const formData = new FormData();
        formData.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
        formData.append("file", new Blob([dbContent], { type: "application/octet-stream" }));

        response = await fetchWithAuth(
          "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
          {
            method: "POST",
            body: formData,
          }
        );

        const data = await response.json() as any;
        if (data.id) dailyFileId.value = data.id;
      }

      if (response.ok) {
        lastAutoUploadTime.value = Date.now();
        if (manual) {
          await message(`Copia de seguridad ${existingId ? 'actualizada' : 'subida'} con éxito a Google Drive.`, {
            title: "Backup Exitoso",
            kind: "info",
          });
        }
        await listBackups();
        return true;
      } else {
        throw new Error("Fallo en la comunicación con Google Drive.");
      }
    } catch (error) {
      console.error("Upload Error:", error);
      if (manual) {
        const msg = typeof error === 'string' ? error : (error as Error).message;
        await message(`Error al subir copia de seguridad: ${msg}`, {
          title: "Error de Subida",
          kind: "error",
        });
      }
      return false;
    } finally {
      loading.value = false;
    }
  };



  const restoreBackup = async (fileId: string) => {
    try {
      const confirmed = await ask("¿Estás seguro? Se reemplazarán todos los datos actuales y la app se reiniciará.", {
        title: "Confirmar Restauración",
        kind: "warning",
      });

      if (!confirmed) return;
      
      loading.value = true;
      const response = await fetchWithAuth(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
        { responseType: 1 } // Binary
      );
      
      const content = await response.arrayBuffer();
      const dbPath = await invoke<string>("get_db_path");
      
      await writeFile(dbPath, new Uint8Array(content));
      
      await message("La base de datos se ha restaurado con éxito. La aplicación se reiniciará ahora para aplicar los cambios.", {
        title: "Restauración Completada",
        kind: "info",
      });

      await invoke("restart_app");
    } catch (error) {
      console.error("Restore Error:", error);
      const msg = typeof error === 'string' ? error : (error as Error).message;
      await message(`Error al restaurar: ${msg}\n\nEs posible que la base de datos esté bloqueada por el programa. Intenta cerrar otras ventanas o reinicia la app.`, {
        title: "Error de Restauración",
        kind: "error",
      });
    } finally {
      loading.value = false;
    }
  };

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
    restoreBackup,
    isAuthenticated: accessToken,
  };
}
