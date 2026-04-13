use tauri_plugin_sql::Builder as SqlBuilder;

mod drive_commands;
mod auth_commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
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
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_http::init())
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}