use napi::bindgen_prelude::*;
use napi_derive::napi;
use quiche;
// use std::fs::File; // this was unused
use std::net::SocketAddr;

use crate::config::Config;
use crate::error::{to_napi_error, NapiResult};

/// Stream receive result
#[napi(object)]
pub struct StreamRecvResult {
    /// Number of bytes read
    pub bytes: i64,
    /// Whether this is the final data
    pub fin: bool,
}

/// Connection error information
#[napi(object)]
#[derive(Clone)]
pub struct ConnectionErrorInfo {
    /// Whether this is an application error (vs transport error)
    pub is_app: bool,
    /// Error code
    pub error_code: i64,
    /// Human-readable reason
    pub reason: String,
}

/// Peer QUIC transport parameters
#[napi(object)]
#[derive(Clone)]
pub struct TransportParams {
    /// Maximum idle timeout in milliseconds
    pub max_idle_timeout: i64,
    /// Maximum UDP payload size
    pub max_udp_payload_size: i64,
    /// Initial flow control max data for connection
    pub initial_max_data: i64,
    /// Initial flow control max data for local bidirectional streams
    pub initial_max_stream_data_bidi_local: i64,
    /// Initial flow control max data for remote bidirectional streams
    pub initial_max_stream_data_bidi_remote: i64,
    /// Initial flow control max data for unidirectional streams
    pub initial_max_stream_data_uni: i64,
    /// Initial maximum bidirectional streams
    pub initial_max_streams_bidi: i64,
    /// Initial maximum unidirectional streams
    pub initial_max_streams_uni: i64,
    /// ACK delay exponent
    pub ack_delay_exponent: i64,
    /// Maximum ACK delay in milliseconds
    pub max_ack_delay: i64,
    /// Whether active connection migration is disabled
    pub disable_active_migration: bool,
    /// Active connection ID limit
    pub active_conn_id_limit: i64,
    /// Maximum datagram frame size (null if not supported)
    pub max_datagram_frame_size: Option<i64>,
}

/// QUIC connection
///
/// Represents a single QUIC connection with a peer. Handles packet I/O,
/// stream management, and connection lifecycle.
#[napi]
pub struct Connection {
    inner: Box<quiche::Connection>,
    local_addr: SocketAddr,
}

#[napi]
impl Connection {
    /// Create a client connection
    ///
    /// @param scid - Source Connection ID (Buffer, 1-20 bytes)
    /// @param local - Local socket address (e.g., "127.0.0.1:0")
    /// @param peer - Peer socket address (e.g., "127.0.0.1:4433")
    /// @param config - QUIC configuration
    #[napi]
    pub fn connect(
        scid: Buffer,
        local: String,
        peer: String,
        config: &mut Config,
    ) -> NapiResult<Connection> {
        // Parse socket addresses
        let local_addr: SocketAddr = local
            .parse()
            .map_err(|_| Error::new(Status::InvalidArg, "Invalid local address"))?;

        let peer_addr: SocketAddr = peer
            .parse()
            .map_err(|_| Error::new(Status::InvalidArg, "Invalid peer address"))?;

        // Create ConnectionId from buffer
        let scid_slice = scid.as_ref();
        if scid_slice.is_empty() || scid_slice.len() > quiche::MAX_CONN_ID_LEN {
            return Err(Error::new(
                Status::InvalidArg,
                format!("SCID must be 1-{} bytes", quiche::MAX_CONN_ID_LEN),
            ));
        }

        let scid = quiche::ConnectionId::from_ref(scid_slice);

        // Create connection
        let conn = quiche::connect(None, &scid, local_addr, peer_addr, config.inner_mut())
            .map_err(to_napi_error)?;

        Ok(Connection {
            inner: Box::new(conn),
            local_addr,
        })
    }

