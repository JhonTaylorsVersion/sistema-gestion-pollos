use totp_rs::{Algorithm, TOTP, Secret};
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce
};
use rand::RngCore;

// CLAVE INTERNA DEL SISTEMA (32 Bytes para AES-256)
// NOTA: En un sistema real esta clave se derivaría de forma más compleja, 
// pero para cumplir tu requisito de "solo mi sistema lo lee", esto es perfecto.
const SYSTEM_KEY: &[u8; 32] = b"SISTEMA-POLLOS-JHON-SECRET-2026!";

#[tauri::command]
pub fn create_master_key_file(codes: Vec<String>) -> Result<Vec<u8>, String> {
    let json_data = serde_json::to_string(&codes)
        .map_err(|e| format!("Error al serializar códigos: {}", e))?;
    
    let key = Aes256Gcm::new_from_slice(SYSTEM_KEY).map_err(|e| e.to_string())?;
    
    // Generar un Nonce aleatorio de 12 bytes
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    
    // Encriptar los datos
    let ciphertext = key.encrypt(nonce, json_data.as_bytes())
        .map_err(|e| format!("Error de encriptación: {}", e))?;
    
    // Retornamos el nonce + el texto cifrado (para poder desencriptar después)
    let mut result = nonce_bytes.to_vec();
    result.extend(ciphertext);
    
    Ok(result)
}

#[tauri::command]
pub fn save_master_key_file(path: String, content: Vec<u8>) -> Result<(), String> {
    use std::fs::File;
    use std::io::Write;
    
    let mut file = File::create(path).map_err(|e| format!("No se pudo crear el archivo: {}", e))?;
    file.write_all(&content).map_err(|e| format!("Error al escribir datos: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn validate_master_key_file(file_content: Vec<u8>) -> Result<Vec<String>, String> {

    if file_content.len() < 12 {
        return Err("Archivo de llave inválido o corrupto".to_string());
    }
    
    let key = Aes256Gcm::new_from_slice(SYSTEM_KEY).map_err(|e| e.to_string())?;
    
    // Extraer el nonce (primeros 12 bytes) y el ciphertext
    let (nonce_bytes, ciphertext) = file_content.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);
    
    // Desencriptar
    let plaintext_bytes = key.decrypt(nonce, ciphertext)
        .map_err(|_| "La llave no pertenece a este sistema o ha sido modificada".to_string())?;
    
    let decrypted_codes: Vec<String> = serde_json::from_slice(&plaintext_bytes)
        .map_err(|_| "Error al leer la estructura de la llave".to_string())?;
    
    Ok(decrypted_codes)
}

#[tauri::command]
pub fn generate_2fa_setup() -> Result<(String, String), String> {

    // Generar un secreto seguro de forma gestionada por totp-rs
    let secret = Secret::generate_secret();
    
    let secret_bytes = secret.to_bytes()
        .map_err(|e| format!("Error en bytes del secreto: {:?}", e))?;

    let totp = TOTP::new(
        Algorithm::SHA1,
        6,
        1,
        30,
        secret_bytes,
        Some("SistemaGestionPollos".to_string()),
        "JhonSistemaGestion".to_string(),
    ).map_err(|e| format!("Error al crear TOTP: {:?}", e))?;

    // Obtener el código QR en Base64
    let qr_base64_raw = totp.get_qr_base64()
        .map_err(|e| format!("Error al generar QR Base64: {:?}", e))?;

    // Añadir el prefijo para que el navegador lo reconozca
    let qr_base64 = format!("data:image/png;base64,{}", qr_base64_raw);
    
    // Obtener el secreto en formato Base32
    let secret_base32 = totp.get_secret_base32();
    
    Ok((secret_base32, qr_base64))
}

#[tauri::command]
pub fn verify_2fa_code(secret_base32: String, code: String) -> Result<bool, String> {
    // Decodificar el secreto Base32
    let secret = Secret::Encoded(secret_base32)
        .to_bytes()
        .map_err(|e| format!("{:?}", e))?;

    let totp = TOTP::new(
        Algorithm::SHA1,
        6,
        1,
        30,
        secret,
        Some("SistemaGestionPollos".to_string()),
        "JhonSistemaGestion".to_string(),
    ).map_err(|e| format!("{:?}", e))?;

    // Verificar el código manejando el error de SystemTime
    Ok(totp.check_current(&code).map_err(|e| format!("{:?}", e))?)
}
