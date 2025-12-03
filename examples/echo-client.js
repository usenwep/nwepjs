#!/usr/bin/env node

const dgram = require('dgram');
const {
  Config,
  Connection,
  generateCid,
  encodeAlpn,
  PROTOCOL_VERSION,
} = require('..');

const SERVER_HOST = process.argv[2] || '127.0.0.1';
const SERVER_PORT = parseInt(process.argv[3]) || 4433;
const MAX_DATAGRAM_SIZE = 1350;

// Create QUIC config
const config = new Config(PROTOCOL_VERSION);
config.verifyPeer(false); // Skip cert verification for self-signed cert
config.setApplicationProtos(encodeAlpn(['echo']));
config.setMaxIdleTimeout(5000);
config.setInitialMaxData(10000000);
config.setInitialMaxStreamDataBidiLocal(1000000);
config.setInitialMaxStreamDataBidiRemote(1000000);
config.setInitialMaxStreamDataUni(1000000);
config.setInitialMaxStreamsBidi(100);
config.setInitialMaxStreamsUni(100);

console.log('connecting to', `${SERVER_HOST}:${SERVER_PORT}`);

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

let messageSent = false;
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

  // Check if connection is established
  if (conn.isEstablished() && !messageSent) {
    const proto = conn.applicationProto();
    console.log('connection established');
    if (proto) {
      console.log('ALPN:', proto.toString());
    }

    // Send a message on stream 0
    const message = 'hello from nodejs quic client!';
    console.log('sending:', message);

    try {
      conn.streamSend(0, Buffer.from(message), true);
      messageSent = true;
    } catch (e) {
      console.error('streamSend error:', e.message);
    }
  }

  // Handle readable streams
  let streamId;
  while ((streamId = conn.streamReadableNext()) !== null) {
    const buf = Buffer.allocUnsafe(65535);

    try {
      const result = conn.streamRecv(streamId, buf);
      const data = buf.slice(0, result.bytes);

      console.log('stream', streamId, 'received:', data.toString());

      if (result.fin) {
        responseReceived = true;
        console.log('response complete!');

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
    } catch (e) {
      if (!e.message.includes('Done')) {
        console.error('streamRecv error:', e.message);
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
