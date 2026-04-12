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
        "https://www.googleapis.com/drive/v3/files?q=name contains 'pollos_backup_'&orderBy=createdTime desc&fields=files(id, name, createdTime, size)"
      );
      const data = await response.json() as any;
      backups.value = data.files || [];
    } catch (error) {
      console.error("List Backups Error:", error);
    } finally {
      loading.value = false;
    }
  };

  const uploadBackup = async (manual = true) => {
    try {
      loading.value = true;
      const dbPath = await invoke<string>("get_db_path");
      const dbContent = await readFile(dbPath);
      
      const now = new Date();
      const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 16);
      const fileName = `pollos_backup_${timestamp}.db`;

      const metadata = {
        name: fileName,
        mimeType: "application/octet-stream",
      };

      const formData = new FormData();
      formData.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
      formData.append("file", new Blob([dbContent], { type: "application/octet-stream" }));

      const response = await fetchWithAuth(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
        {
          method: "POST",
          body: formData,
        }
      );

      if (response.ok) {
        if (manual) {
          await message("Copia de seguridad subida con éxito a Google Drive.", {
            title: "Backup Exitoso",
            kind: "info",
          });
        }
        await listBackups();
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