    /// Accept a server connection
    ///
    /// @param scid - Source Connection ID (Buffer, 1-20 bytes)
    /// @param odcid - Original Destination Connection ID (Buffer, optional)
    /// @param local - Local socket address
    /// @param peer - Peer socket address
    /// @param config - QUIC configuration
    #[napi]
    pub fn accept(
        scid: Buffer,
        odcid: Option<Buffer>,
        local: String,
        peer: String,
        config: &mut Config,
    ) -> NapiResult<Connection> {
        let local_addr: SocketAddr = local
            .parse()
            .map_err(|_| Error::new(Status::InvalidArg, "Invalid local address"))?;

        let peer_addr: SocketAddr = peer
            .parse()
            .map_err(|_| Error::new(Status::InvalidArg, "Invalid peer address"))?;

        let scid_slice = scid.as_ref();
        if scid_slice.is_empty() || scid_slice.len() > quiche::MAX_CONN_ID_LEN {
            return Err(Error::new(
                Status::InvalidArg,
                format!("SCID must be 1-{} bytes", quiche::MAX_CONN_ID_LEN),
            ));
        }
        let scid = quiche::ConnectionId::from_ref(scid_slice);

        let odcid = odcid
            .as_ref()
            .map(|buf| quiche::ConnectionId::from_ref(buf.as_ref()));

        let conn = quiche::accept(&scid, odcid.as_ref(), local_addr, peer_addr, config.inner_mut())
            .map_err(to_napi_error)?;

        Ok(Connection {
            inner: Box::new(conn),
            local_addr,
        })
    }

    /// Process incoming packet
    ///
    /// @param buf - Packet data
    /// @param from - Sender's socket address
    /// @returns Number of bytes processed
    #[napi]
    pub fn recv(&mut self, mut buf: Buffer, from: String) -> NapiResult<i64> {
        let from_addr: SocketAddr = from
            .parse()
            .map_err(|_| Error::new(Status::InvalidArg, "Invalid from address"))?;

        let recv_info = quiche::RecvInfo {
            from: from_addr,
            to: self.local_addr,
        };

        match self.inner.recv(buf.as_mut(), recv_info) {
            Ok(bytes) => Ok(bytes as i64),
            Err(e) => Err(to_napi_error(e)),
        }
    }

    /// Generate outgoing packet
    ///
    /// @param out - Output buffer (must be at least 1200 bytes)
    /// @returns Number of bytes written, or null if no packet to send
    #[napi]
    pub fn send(&mut self, mut out: Buffer) -> NapiResult<Option<i64>> {
        match self.inner.send(out.as_mut()) {
            Ok((bytes, _send_info)) => Ok(Some(bytes as i64)),
            Err(quiche::Error::Done) => Ok(None),
            Err(e) => Err(to_napi_error(e)),
        }
    }

    /// Send data on a stream
    ///
    /// @param stream_id - Stream ID
    /// @param data - Data to send
    /// @param fin - Whether this is the final data on the stream
    /// @returns Number of bytes written
    #[napi]
    pub fn stream_send(&mut self, stream_id: i64, data: Buffer, fin: bool) -> NapiResult<i64> {
        match self
            .inner
            .stream_send(stream_id as u64, data.as_ref(), fin)
        {
            Ok(bytes) => Ok(bytes as i64),
            Err(e) => Err(to_napi_error(e)),
        }
    }

    /// Receive data from a stream
    ///
    /// @param stream_id - Stream ID
    /// @param out - Output buffer
    /// @returns Object with { bytes: number, fin: boolean }
    #[napi]
    pub fn stream_recv(&mut self, stream_id: i64, mut out: Buffer) -> NapiResult<StreamRecvResult> {
        match self.inner.stream_recv(stream_id as u64, out.as_mut()) {
            Ok((bytes, fin)) => Ok(StreamRecvResult {
                bytes: bytes as i64,
                fin,
            }),
            Err(e) => Err(to_napi_error(e)),
        }
    }

    /// Check if connection is established
    #[napi]
    pub fn is_established(&self) -> bool {
        self.inner.is_established()
    }

    /// Check if connection is closed
    #[napi]
    pub fn is_closed(&self) -> bool {
        self.inner.is_closed()
    }

    /// Check if connection is draining (closing)
    #[napi]
    pub fn is_draining(&self) -> bool {
        self.inner.is_draining()
    }

    /// Check if connection is using 0-RTT early data
    #[napi]
    pub fn is_in_early_data(&self) -> bool {
        self.inner.is_in_early_data()
    }

    /// Check if connection was resumed from a previous session
    #[napi]
    pub fn is_resumed(&self) -> bool {
        self.inner.is_resumed()
    }

    /// Check if connection has timed out
    #[napi]
    pub fn is_timed_out(&self) -> bool {
        self.inner.is_timed_out()
    }

    /// Get the error reported by the peer, if any
    ///
    /// @returns Error information, or null if no peer error
    #[napi]
    pub fn peer_error(&self) -> Option<ConnectionErrorInfo> {
        self.inner.peer_error().map(|err| ConnectionErrorInfo {
            is_app: err.is_app,
            error_code: err.error_code as i64,
            reason: String::from_utf8_lossy(&err.reason).to_string(),
        })
    }

