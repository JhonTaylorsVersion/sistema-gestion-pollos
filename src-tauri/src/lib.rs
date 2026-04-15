use tauri::Manager;
use tauri_plugin_sql::Builder as SqlBuilder;

mod drive_commands;
mod auth_commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      // 🛡️ [BOOTSTRAPPER] Sistema de Restauración Atómica
      // Verificamos si hay una restauración pendiente antes de que cualquier plugin use la BD
      let app_data_dir = app.path().app_data_dir().unwrap_or_default();
      let db_path = app_data_dir.join("pollos.db");
      let pending_path = app_data_dir.join("pollos.db.pending");

      if pending_path.exists() {
        println!("🚀 [Bootstrapper] Detectada restauración pendiente. Procesando...");
        
        // 1. Eliminar archivos auxiliares antiguos (WAL/SHM/JOURNAL) que causan 'database malformed'
        let aux_files = vec!["-wal", "-shm", "-journal"];
        for ext in aux_files {
          let aux_path = app_data_dir.join(format!("pollos.db{}", ext));
          if aux_path.exists() {
            let _ = std::fs::remove_file(aux_path);
          }
        }

        // 2. Reemplazar la base de datos principal
        if let Err(e) = std::fs::rename(&pending_path, &db_path) {
          eprintln!("❌ [Bootstrapper] Error al renombrar BD pendiente: {}", e);
          // Si el rename falla (ej: a través de particiones), intentamos copia y borrado
          let _ = std::fs::copy(&pending_path, &db_path);
          let _ = std::fs::remove_file(pending_path);
        }
        println!("✅ [Bootstrapper] Restauración aplicada con éxito.");
      }

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      drive_commands::get_db_path,
      drive_commands::start_oauth_server,
      drive_commands::restart_app,
      auth_commands::generate_2fa_setup,
      auth_commands::verify_2fa_code,
      auth_commands::create_master_key_file,
      auth_commands::validate_master_key_file,
      auth_commands::save_master_key_file,
    ])


    .plugin(SqlBuilder::default().build())
    .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
    .plugin(tauri_plugin_deep_link::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_http::init())
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}