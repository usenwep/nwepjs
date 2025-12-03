use napi_derive::napi;

/// QUIC connection statistics.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct Stats {
    /// The number of QUIC packets received.
    pub recv: u32,

    /// The number of QUIC packets sent.
    pub sent: u32,

    /// The number of QUIC packets that were lost.
    pub lost: u32,

    /// The number of QUIC packets that were marked as lost but later acked.
    pub spurious_lost: u32,

    /// The number of sent QUIC packets with retransmitted data.
    pub retrans: u32,

    /// The number of sent bytes.
    pub sent_bytes: i64,

    /// The number of received bytes.
    pub recv_bytes: i64,

    /// The number of bytes sent acked.
    pub acked_bytes: i64,

    /// The number of bytes sent lost.
    pub lost_bytes: i64,

    /// The number of stream bytes retransmitted.
    pub stream_retrans_bytes: i64,

    /// The number of DATAGRAM frames received.
    pub dgram_recv: u32,

    /// The number of DATAGRAM frames sent.
    pub dgram_sent: u32,

    /// The number of known paths for the connection.
    pub paths_count: u32,

    /// The number of streams reset by local.
    pub reset_stream_count_local: i64,

    /// The number of streams stopped by local.
    pub stopped_stream_count_local: i64,

    /// The number of streams reset by remote.
    pub reset_stream_count_remote: i64,

    /// The number of streams stopped by remote.
    pub stopped_stream_count_remote: i64,

    /// The total number of PATH_CHALLENGE frames that were received.
    pub path_challenge_rx_count: i64,

    /// Total duration during which this side of the connection was
    /// actively sending bytes or waiting for those bytes to be acked (in milliseconds).
    pub bytes_in_flight_duration_ms: f64,
}

impl From<quiche::Stats> for Stats {
    fn from(stats: quiche::Stats) -> Self {
        Self {
            recv: stats.recv as u32,
            sent: stats.sent as u32,
            lost: stats.lost as u32,
            spurious_lost: stats.spurious_lost as u32,
            retrans: stats.retrans as u32,
            sent_bytes: stats.sent_bytes as i64,
            recv_bytes: stats.recv_bytes as i64,
            acked_bytes: stats.acked_bytes as i64,
            lost_bytes: stats.lost_bytes as i64,
            stream_retrans_bytes: stats.stream_retrans_bytes as i64,
            dgram_recv: stats.dgram_recv as u32,
            dgram_sent: stats.dgram_sent as u32,
            paths_count: stats.paths_count as u32,
            reset_stream_count_local: stats.reset_stream_count_local as i64,
            stopped_stream_count_local: stats.stopped_stream_count_local as i64,
            reset_stream_count_remote: stats.reset_stream_count_remote as i64,
            stopped_stream_count_remote: stats.stopped_stream_count_remote as i64,
            path_challenge_rx_count: stats.path_challenge_rx_count as i64,
            bytes_in_flight_duration_ms: stats.bytes_in_flight_duration.as_secs_f64() * 1000.0,
        }
    }
}

// PathState is not publicly exported by quiche, so we convert it to a string
fn path_state_to_string(state: impl std::fmt::Debug) -> String {
    format!("{:?}", state)
}

/// The reason a CCA exited the startup phase.
#[napi(string_enum)]
#[derive(Debug, Clone)] // TODO: I added Clone here to fix a build error
pub enum StartupExitReason {
    /// Exit startup due to excessive loss.
    Loss,

    /// Exit startup due to bandwidth plateau.
    BandwidthPlateau,

    /// Exit startup due to persistent queue.
    PersistentQueue,
}

impl From<quiche::StartupExitReason> for StartupExitReason {
    fn from(reason: quiche::StartupExitReason) -> Self {
        match reason {
            quiche::StartupExitReason::Loss => StartupExitReason::Loss,
            quiche::StartupExitReason::BandwidthPlateau => StartupExitReason::BandwidthPlateau,
            quiche::StartupExitReason::PersistentQueue => StartupExitReason::PersistentQueue,
        }
    }
}

