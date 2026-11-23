use crate::fs_utils::{atomic_write, resolve_safe_vault_path};
use anyhow::{anyhow, Context, Result};
use std::fs;
use std::path::Path;

/// Maximum decoded binary payload allowed for a single vault asset (15 MiB).
pub const MAX_ASSET_BYTES: usize = 15 * 1024 * 1024;

const BASE64_TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Encodes arbitrary bytes into standard Base64 with `=` padding.
pub fn encode_base64(input: &[u8]) -> String {
    if input.is_empty() {
        return String::new();
    }
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    let mut chunks = input.chunks_exact(3);
    for chunk in &mut chunks {
        let n = ((chunk[0] as u32) << 16) | ((chunk[1] as u32) << 8) | (chunk[2] as u32);
        out.push(BASE64_TABLE[((n >> 18) & 0x3F) as usize] as char);
        out.push(BASE64_TABLE[((n >> 12) & 0x3F) as usize] as char);
        out.push(BASE64_TABLE[((n >> 6) & 0x3F) as usize] as char);
        out.push(BASE64_TABLE[(n & 0x3F) as usize] as char);
    }
    let rem = chunks.remainder();
    match rem.len() {
        1 => {
            let n = (rem[0] as u32) << 16;
            out.push(BASE64_TABLE[((n >> 18) & 0x3F) as usize] as char);
            out.push(BASE64_TABLE[((n >> 12) & 0x3F) as usize] as char);
            out.push('=');
            out.push('=');
        }
        2 => {
            let n = ((rem[0] as u32) << 16) | ((rem[1] as u32) << 8);
            out.push(BASE64_TABLE[((n >> 18) & 0x3F) as usize] as char);
            out.push(BASE64_TABLE[((n >> 12) & 0x3F) as usize] as char);
            out.push(BASE64_TABLE[((n >> 6) & 0x3F) as usize] as char);
            out.push('=');
        }
        _ => {}
    }
    out
}

#[inline]
fn decode_base64_char(b: u8) -> Option<u8> {
    match b {
        b'A'..=b'Z' => Some(b - b'A'),
        b'a'..=b'z' => Some(b - b'a' + 26),
        b'0'..=b'9' => Some(b - b'0' + 52),
        b'+' | b'-' => Some(62),
        b'/' | b'_' => Some(63),
        _ => None,
    }
}

