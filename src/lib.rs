#![deny(clippy::all)]

mod config;
mod connection;
mod error;
mod h3;
mod packet;
mod stats;
mod types;
mod utils;

// Re-export public API
pub use config::Config;
pub use connection::{Connection, StreamRecvResult};
pub use h3::{H3Config, H3Connection, H3Event, Header};
pub use packet::{is_version_negotiation, negotiate_version, parse_header, retry, PacketHeader, PacketType};
pub use stats::{PathStats, StartupExit, StartupExitReason, Stats};
pub use types::{CongestionControlAlgorithm, MAX_CONN_ID_LEN, MIN_CLIENT_INITIAL_LEN, PROTOCOL_VERSION};
pub use utils::{encode_alpn, generate_cid, nwep_alpn, nwep_and_h3_alpn};
pub use error::{NapiResult};