/// Statistics from when a CCA first exited the startup phase.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct StartupExit {
    /// The congestion_window recorded at Startup exit.
    pub cwnd: u32,

    /// The bandwidth estimate recorded at Startup exit (bytes per second).
    pub bandwidth: Option<i64>,

    /// The reason a CCA exited the startup phase.
    pub reason: StartupExitReason,
}

impl From<quiche::StartupExit> for StartupExit {
    fn from(exit: quiche::StartupExit) -> Self {
        Self {
            cwnd: exit.cwnd as u32,
            bandwidth: exit.bandwidth.map(|b| b as i64),
            reason: exit.reason.into(),
        }
    }
}

/// Per-path QUIC statistics.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct PathStats {
    /// The local address of the path.
    pub local_addr: String,

    /// The peer address of the path.
    pub peer_addr: String,

    /// The path validation state (Failed, Unknown, Validating, ValidatingMTU, or Validated).
    pub validation_state: String,

    /// Whether the path is marked as active.
    pub active: bool,

    /// The number of QUIC packets received.
    pub recv: u32,

    /// The number of QUIC packets sent.
    pub sent: u32,

    /// The number of QUIC packets that were lost.
    pub lost: u32,

    /// The number of sent QUIC packets with retransmitted data.
    pub retrans: u32,

    /// The number of times PTO (probe timeout) fired.
    pub total_pto_count: u32,

    /// The number of DATAGRAM frames received.
    pub dgram_recv: u32,

    /// The number of DATAGRAM frames sent.
    pub dgram_sent: u32,

    /// The estimated round-trip time of the connection (in milliseconds).
    pub rtt_ms: f64,

    /// The minimum round-trip time observed (in milliseconds).
    pub min_rtt_ms: Option<f64>,

    /// The maximum round-trip time observed (in milliseconds).
    pub max_rtt_ms: Option<f64>,

    /// The estimated round-trip time variation in samples using a mean
    /// variation (in milliseconds).
    pub rttvar_ms: f64,

    /// The size of the connection's congestion window in bytes.
    pub cwnd: u32,

    /// The number of sent bytes.
    pub sent_bytes: i64,

    /// The number of received bytes.
    pub recv_bytes: i64,

    /// The number of bytes lost.
    pub lost_bytes: i64,

    /// The number of stream bytes retransmitted.
    pub stream_retrans_bytes: i64,

    /// The current PMTU for the connection.
    pub pmtu: u32,

    /// The most recent data delivery rate estimate in bytes/s.
    pub delivery_rate: i64,

    /// The maximum bandwidth estimate for the connection in bytes/s.
    pub max_bandwidth: Option<i64>,

    /// Statistics from when a CCA first exited the startup phase.
    pub startup_exit: Option<StartupExit>,
}

impl From<quiche::PathStats> for PathStats {
    fn from(stats: quiche::PathStats) -> Self {
        Self {
            local_addr: stats.local_addr.to_string(),
            peer_addr: stats.peer_addr.to_string(),
            validation_state: path_state_to_string(stats.validation_state),
            active: stats.active,
            recv: stats.recv as u32,
            sent: stats.sent as u32,
            lost: stats.lost as u32,
            retrans: stats.retrans as u32,
            total_pto_count: stats.total_pto_count as u32,
            dgram_recv: stats.dgram_recv as u32,
            dgram_sent: stats.dgram_sent as u32,
            rtt_ms: stats.rtt.as_secs_f64() * 1000.0,
            min_rtt_ms: stats.min_rtt.map(|d| d.as_secs_f64() * 1000.0),
            max_rtt_ms: stats.max_rtt.map(|d| d.as_secs_f64() * 1000.0),
            rttvar_ms: stats.rttvar.as_secs_f64() * 1000.0,
            cwnd: stats.cwnd as u32,
            sent_bytes: stats.sent_bytes as i64,
            recv_bytes: stats.recv_bytes as i64,
            lost_bytes: stats.lost_bytes as i64,
            stream_retrans_bytes: stats.stream_retrans_bytes as i64,
            pmtu: stats.pmtu as u32,
            delivery_rate: stats.delivery_rate as i64,
            max_bandwidth: stats.max_bandwidth.map(|b| b as i64),
            startup_exit: stats.startup_exit.map(|e| e.into()),
        }
    }
}
