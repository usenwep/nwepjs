use napi::bindgen_prelude::*;
use napi_derive::napi;

use crate::error::{to_napi_error, NapiResult};

/// QUIC packet type.
#[napi(string_enum)]
#[derive(Debug, Clone)]
pub enum PacketType {
    /// Initial packet.
    Initial,

    /// Retry packet.
    Retry,

    /// Handshake packet.
    Handshake,

    /// 0-RTT packet.
    ZeroRTT,

    /// Version negotiation packet.
    VersionNegotiation,

    /// 1-RTT short header packet.
    Short,
}

impl From<quiche::Type> for PacketType {
    fn from(ty: quiche::Type) -> Self {
        match ty {
            quiche::Type::Initial => PacketType::Initial,
            quiche::Type::Retry => PacketType::Retry,
            quiche::Type::Handshake => PacketType::Handshake,
            quiche::Type::ZeroRTT => PacketType::ZeroRTT,
            quiche::Type::VersionNegotiation => PacketType::VersionNegotiation,
            quiche::Type::Short => PacketType::Short,
        }
    }
}

// TODO: address this. For now, I'm trying to implement clone manually for this struct.
// /// QUIC packet header information.
// #[napi(object)]
// #[derive(Clone)]
// pub struct PacketHeader {
//     /// The type of the packet.
//     pub packet_type: PacketType,

//     /// The version of the packet.
//     pub version: u32,

//     /// The destination connection ID of the packet.
//     pub dcid: Buffer,

//     /// The source connection ID of the packet.
//     pub scid: Buffer,

//     /// The address verification token (only in Initial and Retry packets).
//     pub token: Option<Buffer>,

//     /// List of versions in VersionNegotiation packets.
//     pub versions: Option<Vec<u32>>,
// }

#[napi(object)]
pub struct PacketHeader {
    pub packet_type: PacketType,
    pub version: u32,
    pub dcid: Buffer,
    pub scid: Buffer,
    pub token: Option<Buffer>,
    pub versions: Option<Vec<u32>>,
}

impl Clone for PacketHeader {
    fn clone(&self) -> Self {
        Self {
            packet_type: self.packet_type.clone(),
            version: self.version,
            dcid: Buffer::from(self.dcid.to_vec()),
            scid: Buffer::from(self.scid.to_vec()),
            token: self.token.as_ref().map(|buf| Buffer::from(buf.to_vec())),
            versions: self.versions.clone(),
        }
    }
}


/// Parse a QUIC packet header from a buffer.
///
/// @param buf - The packet buffer to parse
/// @param dcid_len - Expected length of the destination connection ID (for short headers)
/// @returns Parsed header information
#[napi]
pub fn parse_header(mut buf: Buffer, dcid_len: u32) -> NapiResult<PacketHeader> {
    // Get mutable slice from buffer
    let buf_slice = buf.as_mut();

    let hdr = quiche::Header::from_slice(buf_slice, dcid_len as usize)
        .map_err(to_napi_error)?;

    Ok(PacketHeader {
        packet_type: hdr.ty.into(),
        version: hdr.version,
        dcid: Buffer::from(hdr.dcid.to_vec()),
        scid: Buffer::from(hdr.scid.to_vec()),
        token: hdr.token.map(Buffer::from),
        versions: hdr.versions,
    })
}

/// Generate a version negotiation packet.
///
/// @param scid - Source connection ID
/// @param dcid - Destination connection ID
/// @param out - Output buffer (must be at least 1200 bytes)
/// @returns Number of bytes written
#[napi]
pub fn negotiate_version(scid: Buffer, dcid: Buffer, mut out: Buffer) -> NapiResult<u32> {
    let scid_slice = scid.as_ref();
    let dcid_slice = dcid.as_ref();
    let out_slice = out.as_mut();

    let scid_connid = quiche::ConnectionId::from_ref(scid_slice);
    let dcid_connid = quiche::ConnectionId::from_ref(dcid_slice);

    let len = quiche::negotiate_version(&scid_connid, &dcid_connid, out_slice)
        .map_err(to_napi_error)?;

    Ok(len as u32)
}

/// Generate a retry packet.
///
/// @param scid - Original source connection ID
/// @param dcid - Original destination connection ID
/// @param new_scid - New source connection ID for retry
/// @param token - Retry token
/// @param version - QUIC version
/// @param out - Output buffer (must be at least 1200 bytes)
/// @returns Number of bytes written
#[napi]
pub fn retry(
    scid: Buffer,
    dcid: Buffer,
    new_scid: Buffer,
    token: Buffer,
    version: u32,
    mut out: Buffer,
) -> NapiResult<u32> {
    let scid_slice = scid.as_ref();
    let dcid_slice = dcid.as_ref();
    let new_scid_slice = new_scid.as_ref();
    let token_slice = token.as_ref();
    let out_slice = out.as_mut();

    let scid_connid = quiche::ConnectionId::from_ref(scid_slice);
    let dcid_connid = quiche::ConnectionId::from_ref(dcid_slice);
    let new_scid_connid = quiche::ConnectionId::from_ref(new_scid_slice);

    let len = quiche::retry(
        &scid_connid,
        &dcid_connid,
        &new_scid_connid,
        token_slice,
        version,
        out_slice,
    )
    .map_err(to_napi_error)?;

    Ok(len as u32)
}

/// Check if a buffer contains a valid QUIC version negotiation packet.
///
/// @param buf - Packet buffer to check
/// @returns true if this is a version negotiation packet
#[napi]
pub fn is_version_negotiation(buf: Buffer) -> bool {
    if buf.len() < 5 {
        return false;
    }

    let buf_slice = buf.as_ref();

    // Check if long header (first bit set)
    if (buf_slice[0] & 0x80) == 0 {
        return false;
    }

    // Version 0 indicates version negotiation
    let version = u32::from_be_bytes([buf_slice[1], buf_slice[2], buf_slice[3], buf_slice[4]]);
    version == 0
}