    /// Get the local error that caused connection closure, if any
    ///
    /// @returns Error information, or null if no local error
    #[napi]
    pub fn local_error(&self) -> Option<ConnectionErrorInfo> {
        self.inner.local_error().map(|err| ConnectionErrorInfo {
            is_app: err.is_app,
            error_code: err.error_code as i64,
            reason: String::from_utf8_lossy(&err.reason).to_string(),
        })
    }

    /// Close the connection
    ///
    /// @param app - Whether this is an application close
    /// @param err_code - Error code to send to peer
    /// @param reason - Reason phrase (Buffer)
    #[napi]
    pub fn close(&mut self, app: bool, err_code: i64, reason: Buffer) -> NapiResult<()> {
        self.inner
            .close(app, err_code as u64, reason.as_ref())
            .map_err(to_napi_error)
    }

    /// Get timeout duration in milliseconds
    ///
    /// @returns Milliseconds until next timeout event, or null if no timeout
    #[napi]
    pub fn timeout(&self) -> Option<i64> {
        self.inner.timeout().map(|d| d.as_millis() as i64)
    }

    /// Handle timeout event
    #[napi]
    pub fn on_timeout(&mut self) {
        self.inner.on_timeout()
    }

    /// Enable QLOG logging to a file
    ///
    /// QLOG provides detailed connection event logging in JSON format for
    /// debugging and performance analysis. Must be called early in connection
    /// lifecycle to capture all events.
    ///
    /// @param path - File path for QLOG output (e.g., "/tmp/connection.qlog")
    /// @param title - Log title
    /// @param description - Log description
    #[napi]
    pub fn set_qlog(&mut self, path: String, title: String, description: String) -> NapiResult<()> {
        #[cfg(feature = "qlog")]
        {
            let file = File::create(&path)
                .map_err(|e| napi::Error::from_reason(format!("Failed to create QLOG file: {}", e)))?;
            self.inner.set_qlog(Box::new(file), title, description);
            Ok(())
        }

        #[cfg(not(feature = "qlog"))]
        {
            let _ = (path, title, description); // Suppress unused warnings
            Err(napi::Error::from_reason(
                "QLOG feature not enabled. Rebuild with --features qlog"
            ))
        }
    }

    /// Check if a stream is readable
    #[napi]
    pub fn stream_readable(&self, stream_id: i64) -> bool {
        self.inner.stream_readable(stream_id as u64)
    }

    /// Get next readable stream ID
    ///
    /// @returns Stream ID or null if no readable streams
    #[napi]
    pub fn stream_readable_next(&mut self) -> Option<i64> {
        self.inner.readable().next().map(|id| id as i64)
    }

    /// Check if a stream is writable
    #[napi]
    pub fn stream_writable(&mut self, stream_id: i64) -> bool {
        self.inner.stream_writable(stream_id as u64, 1).unwrap_or(false)
    }

    /// Set stream priority (HTTP/3)
    ///
    /// Controls stream scheduling priority for HTTP/3 connections.
    ///
    /// @param stream_id - Stream ID to prioritize
    /// @param urgency - Priority urgency (0-7, lower = higher priority)
    /// @param incremental - Whether to use incremental delivery
    #[napi]
    pub fn stream_priority(&mut self, stream_id: i64, urgency: u8, incremental: bool) -> NapiResult<()> {
        self.inner
            .stream_priority(stream_id as u64, urgency, incremental)
            .map_err(to_napi_error)
    }

    /// Get negotiated ALPN protocol
    ///
    /// @returns Protocol as Buffer, or null if not negotiated
    #[napi]
    pub fn application_proto(&self) -> Option<Buffer> {
        let proto = self.inner.application_proto();
        if proto.is_empty() {
            None
        } else {
            Some(Buffer::from(proto))
        }
    }

    /// Get the current Path MTU (Maximum Transmission Unit)
    ///
    /// @returns MTU in bytes, or null if not yet determined
    #[napi]
    pub fn pmtu(&self) -> Option<u32> {
        self.inner.pmtu().map(|p| p as u32)
    }

    /// Check if a network path is validated
    ///
    /// Path validation ensures that packets can be received from the peer
    /// on the specified local and peer addresses.
    ///
    /// @param local - Local address (e.g., "127.0.0.1:4433")
    /// @param peer - Peer address (e.g., "127.0.0.1:5000")
    /// @returns true if path is validated, false otherwise
    #[napi]
    pub fn is_path_validated(&self, local: String, peer: String) -> NapiResult<bool> {
        let local_addr: SocketAddr = local
            .parse()
            .map_err(|_| napi::Error::from_reason("Invalid local address"))?;
        let peer_addr: SocketAddr = peer
            .parse()
            .map_err(|_| napi::Error::from_reason("Invalid peer address"))?;

        self.inner
            .is_path_validated(local_addr, peer_addr)
            .map_err(to_napi_error)
    }

