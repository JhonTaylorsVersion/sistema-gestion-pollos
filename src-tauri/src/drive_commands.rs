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

        let response_html = r##"
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>¡Vinculación Exitosa!</title>
            <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;700;800&display=swap" rel="stylesheet">
            <style>
                body {
                    margin: 0; padding: 0; display: flex; align-items: center; justify-content: center;
                    height: 100vh; background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
                    font-family: 'Plus Jakarta Sans', sans-serif; color: #1e293b;
                }
                .container {
                    background: white; padding: 50px 40px; border-radius: 32px;
                    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.08);
                    text-align: center; max-width: 420px; width: 90%;
                    animation: appear 0.5s ease-out;
                    border: 1px solid rgba(0, 0, 0, 0.03);
                }
                @keyframes appear { from { opacity: 0; transform: scale(0.9) translateY(20px); } to { opacity: 1; transform: scale(1) translateY(0); } }
                .checkmark {
                    font-size: 80px; margin-bottom: 20px; display: block;
                    animation: dropIcon 0.8s cubic-bezier(0.34, 1.56, 0.64, 1);
                }
                @keyframes dropIcon { from { transform: scale(0); } to { transform: scale(1); } }
                h1 { margin: 0 0 15px 0; font-size: 28px; font-weight: 800; color: #0f172a; letter-spacing: -0.02em; }
                p { margin: 0 0 35px 0; font-size: 16px; color: #64748b; line-height: 1.6; }
                .btn {
                    background: #2563eb; color: white; border: none; padding: 16px 32px;
                    border-radius: 16px; font-weight: 700; font-size: 16px; cursor: pointer;
                    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                    box-shadow: 0 10px 20px -5px rgba(37, 99, 235, 0.3);
                    text-decoration: none; display: inline-block;
                }
                .btn:hover { background: #1d4ed8; transform: translateY(-2px); box-shadow: 0 15px 25px -10px rgba(37, 99, 235, 0.4); }
                .btn:active { transform: scale(0.98); }
                .drive-logo { width: 44px; margin-top: 30px; opacity: 0.8; }
            </style>
        </head>
        <body>
            <div class="container">
                <span class="checkmark">✅</span>
                <h1>¡Conexión Exitosa!</h1>
                <p>Tu cuenta ha sido vinculada correctamente.<br>Haz clic debajo para volver al software.</p>
                
                <a href="pollosapp://login-success" class="btn" id="openAppBtn" onclick="handleClose()">Abrir la Aplicación</a>
                
                <p style="margin-top: 25px; font-size: 13px; opacity: 0.8; color: #64748b;">¿Te apareció un cuadro de confirmación arriba?<br>Dale en "Permitir" o "Abrir" para volver.</p>
                
                <div style="margin-top: 20px;">
                    <img class="drive-logo" src="https://www.gstatic.com/images/branding/product/2x/drive_2020q4_48dp.png" alt="Google Drive">
                </div>
            </div>
            <script>
                // Al cargar la página, intentamos cerrar automáticamente.
                window.onload = function() {
                    window.close();
                };
            </script>
        </body>
        </html>
        "##;
        let response = Response::from_string(response_html)
            .with_header(tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..]).unwrap());
        let _ = request.respond(response);

        // Enfocar todas las ventanas de la aplicación y forzarlas al frente
        for window in _app.webview_windows().values() {
            let _ = window.unminimize();
            let _ = window.set_focus();
            let _ = window.set_always_on_top(true);
            let _ = window.set_always_on_top(false);
        }

        return code.ok_or_else(|| "No se encontró el código de autorización".to_string());
    }

    Err("Servidor detenido inesperadamente".to_string())
}

#[tauri::command]
pub fn restart_app<R: Runtime>(app: AppHandle<R>) {
    app.restart();
}