/// Decodes a Base64 string into raw bytes, ignoring ASCII whitespace and handling `=` padding cleanly.
pub fn decode_base64(input: &str) -> Result<Vec<u8>> {
    let cleaned: Vec<u8> = input
        .bytes()
        .filter(|b| !b.is_ascii_whitespace())
        .collect();
    if cleaned.is_empty() {
        return Ok(Vec::new());
    }

    let first_pad = cleaned.iter().position(|&b| b == b'=');
    let (data_bytes, pad_len) = match first_pad {
        Some(pos) => {
            if !cleaned[pos..].iter().all(|&b| b == b'=') {
                return Err(anyhow!("Ungültiges Base64-Padding innerhalb der Daten"));
            }
            let pad_count = cleaned.len() - pos;
            if pad_count > 2 || cleaned.len() % 4 != 0 {
                return Err(anyhow!("Ungültige Base64-Padding-Länge"));
            }
            (&cleaned[..pos], pad_count)
        }
        None => (&cleaned[..], 0usize),
    };

    if data_bytes.len() % 4 == 1 {
        return Err(anyhow!("Ungültige Base64-Länge"));
    }
    if pad_len == 1 && data_bytes.len() % 4 != 3 {
        return Err(anyhow!("Ungültiges Base64-Padding"));
    }
    if pad_len == 2 && data_bytes.len() % 4 != 2 {
        return Err(anyhow!("Ungültiges Base64-Padding"));
    }

    let mut out = Vec::with_capacity((data_bytes.len() * 3) / 4);
    let mut chunks = data_bytes.chunks_exact(4);
    for chunk in &mut chunks {
        let a = decode_base64_char(chunk[0])
            .ok_or_else(|| anyhow!("Ungültiges Base64-Zeichen: 0x{:02x}", chunk[0]))?;
        let b = decode_base64_char(chunk[1])
            .ok_or_else(|| anyhow!("Ungültiges Base64-Zeichen: 0x{:02x}", chunk[1]))?;
        let c = decode_base64_char(chunk[2])
            .ok_or_else(|| anyhow!("Ungültiges Base64-Zeichen: 0x{:02x}", chunk[2]))?;
        let d = decode_base64_char(chunk[3])
            .ok_or_else(|| anyhow!("Ungültiges Base64-Zeichen: 0x{:02x}", chunk[3]))?;

        let n = ((a as u32) << 18) | ((b as u32) << 12) | ((c as u32) << 6) | (d as u32);
        out.push(((n >> 16) & 0xFF) as u8);
        out.push(((n >> 8) & 0xFF) as u8);
        out.push((n & 0xFF) as u8);
    }

    let rem = chunks.remainder();
    match rem.len() {
        0 => {}
        2 => {
            let a = decode_base64_char(rem[0])
                .ok_or_else(|| anyhow!("Ungültiges Base64-Zeichen: 0x{:02x}", rem[0]))?;
            let b = decode_base64_char(rem[1])
                .ok_or_else(|| anyhow!("Ungültiges Base64-Zeichen: 0x{:02x}", rem[1]))?;
            let n = ((a as u32) << 18) | ((b as u32) << 12);
            out.push(((n >> 16) & 0xFF) as u8);
        }
        3 => {
            let a = decode_base64_char(rem[0])
                .ok_or_else(|| anyhow!("Ungültiges Base64-Zeichen: 0x{:02x}", rem[0]))?;
            let b = decode_base64_char(rem[1])
                .ok_or_else(|| anyhow!("Ungültiges Base64-Zeichen: 0x{:02x}", rem[1]))?;
            let c = decode_base64_char(rem[2])
                .ok_or_else(|| anyhow!("Ungültiges Base64-Zeichen: 0x{:02x}", rem[2]))?;
            let n = ((a as u32) << 18) | ((b as u32) << 12) | ((c as u32) << 6);
            out.push(((n >> 16) & 0xFF) as u8);
            out.push(((n >> 8) & 0xFF) as u8);
        }
        _ => unreachable!(),
    }

    Ok(out)
}

fn sanitize_asset_filename(filename: &str) -> Result<String> {
    let trimmed = filename.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("Asset-Dateiname darf nicht leer sein"));
    }

    // Use only the final path segment if a directory prefix was supplied
    let basename = trimmed.rsplit(['/', '\\']).next().unwrap_or("");
    if basename.is_empty() || basename == "." || basename == ".." {
        return Err(anyhow!("Ungültiger Asset-Dateiname: {}", filename));
    }

    let mut sanitized = String::with_capacity(basename.len());
    let mut prev_dot = false;
    for ch in basename.chars() {
        if ch.is_alphanumeric() || matches!(ch, '-' | '_') {
            sanitized.push(ch);
            prev_dot = false;
        } else if ch == '.' {
            if !prev_dot {
                sanitized.push('.');
                prev_dot = true;
            }
        } else if ch.is_whitespace() {
            sanitized.push('-');
            prev_dot = false;
        }
    }

    let cleaned = sanitized.trim_matches('.').trim_matches('-').to_string();
    if cleaned.is_empty() || !cleaned.chars().any(|c| c.is_alphanumeric()) {
        return Err(anyhow!("Ungültiger Asset-Dateiname: {}", filename));
    }

    Ok(cleaned)
}

fn split_stem_and_ext(filename: &str) -> (&str, Option<&str>) {
    match filename.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() && !ext.is_empty() => (stem, Some(ext)),
        _ => (filename, None),
    }
}

fn detect_mime_type(rel_path: &str) -> &'static str {
    let ext = Path::new(rel_path)
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase());
    match ext.as_deref() {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("pdf") => "application/pdf",
        _ => "application/octet-stream",
    }
}