    /// Check if this is a server-side connection
    #[napi]
    pub fn is_server(&self) -> bool {
        self.inner.is_server()
    }

    /// Get the source connection ID
    ///
    /// @returns Source CID as Buffer
    #[napi]
    pub fn source_id(&self) -> Buffer {
        // Get the first source ID (active SCID)
        let scid = self.inner.source_ids().next().unwrap();
        Buffer::from(scid.as_ref().to_vec())
    }

    /// Get the destination connection ID
    ///
    /// @returns Destination CID as Buffer
    #[napi]
    pub fn destination_id(&self) -> Buffer {
        let dcid = self.inner.destination_id();
        Buffer::from(dcid.as_ref().to_vec())
    }

    /// Get peer's QUIC transport parameters
    ///
    /// Returns the transport parameters negotiated with the peer during
    /// the handshake. Useful for debugging and interoperability testing.
    ///
    /// @returns Transport parameters, or null if not yet negotiated
    #[napi]
    pub fn peer_transport_params(&self) -> Option<TransportParams> {
        self.inner.peer_transport_params().map(|params| {
            TransportParams {
                max_idle_timeout: params.max_idle_timeout as i64,
                max_udp_payload_size: params.max_udp_payload_size as i64,
                initial_max_data: params.initial_max_data as i64,
                initial_max_stream_data_bidi_local: params.initial_max_stream_data_bidi_local as i64,
                initial_max_stream_data_bidi_remote: params.initial_max_stream_data_bidi_remote as i64,
                initial_max_stream_data_uni: params.initial_max_stream_data_uni as i64,
                initial_max_streams_bidi: params.initial_max_streams_bidi as i64,
                initial_max_streams_uni: params.initial_max_streams_uni as i64,
                ack_delay_exponent: params.ack_delay_exponent as i64,
                max_ack_delay: params.max_ack_delay as i64,
                disable_active_migration: params.disable_active_migration,
                active_conn_id_limit: params.active_conn_id_limit as i64,
                max_datagram_frame_size: params.max_datagram_frame_size.map(|s| s as i64),
            }
        })
    }

    /// Get connection statistics
    #[napi]
    pub fn stats(&self) -> crate::stats::Stats {
        self.inner.stats().into()
    }

    /// Get per-path statistics
    ///
    /// @returns Array of PathStats objects
    #[napi]
    pub fn path_stats(&self) -> Vec<crate::stats::PathStats> {
        self.inner.path_stats().map(|s| s.into()).collect()
    }

    // ========== Connection Migration Methods ==========

    /// Probe a new network path for connection migration
    ///
    /// Initiates path validation for a potential new network path. This is used
    /// when the connection wants to migrate to different local/peer addresses
    /// (e.g., switching from WiFi to cellular on mobile).
    ///
    /// @param local - New local address (e.g., "192.168.1.10:5000")
    /// @param peer - New peer address (e.g., "10.0.0.1:4433")
    /// @returns DCID sequence number for the path
    #[napi]
    pub fn probe_path(&mut self, local: String, peer: String) -> NapiResult<i64> {
        let local_addr: SocketAddr = local
            .parse()
            .map_err(|_| napi::Error::from_reason("Invalid local address"))?;
        let peer_addr: SocketAddr = peer
            .parse()
            .map_err(|_| napi::Error::from_reason("Invalid peer address"))?;

        self.inner
            .probe_path(local_addr, peer_addr)
            .map(|seq| seq as i64)
            .map_err(to_napi_error)
    }

    /// Migrate connection to a new network path
    ///
    /// Switches the connection to use new local and peer addresses. This is
    /// the primary method for connection migration (e.g., WiFi → cellular).
    ///
    /// Note: Only clients can initiate migration (servers cannot).
    ///
    /// @param local - New local address (e.g., "10.0.0.5:6000")
    /// @param peer - New peer address (e.g., "192.168.1.1:4433")
    /// @returns DCID sequence number for the new path
    #[napi]
    pub fn migrate(&mut self, local: String, peer: String) -> NapiResult<i64> {
        let local_addr: SocketAddr = local
            .parse()
            .map_err(|_| napi::Error::from_reason("Invalid local address"))?;
        let peer_addr: SocketAddr = peer
            .parse()
            .map_err(|_| napi::Error::from_reason("Invalid peer address"))?;

        self.inner
            .migrate(local_addr, peer_addr)
            .map(|seq| seq as i64)
            .map_err(to_napi_error)
    }

