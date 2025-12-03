use napi::bindgen_prelude::*;
use napi_derive::napi;

use crate::connection::Connection;
use crate::error::{to_napi_error_h3, NapiResult};

/// HTTP/3 configuration
#[napi]
pub struct H3Config {
    inner: quiche::h3::Config,
}

#[napi]
impl H3Config {
    /// Create a new H3 configuration
    #[napi(constructor)]
    pub fn new() -> Self {
        let config = quiche::h3::Config::new().expect("Failed to create H3 config");
        Self { inner: config }
    }

    /// Set max field section size (header size limit)
    #[napi]
    pub fn set_max_field_section_size(&mut self, v: u32) {
        self.inner.set_max_field_section_size(v as u64);
    }

    /// Set QPACK max table capacity
    #[napi]
    pub fn set_qpack_max_table_capacity(&mut self, v: u32) {
        self.inner.set_qpack_max_table_capacity(v as u64);
    }

    /// Set QPACK blocked streams
    #[napi]
    pub fn set_qpack_blocked_streams(&mut self, v: u32) {
        self.inner.set_qpack_blocked_streams(v as u64);
    }

    /// Enable extended CONNECT protocol
    #[napi]
    pub fn enable_extended_connect(&mut self, enabled: bool) {
        self.inner.enable_extended_connect(enabled);
    }

    pub(crate) fn inner(&self) -> &quiche::h3::Config {
        &self.inner
    }
}

/// HTTP/3 header (name-value pair)
#[napi(object)]
pub struct Header {
    pub name: Buffer,
    pub value: Buffer,
}

impl Header {
    fn from_quiche(h: &quiche::h3::Header) -> Self {
        use quiche::h3::NameValue;
        Self {
            name: Buffer::from(h.name()),
            value: Buffer::from(h.value()),
        }
    }

    fn to_quiche(&self) -> quiche::h3::Header {
        quiche::h3::Header::new(self.name.as_ref(), self.value.as_ref())
    }
}

/// HTTP/3 event from poll()
#[napi(object)]
pub struct H3Event {
    /// Event type: "headers", "data", "finished", "reset", "priority_update", "goaway"
    pub event_type: String,
    /// Stream ID (for headers, data, finished, reset events)
    pub stream_id: Option<i64>,
    /// Headers (for headers event)
    pub headers: Option<Vec<Header>>,
    /// Whether more frames follow (for headers event)
    pub more_frames: Option<bool>,
    /// Error code (for reset event)
    pub error_code: Option<i64>,
}

impl H3Event {
    fn from_quiche(stream_id: u64, event: quiche::h3::Event) -> Self {
        match event {
            quiche::h3::Event::Headers { list, more_frames } => Self {
                event_type: "headers".to_string(),
                stream_id: Some(stream_id as i64),
                headers: Some(list.iter().map(Header::from_quiche).collect()),
                more_frames: Some(more_frames),
                error_code: None,
            },
            quiche::h3::Event::Data => Self {
                event_type: "data".to_string(),
                stream_id: Some(stream_id as i64),
                headers: None,
                more_frames: None,
                error_code: None,
            },
            quiche::h3::Event::Finished => Self {
                event_type: "finished".to_string(),
                stream_id: Some(stream_id as i64),
                headers: None,
                more_frames: None,
                error_code: None,
            },
            quiche::h3::Event::Reset(err_code) => Self {
                event_type: "reset".to_string(),
                stream_id: Some(stream_id as i64),
                headers: None,
                more_frames: None,
                error_code: Some(err_code as i64),
            },
            quiche::h3::Event::PriorityUpdate => Self {
                event_type: "priority_update".to_string(),
                stream_id: Some(stream_id as i64),
                headers: None,
                more_frames: None,
                error_code: None,
            },
            quiche::h3::Event::GoAway => Self {
                event_type: "goaway".to_string(),
                stream_id: None,
                headers: None,
                more_frames: None,
                error_code: None,
            },
        }
    }
}

/// HTTP/3 connection
#[napi]
pub struct H3Connection {
    inner: Box<quiche::h3::Connection>,
}

#[napi]
impl H3Connection {
    /// Create HTTP/3 connection from QUIC transport connection
    ///
    /// Note: The QUIC connection must be established (or in early data for client)
    /// before creating the HTTP/3 connection.
    #[napi]
    pub fn with_transport(conn: &mut Connection, config: &H3Config) -> NapiResult<H3Connection> {
        let h3_conn =
            quiche::h3::Connection::with_transport(conn.inner_mut(), config.inner())
                .map_err(to_napi_error_h3)?;

        Ok(H3Connection {
            inner: Box::new(h3_conn),
        })
    }

    /// Send an HTTP/3 request
    ///
    /// Returns the stream ID on which the request was sent.
    #[napi]
    pub fn send_request(
        &mut self,
        conn: &mut Connection,
        headers: Vec<Header>,
        fin: bool,
    ) -> NapiResult<i64> {
        let quiche_headers: Vec<quiche::h3::Header> =
            headers.iter().map(|h| h.to_quiche()).collect();

        let stream_id = self
            .inner
            .send_request(conn.inner_mut(), &quiche_headers, fin)
            .map_err(to_napi_error_h3)?;

        Ok(stream_id as i64)
    }

    /// Send an HTTP/3 response
    #[napi]
    pub fn send_response(
        &mut self,
        conn: &mut Connection,
        stream_id: i64,
        headers: Vec<Header>,
        fin: bool,
    ) -> NapiResult<()> {
        let quiche_headers: Vec<quiche::h3::Header> =
            headers.iter().map(|h| h.to_quiche()).collect();

        self.inner
            .send_response(conn.inner_mut(), stream_id as u64, &quiche_headers, fin)
            .map_err(to_napi_error_h3)?;

        Ok(())
    }

    /// Send body data on a stream
    ///
    /// Returns the number of bytes written.
    #[napi]
    pub fn send_body(
        &mut self,
        conn: &mut Connection,
        stream_id: i64,
        body: Buffer,
        fin: bool,
    ) -> NapiResult<i64> {
        let written = self
            .inner
            .send_body(conn.inner_mut(), stream_id as u64, body.as_ref(), fin)
            .map_err(to_napi_error_h3)?;

        Ok(written as i64)
    }

    /// Receive body data from a stream
    ///
    /// Returns the number of bytes read.
    #[napi]
    pub fn recv_body(
        &mut self,
        conn: &mut Connection,
        stream_id: i64,
        mut out: Buffer,
    ) -> NapiResult<i64> {
        let read = self
            .inner
            .recv_body(conn.inner_mut(), stream_id as u64, out.as_mut())
            .map_err(to_napi_error_h3)?;

        Ok(read as i64)
    }

    /// Poll for HTTP/3 events
    ///
    /// Returns an event object or null if no events are available.
    #[napi]
    pub fn poll(&mut self, conn: &mut Connection) -> NapiResult<Option<H3Event>> {
        match self.inner.poll(conn.inner_mut()) {
            Ok((stream_id, event)) => Ok(Some(H3Event::from_quiche(stream_id, event))),
            Err(quiche::h3::Error::Done) => Ok(None),
            Err(e) => Err(to_napi_error_h3(e)),
        }
    }

    /// Check if connection is using NWEP protocol
    #[napi]
    pub fn is_nwep(&self, conn: &Connection) -> bool {
        self.inner.is_nwep(conn.inner())
    }
}