/// Saves a Base64-encoded binary asset safely into `assets/<final_name>` inside `vault_path`.
/// Strips optional `data:...;base64,` prefixes, enforces a 15 MiB decoded size cap, avoids
/// overwriting different existing assets by appending a short hash/counter suffix, and returns
/// the vault-relative `"assets/<final_name>"` path.
pub fn save_asset(vault_path: &Path, filename: &str, base64_data: &str) -> Result<String> {
    let safe_name = sanitize_asset_filename(filename)?;

    let trimmed_data = base64_data.trim();
    let payload_b64 = if let Some(rest) = trimmed_data.strip_prefix("data:") {
        let (_, encoded) = rest
            .split_once(";base64,")
            .ok_or_else(|| anyhow!("Ungültige Data-URL: ';base64,' Trennzeichen fehlt"))?;
        encoded
    } else {
        trimmed_data
    };

    // Fast upper-bound rejection before full decoding
    let non_ws_len = payload_b64
        .bytes()
        .filter(|b| !b.is_ascii_whitespace())
        .count();
    let max_b64_chars = (MAX_ASSET_BYTES.div_ceil(3)) * 4 + 4;
    if non_ws_len > max_b64_chars {
        return Err(anyhow!(
            "Asset überschreitet maximale Größe von {} Bytes",
            MAX_ASSET_BYTES
        ));
    }

    let bytes = decode_base64(payload_b64)?;
    if bytes.len() > MAX_ASSET_BYTES {
        return Err(anyhow!(
            "Asset überschreitet maximale Größe von {} Bytes ({} Bytes)",
            MAX_ASSET_BYTES,
            bytes.len()
        ));
    }

    let (base_rel, base_abs) =
        resolve_safe_vault_path(vault_path, &format!("assets/{}", safe_name))?;
    if !base_rel.starts_with("assets/") {
        return Err(anyhow!("Ungültiger Zielpfad für Asset: {}", base_rel));
    }

    let (final_rel, final_abs) = if !base_abs.exists() {
        (base_rel, base_abs)
    } else {
        let existing = fs::read(&base_abs)
            .with_context(|| format!("Konnte bestehendes Asset {} nicht lesen", base_abs.display()))?;
        if existing == bytes {
            return Ok(base_rel);
        }

        let hash_suffix = &blake3::hash(&bytes).to_hex()[..8];
        let (stem, ext) = split_stem_and_ext(&safe_name);
        let hashed_name = match ext {
            Some(e) => format!("{}-{}.{}", stem, hash_suffix, e),
            None => format!("{}-{}", stem, hash_suffix),
        };
        let (hashed_rel, hashed_abs) =
            resolve_safe_vault_path(vault_path, &format!("assets/{}", hashed_name))?;
        if !hashed_abs.exists() {
            (hashed_rel, hashed_abs)
        } else if fs::read(&hashed_abs).map(|b| b == bytes).unwrap_or(false) {
            return Ok(hashed_rel);
        } else {
            let mut counter = 1usize;
            loop {
                let candidate_name = match ext {
                    Some(e) => format!("{}-{}-{}.{}", stem, hash_suffix, counter, e),
                    None => format!("{}-{}-{}", stem, hash_suffix, counter),
                };
                let (cand_rel, cand_abs) =
                    resolve_safe_vault_path(vault_path, &format!("assets/{}", candidate_name))?;
                if !cand_abs.exists() {
                    break (cand_rel, cand_abs);
                }
                counter += 1;
            }
        }
    };

    atomic_write(&final_abs, &bytes)?;
    Ok(final_rel)
}