    /// Migrate connection to a new local address only
    ///
    /// Similar to migrate() but only changes the local address, keeping the
    /// same peer address. Useful when local IP changes but peer stays the same.
    ///
    /// @param local - New local address (e.g., "10.0.0.5:6000")
    /// @returns DCID sequence number for the new path
    #[napi]
    pub fn migrate_source(&mut self, local: String) -> NapiResult<i64> {
        let local_addr: SocketAddr = local
            .parse()
            .map_err(|_| napi::Error::from_reason("Invalid local address"))?;

        self.inner
            .migrate_source(local_addr)
            .map(|seq| seq as i64)
            .map_err(to_napi_error)
    }

    /// Get number of available destination connection IDs
    ///
    /// Returns how many DCIDs are available for connection migration.
    /// If this returns 0, migration may not be possible.
    ///
    /// @returns Number of available DCIDs
    #[napi]
    pub fn available_dcids(&self) -> u32 {
        self.inner.available_dcids() as u32
    }

    /// Retire a destination connection ID
    ///
    /// Signals to the peer that a specific DCID should no longer be used.
    /// This is part of the connection ID management during migration.
    ///
    /// @param dcid_seq - DCID sequence number to retire
    #[napi]
    pub fn retire_dcid(&mut self, dcid_seq: i64) -> NapiResult<()> {
        self.inner
            .retire_dcid(dcid_seq as u64)
            .map_err(to_napi_error)
    }

    /// Re-probe the Path MTU
    ///
    /// Triggers a new PMTU discovery process on the active path.
    /// Useful after network changes or if you suspect MTU has changed.
    #[napi]
    pub fn revalidate_pmtu(&mut self) {
        self.inner.revalidate_pmtu()
    }

    // ========== End Connection Migration Methods ==========

    /// Receive a QUIC datagram.
    ///
    /// @param buf - Buffer to receive datagram into
    /// @returns Number of bytes read, or null if no datagram available
    #[napi]
    pub fn dgram_recv(&mut self, mut buf: Buffer) -> NapiResult<Option<u32>> {
        let buf_slice = buf.as_mut();

        match self.inner.dgram_recv(buf_slice) {
            Ok(len) => Ok(Some(len as u32)),
            Err(quiche::Error::Done) => Ok(None),
            Err(e) => Err(to_napi_error(e)),
        }
    }

    /// Send a QUIC datagram.
    ///
    /// @param buf - Datagram data to send
    #[napi]
    pub fn dgram_send(&mut self, buf: Buffer) -> NapiResult<()> {
        let buf_slice = buf.as_ref();
        self.inner.dgram_send(buf_slice).map_err(to_napi_error)
    }

    /// Get the length of the first datagram in the receive queue.
    ///
    /// @returns Size in bytes, or null if queue is empty
    #[napi]
    pub fn dgram_recv_front_len(&self) -> Option<u32> {
        self.inner.dgram_recv_front_len().map(|len| len as u32)
    }

    /// Get the number of datagrams in the receive queue.
    #[napi]
    pub fn dgram_recv_queue_len(&self) -> u32 {
        self.inner.dgram_recv_queue_len() as u32
    }

    /// Get the total size of all datagrams in the receive queue.
    #[napi]
    pub fn dgram_recv_queue_byte_size(&self) -> u32 {
        self.inner.dgram_recv_queue_byte_size() as u32
    }

    /// Get the number of datagrams in the send queue.
    #[napi]
    pub fn dgram_send_queue_len(&self) -> u32 {
        self.inner.dgram_send_queue_len() as u32
    }

    /// Get the total size of all datagrams in the send queue.
    #[napi]
    pub fn dgram_send_queue_byte_size(&self) -> u32 {
        self.inner.dgram_send_queue_byte_size() as u32
    }

    /// Get the maximum datagram size that can be sent.
    ///
    /// @returns Max datagram size in bytes, or null if datagrams not supported
    #[napi]
    pub fn dgram_max_writable_len(&self) -> Option<u32> {
        self.inner.dgram_max_writable_len().map(|len| len as u32)
    }
}

// Internal methods for h3 module
impl Connection {
    pub(crate) fn inner(&self) -> &quiche::Connection {
        &self.inner
    }

    pub(crate) fn inner_mut(&mut self) -> &mut quiche::Connection {
        &mut self.inner
    }
}
