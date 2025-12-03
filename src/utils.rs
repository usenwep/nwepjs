use napi::bindgen_prelude::*;
use napi_derive::napi;

use crate::error::NapiResult;

/// Generate random connection ID
///
/// @param len - Length in bytes (1-20)
/// @returns Buffer containing random bytes
#[napi]
pub fn generate_cid(len: u32) -> NapiResult<Buffer> {
    use ring::rand::{SecureRandom, SystemRandom};

    if len == 0 || len > quiche::MAX_CONN_ID_LEN as u32 {
        return Err(Error::new(
            Status::InvalidArg,
            format!("Length must be 1-{}", quiche::MAX_CONN_ID_LEN),
        ));
    }

    let mut buf = vec![0u8; len as usize];
    let rng = SystemRandom::new();

    rng.fill(&mut buf).map_err(|_| {
        Error::new(Status::GenericFailure, "Failed to generate random bytes")
    })?;

    Ok(Buffer::from(buf))
}

/// Encode ALPN protocols into wire format
///
/// @param protocols - Array of protocol strings (e.g., ["h3", "http/1.1"])
/// @returns Buffer with length-prefixed protocols
#[napi]
pub fn encode_alpn(protocols: Vec<String>) -> NapiResult<Buffer> {
    let mut encoded = Vec::new();

    for proto in protocols {
        let bytes = proto.as_bytes();
        if bytes.len() > 255 {
            return Err(Error::new(
                Status::InvalidArg,
                "Protocol name too long (max 255 bytes)",
            ));
        }
        encoded.push(bytes.len() as u8);
        encoded.extend_from_slice(bytes);
    }

    Ok(Buffer::from(encoded))
}

/// Get ALPN for NWEP/1 protocol
///
/// @returns Buffer with NWEP ALPN (\x06nwep/1)
#[napi]
pub fn nwep_alpn() -> Buffer {
    // Encoded as: length-byte (6) + "nwep/1"
    Buffer::from(b"\x06nwep/1".to_vec())
}

/// Get ALPN for both NWEP/1 and HTTP/3
///
/// @returns Buffer with both NWEP and H3 ALPN
#[napi]
pub fn nwep_and_h3_alpn() -> Buffer {
    // Encoded as: \x06nwep/1\x02h3
    Buffer::from(b"\x06nwep/1\x02h3".to_vec())
}
