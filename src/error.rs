pub use napi::{Error as NapiError, Status};
use quiche::Error as QuicheError;
use quiche::h3::Error as H3Error;
use napi_derive::napi;

/// Convert quiche::Error to napi::Error
pub fn to_napi_error(err: QuicheError) -> NapiError {
    let message = match err {
        QuicheError::Done => "No more work to do",
        QuicheError::BufferTooShort => "Buffer too short",
        QuicheError::UnknownVersion => "Unknown QUIC version",
        QuicheError::InvalidFrame => "Invalid frame",
        QuicheError::InvalidPacket => "Invalid packet",
        QuicheError::InvalidState => "Invalid connection state",
        QuicheError::InvalidStreamState(_) => "Invalid stream state",
        QuicheError::InvalidTransportParam => "Invalid transport parameter",
        QuicheError::CryptoFail => "Cryptographic operation failed",
        QuicheError::TlsFail => "TLS handshake failed",
        QuicheError::FlowControl => "Flow control violation",
        QuicheError::StreamLimit => "Stream limit exceeded",
        QuicheError::StreamStopped(_) => "Stream stopped by peer",
        QuicheError::StreamReset(_) => "Stream reset by peer",
        QuicheError::FinalSize => "Final size exceeded",
        QuicheError::CongestionControl => "Congestion control error",
        QuicheError::IdLimit => "ID limit exceeded",
        QuicheError::OutOfIdentifiers => "Out of identifiers",
        QuicheError::KeyUpdate => "Key update error",
        QuicheError::CryptoBufferExceeded => "Crypto buffer exceeded",
        QuicheError::InvalidAckRange => "Invalid ACK range",
        QuicheError::OptimisticAckDetected => "Optimistic ACK detected",
    };

    NapiError::new(Status::GenericFailure, message)
}

/// Convert quiche::h3::Error to napi::Error
pub fn to_napi_error_h3(err: H3Error) -> NapiError {
    let message = match err {
        H3Error::Done => "No more work to do",
        H3Error::BufferTooShort => "Buffer too short",
        H3Error::InternalError => "Internal HTTP/3 error",
        H3Error::ExcessiveLoad => "Excessive load",
        H3Error::IdError => "HTTP/3 ID error",
        H3Error::StreamCreationError => "Stream creation error",
        H3Error::ClosedCriticalStream => "Closed critical stream",
        H3Error::MissingSettings => "Missing HTTP/3 settings",
        H3Error::FrameUnexpected => "Unexpected HTTP/3 frame",
        H3Error::FrameError => "HTTP/3 frame error",
        H3Error::QpackDecompressionFailed => "QPACK decompression failed",
        H3Error::TransportError(_) => "QUIC transport error",
        H3Error::StreamBlocked => "Stream blocked",
        H3Error::SettingsError => "HTTP/3 settings error",
        H3Error::RequestRejected => "Request rejected",
        H3Error::RequestCancelled => "Request cancelled",
        H3Error::RequestIncomplete => "Request incomplete",
        H3Error::ConnectError => "HTTP/3 connect error",
        H3Error::VersionFallback => "Version fallback",
        H3Error::MessageError => "HTTP/3 message error",
    };

    NapiError::new(Status::GenericFailure, message)
}

/// Result type alias for convenience
#[napi]
pub type NapiResult<T> = Result<T, NapiError>;

