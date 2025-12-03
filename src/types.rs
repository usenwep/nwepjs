use napi_derive::napi;

/// Congestion control algorithms
#[napi]
pub enum CongestionControlAlgorithm {
    /// Reno congestion control
    Reno,
    /// CUBIC congestion control (default)
    Cubic,
    /// BBR congestion control
    Bbr,
}

/// QUIC protocol version constant
#[napi]
pub const PROTOCOL_VERSION: u32 = quiche::PROTOCOL_VERSION;

/// Maximum connection ID length
#[napi]
pub const MAX_CONN_ID_LEN: u32 = quiche::MAX_CONN_ID_LEN as u32;

/// Minimum client initial packet length
#[napi]
pub const MIN_CLIENT_INITIAL_LEN: u32 = 1200;
