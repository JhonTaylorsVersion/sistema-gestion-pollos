use tauri::{AppHandle, Manager, Runtime};
use tiny_http::{Server, Response};
use url::Url;

#[tauri::command]
pub async fn get_db_path<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_path = app_data_dir.join("pollos.db");
    Ok(db_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn start_oauth_server<R: Runtime>(
    _app: AppHandle<R>,
    _auth_url_base: String,
) -> Result<String, String> {
    let server = Server::http("127.0.0.1:14210").map_err(|e| e.to_string())?;
    
    // El servidor se queda esperando; el frontend lanzará la URL

    // Wait for the redirect
    if let Some(request) = server.incoming_requests().next() {
        let url = format!("http://127.0.0.1:14210{}", request.url());
        let parsed_url = Url::parse(&url).map_err(|e| e.to_string())?;
        
        let code = parsed_url.query_pairs()
            .find(|(key, _)| key == "code")
            .map(|(_, value)| value.to_string());

        let response = Response::from_string("¡Listo! Puedes cerrar esta ventana y volver a la aplicación.")
            .with_header(tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/plain; charset=utf-8"[..]).unwrap());
        let _ = request.respond(response);

        return code.ok_or_else(|| "No se encontró el código de autorización".to_string());
    }

    Err("Servidor detenido inesperadamente".to_string())
}

#[tauri::command]
pub fn restart_app<R: Runtime>(app: AppHandle<R>) {
    app.restart();
}
