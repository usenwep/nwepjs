#!/usr/bin/env node

const dgram = require('dgram');
const {
  Config,
  Connection,
  H3Config,
  H3Connection,
  generateCid,
  nwepAlpn,
  PROTOCOL_VERSION,
} = require('..');

const SERVER_HOST = process.argv[2] || '127.0.0.1';
const SERVER_PORT = parseInt(process.argv[3]) || 4433;
const PATH = process.argv[4] || '/';
const MAX_DATAGRAM_SIZE = 1350;

// Create QUIC config
const config = new Config(PROTOCOL_VERSION);
config.verifyPeer(false); // Skip cert verification for self-signed cert
config.setApplicationProtos(nwepAlpn());
config.setMaxIdleTimeout(5000);
config.setInitialMaxData(10000000);
config.setInitialMaxStreamDataBidiLocal(1000000);
config.setInitialMaxStreamDataBidiRemote(1000000);
config.setInitialMaxStreamDataUni(1000000);
config.setInitialMaxStreamsBidi(100);
config.setInitialMaxStreamsUni(100);

// Create HTTP/3 config
const h3Config = new H3Config();

console.log('connecting to web://' + SERVER_HOST + ':' + SERVER_PORT + PATH);

// Create UDP socket
const socket = dgram.createSocket('udp4');

// Create connection
const scid = generateCid(16);
const conn = Connection.connect(
  scid,
  '0.0.0.0:0',
  `${SERVER_HOST}:${SERVER_PORT}`,
  config
);

let h3Conn = null;
let requestSent = false;
let responseReceived = false;
const out = Buffer.allocUnsafe(MAX_DATAGRAM_SIZE);

socket.on('message', (msg, rinfo) => {
  // Process incoming packet
  try {
    conn.recv(msg, `${rinfo.address}:${rinfo.port}`);
  } catch (e) {
    if (!e.message.includes('Done')) {
      console.error('recv error:', e.message);
    }
  }

  // Create HTTP/3 connection once QUIC is established
  if (conn.isEstablished() && !h3Conn) {
    const proto = conn.applicationProto();
    console.log('connection established');
    if (proto) {
      console.log('alpn:', proto.toString());
    }

    try {
      h3Conn = H3Connection.withTransport(conn, h3Config);
      console.log('http/3 connection established');

      // Check if using NWEP
      if (h3Conn.isNwep(conn)) {
        console.log('using nwep protocol');
      }
    } catch (e) {
      console.error('h3 connection failed:', e.message);
    }
  }

  // Send NWEP request once HTTP/3 is ready
  if (h3Conn && !requestSent) {
    // NWEP request with READ method and web:// scheme
    const request = [
      { name: Buffer.from(':method'), value: Buffer.from('READ') },
      { name: Buffer.from(':scheme'), value: Buffer.from('web') },
      { name: Buffer.from(':authority'), value: Buffer.from(`${SERVER_HOST}:${SERVER_PORT}`) },
      { name: Buffer.from(':path'), value: Buffer.from(PATH) },
      { name: Buffer.from('user-agent'), value: Buffer.from('nwep-nodejs-client') },
    ];

    try {
      const streamId = h3Conn.sendRequest(conn, request, true);
      console.log('sent nwep request on stream', streamId);
      console.log('  method: READ');
      console.log('  scheme: web');
      console.log('  path:', PATH);
      requestSent = true;
    } catch (e) {
      console.error('send request error:', e.message);
    }
  }

  // Poll for HTTP/3 events
  if (h3Conn) {
    while (true) {
      let event;
      try {
        event = h3Conn.poll(conn);
        if (!event) break;
      } catch (e) {
        console.error('poll error:', e.message);
        break;
      }

      console.log('h3 event:', event.eventType, 'stream:', event.streamId);

      if (event.eventType === 'headers') {
        const headers = event.headers || [];
        console.log('response headers:');
        headers.forEach(h => {
          console.log(' ', h.name.toString(), ':', h.value.toString());
        });

        // Extract status
        for (const h of headers) {
          if (h.name.toString() === ':status') {
            console.log('nwep status:', h.value.toString());
          }
        }
      }

      if (event.eventType === 'data') {
        // Read body data
        const buf = Buffer.allocUnsafe(65535);
        try {
          const read = h3Conn.recvBody(conn, event.streamId, buf);
          if (read > 0) {
            const data = buf.slice(0, read);
            console.log('response body:', data.toString());
          }
        } catch (e) {
          if (!e.message.includes('Done')) {
            console.error('recv body error:', e.message);
          }
        }
      }

      if (event.eventType === 'finished') {
        console.log('stream finished');
        responseReceived = true;

        // Close connection gracefully
        setTimeout(() => {
          conn.close(true, 0, Buffer.from('done'));
          console.log('connection closed');

          // Send final packets and exit
          setTimeout(() => {
            while (true) {
              const len = conn.send(out);
              if (len === null) break;
              socket.send(out.slice(0, len), SERVER_PORT, SERVER_HOST);
            }

            socket.close();
            process.exit(0);
          }, 100);
        }, 100);
      }
    }
  }

  // Send outgoing packets
  while (true) {
    try {
      const len = conn.send(out);
      if (len === null) break;

      socket.send(out.slice(0, len), SERVER_PORT, SERVER_HOST);
    } catch (e) {
      console.error('send error:', e.message);
      break;
    }
  }

  // Check if connection closed
  if (conn.isClosed()) {
    console.log('connection closed by peer');
    socket.close();
    process.exit(responseReceived ? 0 : 1);
  }
});

socket.on('error', (err) => {
  console.error('socket error:', err.message);
  process.exit(1);
});

socket.bind(() => {
  // Send initial packet after bind
  const len = conn.send(out);
  if (len !== null) {
    socket.send(out.slice(0, len), SERVER_PORT, SERVER_HOST);
    console.log('sent initial packet');
  }
});

// Handle timeouts
const timeoutInterval = setInterval(() => {
  const timeout = conn.timeout();
  if (timeout !== null) {
    conn.onTimeout();

    while (true) {
      try {
        const len = conn.send(out);
        if (len === null) break;
        socket.send(out.slice(0, len), SERVER_PORT, SERVER_HOST);
      } catch (e) {
        break;
      }
    }
  }

  if (conn.isClosed()) {
    clearInterval(timeoutInterval);
    socket.close();
    process.exit(responseReceived ? 0 : 1);
  }
}, 10);

// Timeout after 5 seconds
setTimeout(() => {
  console.error('timeout: no response from server');
  clearInterval(timeoutInterval);
  socket.close();
  process.exit(1);
}, 5000);

process.on('SIGINT', () => {
  console.log('\ninterrupted');
  clearInterval(timeoutInterval);
  socket.close();
  process.exit(1);
});