/// Reads a vault asset under `assets/` and returns it as a `data:<mime>;base64,...` URL.
pub fn read_asset_data_url(vault_path: &Path, rel_path: &str) -> Result<String> {
    let (clean_rel, abs_path) = resolve_safe_vault_path(vault_path, rel_path)?;
    if !clean_rel.starts_with("assets/") {
        return Err(anyhow!(
            "Asset-Pfad muss innerhalb von 'assets/' liegen: {}",
            rel_path
        ));
    }
    let bytes = fs::read(&abs_path)
        .with_context(|| format!("Asset nicht gefunden: {}", clean_rel))?;
    let mime = detect_mime_type(&clean_rel);
    Ok(format!("data:{};base64,{}", mime, encode_base64(&bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn base64_roundtrips_all_padding_cases_and_whitespace() {
        let cases: &[&[u8]] = &[
            b"",
            b"f",
            b"fo",
            b"foo",
            b"foob",
            b"fooba",
            b"foobar",
            &[0x00, 0xFF, 0x10, 0x89, 0xAB, 0xCD, 0xEF],
        ];
        for &raw in cases {
            let enc = encode_base64(raw);
            let dec = decode_base64(&enc).unwrap();
            assert_eq!(dec, raw);
        }

        // Handles embedded whitespace and line breaks
        let with_ws = "  Zm9v\r\n  YmFy\t ";
        assert_eq!(decode_base64(with_ws).unwrap(), b"foobar");

        // Handles unpadded valid base64
        assert_eq!(decode_base64("Zg").unwrap(), b"f");
        assert_eq!(decode_base64("Zm8").unwrap(), b"fo");

        // Rejects invalid base64
        assert!(decode_base64("A").is_err());
        assert!(decode_base64("Zm=v").is_err());
        assert!(decode_base64("Zm9!").is_err());
        assert!(decode_base64("Zg===").is_err());
    }

    #[test]
    fn save_and_read_asset_data_url_with_mime_detection_and_collision_handling() {
        let dir = tempdir().unwrap();
        let vault = dir.path();

        let png_bytes = b"\x89PNG\r\n\x1a\nfake-png-payload";
        let data_url_input = format!("data:image/png;base64,{}", encode_base64(png_bytes));

        let rel1 = save_asset(vault, "My Diagram (1).png", &data_url_input).unwrap();
        assert_eq!(rel1, "assets/My-Diagram-1.png");
        assert_eq!(fs::read(vault.join(&rel1)).unwrap(), png_bytes);

        // Identical payload reuses existing file without creating duplicate
        let rel1_dup = save_asset(vault, "My Diagram (1).png", &encode_base64(png_bytes)).unwrap();
        assert_eq!(rel1_dup, rel1);

        // Different payload with same name gets a unique hash suffix
        let other_bytes = b"\x89PNG\r\n\x1a\ndifferent-png-payload";
        let rel2 = save_asset(vault, "My Diagram (1).png", &encode_base64(other_bytes)).unwrap();
        assert_ne!(rel2, rel1);
        assert!(rel2.starts_with("assets/My-Diagram-1-"));
        assert!(rel2.ends_with(".png"));
        assert_eq!(fs::read(vault.join(&rel2)).unwrap(), other_bytes);
        // Original asset remains intact
        assert_eq!(fs::read(vault.join(&rel1)).unwrap(), png_bytes);

        // Read back as data URL
        let read_url = read_asset_data_url(vault, &rel1).unwrap();
        assert_eq!(read_url, data_url_input);

        // Check SVG, PDF, and fallback MIME types
        let svg_rel = save_asset(vault, "icon.SVG", &encode_base64(b"<svg/>")).unwrap();
        assert!(read_asset_data_url(vault, &svg_rel)
            .unwrap()
            .starts_with("data:image/svg+xml;base64,"));

        let pdf_rel = save_asset(vault, "spec.pdf", &encode_base64(b"%PDF-1.4")).unwrap();
        assert!(read_asset_data_url(vault, &pdf_rel)
            .unwrap()
            .starts_with("data:application/pdf;base64,"));

        let bin_rel = save_asset(vault, "archive.bin", &encode_base64(b"1234")).unwrap();
        assert!(read_asset_data_url(vault, &bin_rel)
            .unwrap()
            .starts_with("data:application/octet-stream;base64,"));
    }

    #[test]
    fn enforces_filename_validation_path_safety_and_size_limit() {
        let dir = tempdir().unwrap();
        let vault = dir.path();

        assert!(save_asset(vault, "", "Zg==").is_err());
        assert!(save_asset(vault, "   ", "Zg==").is_err());
        assert!(save_asset(vault, "..", "Zg==").is_err());
        assert!(save_asset(vault, "...", "Zg==").is_err());
        assert!(save_asset(vault, "///", "Zg==").is_err());
        assert!(save_asset(vault, "---", "Zg==").is_err());

        // Path traversal in read_asset_data_url is blocked
        atomic_write(&vault.join("Secret.md"), "# Secret\n").unwrap();
        assert!(read_asset_data_url(vault, "Secret.md").is_err());
        assert!(read_asset_data_url(vault, "assets/../Secret.md").is_err());
        assert!(read_asset_data_url(vault, "../outside.png").is_err());

        // Payload exceeding 15 MiB is rejected
        let oversized = vec![0u8; MAX_ASSET_BYTES + 1];
        let oversized_b64 = encode_base64(&oversized);
        assert!(save_asset(vault, "huge.png", &oversized_b64).is_err());
    }
}
