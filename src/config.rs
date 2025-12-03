use napi::bindgen_prelude::*;
use napi_derive::napi;
use quiche;
// use std::fs::File; // this was unused

use crate::error::{to_napi_error, NapiResult};
use crate::types::CongestionControlAlgorithm;

/// QUIC configuration
///
/// This class holds configuration parameters that are shared across multiple
/// QUIC connections. It manages TLS certificates, transport parameters, and
/// protocol settings.
#[napi]
pub struct Config {
    // Store directly, not Arc - allows mutation via &mut self
    inner: quiche::Config,
}

#[napi]
impl Config {
    /// Create a new Config with the specified QUIC version
    ///
    /// @param version - QUIC version (use PROTOCOL_VERSION constant)
    #[napi(constructor)]
    pub fn new(version: u32) -> Self {
        // Unwrap is safe here because PROTOCOL_VERSION is always valid
        let config = quiche::Config::new(version)
            .expect("Failed to create QUIC config");

        Self { inner: config }
    }

    /// Load certificate chain from PEM file
    ///
    /// @param path - Path to PEM file containing certificate chain
    #[napi]
    pub fn load_cert_chain_from_pem_file(&mut self, path: String) -> NapiResult<()> {
        self.inner
            .load_cert_chain_from_pem_file(&path)
            .map_err(to_napi_error)
    }

    /// Load private key from PEM file
    ///
    /// @param path - Path to PEM file containing private key
    #[napi]
    pub fn load_priv_key_from_pem_file(&mut self, path: String) -> NapiResult<()> {
        self.inner
            .load_priv_key_from_pem_file(&path)
            .map_err(to_napi_error)
    }

    /// Set whether to verify peer's certificate
    ///
    /// @param verify - true to verify peer certificate (default: true)
    #[napi]
    pub fn verify_peer(&mut self, verify: bool) {
        self.inner.verify_peer(verify);
    }

    /// Set application protocols (ALPN)
    ///
    /// @param protos - Buffer containing protocol identifiers
    ///                 Format: length-prefixed strings (e.g., "\x02h3\x08http/1.1")
    ///                 Use encodeAlpn() helper to create this from string array
    #[napi]
    pub fn set_application_protos(&mut self, protos: Buffer) -> NapiResult<()> {
        self.inner
            .set_application_protos_wire_format(protos.as_ref())
            .map_err(to_napi_error)
    }

    /// Set max idle timeout in milliseconds
    ///
    /// @param timeout - Idle timeout in milliseconds (0 = no timeout)
    #[napi]
    pub fn set_max_idle_timeout(&mut self, timeout: f64) {
        self.inner.set_max_idle_timeout(timeout as u64);
    }

    /// Set initial maximum data (connection-level flow control)
    ///
    /// @param bytes - Maximum bytes that can be received on the connection
    #[napi]
    pub fn set_initial_max_data(&mut self, bytes: f64) {
        self.inner.set_initial_max_data(bytes as u64);
    }

    /// Set initial maximum stream data for locally-initiated bidirectional streams
    ///
    /// @param bytes - Maximum bytes per stream
    #[napi]
    pub fn set_initial_max_stream_data_bidi_local(&mut self, bytes: f64) {
        self.inner.set_initial_max_stream_data_bidi_local(bytes as u64);
    }

    /// Set initial maximum stream data for remotely-initiated bidirectional streams
    ///
    /// @param bytes - Maximum bytes per stream
    #[napi]
    pub fn set_initial_max_stream_data_bidi_remote(&mut self, bytes: f64) {
        self.inner.set_initial_max_stream_data_bidi_remote(bytes as u64);
    }

    /// Set initial maximum stream data for unidirectional streams
    ///
    /// @param bytes - Maximum bytes per stream
    #[napi]
    pub fn set_initial_max_stream_data_uni(&mut self, bytes: f64) {
        self.inner.set_initial_max_stream_data_uni(bytes as u64);
    }

    /// Set initial maximum number of bidirectional streams
    ///
    /// @param count - Maximum concurrent bidirectional streams
    #[napi]
    pub fn set_initial_max_streams_bidi(&mut self, count: f64) {
        self.inner.set_initial_max_streams_bidi(count as u64);
    }

    /// Set initial maximum number of unidirectional streams
    ///
    /// @param count - Maximum concurrent unidirectional streams
    #[napi]
    pub fn set_initial_max_streams_uni(&mut self, count: f64) {
        self.inner.set_initial_max_streams_uni(count as u64);
    }

    /// Set congestion control algorithm
    ///
    /// @param algo - Algorithm to use (Reno, Cubic, or Bbr)
    #[napi]
    pub fn set_cc_algorithm(&mut self, algo: CongestionControlAlgorithm) {
        let cc_algo = match algo {
            CongestionControlAlgorithm::Reno => quiche::CongestionControlAlgorithm::Reno,
            CongestionControlAlgorithm::Cubic => quiche::CongestionControlAlgorithm::CUBIC,
            CongestionControlAlgorithm::Bbr => quiche::CongestionControlAlgorithm::BBR,
        };

        self.inner.set_cc_algorithm(cc_algo);
    }

    /// Enable early data (0-RTT)
    ///
    /// Allows the client to send application data in the first flight,
    /// reducing connection establishment latency for resumed connections.
    #[napi]
    pub fn enable_early_data(&mut self) {
        self.inner.enable_early_data();
    }

    /// Set the initial RTT (Round Trip Time) estimate
    ///
    /// @param rtt_ms - RTT in milliseconds
    #[napi]
    pub fn set_initial_rtt(&mut self, rtt_ms: u32) {
        let duration = std::time::Duration::from_millis(rtt_ms as u64);
        self.inner.set_initial_rtt(duration);
    }

    /// Enable HyStart++ for congestion control
    ///
    /// HyStart++ improves slow start exit detection, reducing unnecessary packet loss.
    #[napi]
    pub fn enable_hystart(&mut self, enabled: bool) {
        self.inner.enable_hystart(enabled);
    }

    /// Enable packet pacing
    ///
    /// Pacing spreads packet transmissions over time to reduce burstiness.
    #[napi]
    pub fn enable_pacing(&mut self, enabled: bool) {
        self.inner.enable_pacing(enabled);
    }

    /// Set maximum pacing rate in bytes per second
    ///
    /// @param rate - Maximum pacing rate (0 = unlimited)
    #[napi]
    pub fn set_max_pacing_rate(&mut self, rate: i64) {
        self.inner.set_max_pacing_rate(rate as u64);
    }

    /// Enable or disable QUIC datagrams.
    ///
    /// @param enabled - Whether to enable datagrams
    /// @param recv_queue_len - Maximum number of datagrams to queue for receiving
    /// @param send_queue_len - Maximum number of datagrams to queue for sending
    #[napi]
    pub fn enable_dgram(&mut self, enabled: bool, recv_queue_len: u32, send_queue_len: u32) {
        self.inner.enable_dgram(enabled, recv_queue_len as usize, send_queue_len as usize);
    }

    /// Enable QLOG logging to a file
    ///
    /// QLOG provides detailed connection event logging for debugging and analysis.
    /// This must be called on the Connection after creation, not on Config.
    ///
    /// Note: This is a placeholder. Use connection.setQlog() instead.
    /// QLOG must be enabled on the connection, not the config.

    // Internal method to get inner config (not exposed to JS)
    pub(crate) fn inner_mut(&mut self) -> &mut quiche::Config {
        &mut self.inner
    }
}
