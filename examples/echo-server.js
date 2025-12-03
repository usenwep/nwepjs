#!/usr/bin/env node

const dgram = require('dgram');
const crypto = require('crypto');
const {
  Config,
  Connection,
  generateCid,
  encodeAlpn,
  PROTOCOL_VERSION,
} = require('..');

const MAX_DATAGRAM_SIZE = 1350;

// Find available port starting from 4433
function findAvailablePort(startPort) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');

    socket.on('error', () => {
      socket.close();
      if (startPort < 5000) {
        resolve(findAvailablePort(startPort + 1));
      } else {
        reject(new Error('No available ports between 4433-5000'));
      }
    });

    socket.bind(startPort, '127.0.0.1', () => {
      const port = socket.address().port;
      socket.close(() => resolve(port));
    });
  });
}

// Client connection state
class Client {
  constructor(conn, peer) {
    this.conn = conn;
    this.peer = peer; // "address:port"
  }
}

async function main() {
  const PORT = await findAvailablePort(4433);
  const clients = new Map();

  // Create QUIC config
  const config = new Config(PROTOCOL_VERSION);
  config.loadCertChainFromPemFile('../quiche/examples/cert.crt');
  config.loadPrivKeyFromPemFile('../quiche/examples/cert.key');
  config.setApplicationProtos(encodeAlpn(['echo']));
  config.setMaxIdleTimeout(5000);
  config.setInitialMaxData(10000000);
  config.setInitialMaxStreamDataBidiLocal(1000000);
  config.setInitialMaxStreamDataBidiRemote(1000000);
  config.setInitialMaxStreamDataUni(1000000);
  config.setInitialMaxStreamsBidi(100);
  config.setInitialMaxStreamsUni(100);

  console.log('listening on 127.0.0.1:' + PORT);

  // Create UDP socket
  const socket = dgram.createSocket('udp4');

  socket.on('message', (msg, rinfo) => {
    const from = `${rinfo.address}:${rinfo.port}`;

    // Use peer address as connection key (simple approach for demo)
    let client = clients.get(from);

    if (!client) {
      console.log('new connection from', from);

      // Generate server connection ID
      const scid = generateCid(16);

      try {
        // Create new connection
        const conn = Connection.accept(
          scid,
          null, // odcid
          `127.0.0.1:${PORT}`,
          from,
          config
        );

        client = new Client(conn, from);
        clients.set(from, client);
      } catch (e) {
        console.error('accept failed:', e.message);
        return;
      }
    }

    // Process packet
    try {
      client.conn.recv(msg, from);
    } catch (e) {
      if (!e.message.includes('Done')) {
        console.error('recv error:', e.message);
      }
    }

    // Handle readable streams
    let streamId;
    while ((streamId = client.conn.streamReadableNext()) !== null) {
      const buf = Buffer.allocUnsafe(65535);

      try {
        const result = client.conn.streamRecv(streamId, buf);
        const data = buf.slice(0, result.bytes);

        console.log('stream', streamId, 'received:', data.toString());

        if (result.fin) {
          // Echo back the data
          console.log('stream', streamId, 'echoing back...');
          const response = Buffer.from(`echo: ${data.toString()}`);

          try {
            client.conn.streamSend(streamId, response, true);
          } catch (e) {
            console.error('streamSend error:', e.message);
          }
        }
      } catch (e) {
        if (!e.message.includes('Done')) {
          console.error('streamRecv error:', e.message);
        }
      }
    }

    // Send outgoing packets
    const out = Buffer.allocUnsafe(MAX_DATAGRAM_SIZE);
    while (true) {
      try {
        const len = client.conn.send(out);
        if (len === null) break;

        socket.send(out.slice(0, len), rinfo.port, rinfo.address);
      } catch (e) {
        console.error('send error:', e.message);
        break;
      }
    }

    // Cleanup closed connections
    if (client.conn.isClosed()) {
      console.log('connection closed');
      clients.delete(from);
    }
  });

  socket.bind(PORT, '127.0.0.1');

  // Handle timeouts
  setInterval(() => {
    const out = Buffer.allocUnsafe(MAX_DATAGRAM_SIZE);

    for (const [peer, client] of clients.entries()) {
      client.conn.onTimeout();

      while (true) {
        try {
          const len = client.conn.send(out);
          if (len === null) break;

          const [addr, port] = peer.split(':');
          socket.send(out.slice(0, len), parseInt(port), addr);
        } catch (e) {
          break;
        }
      }

      if (client.conn.isClosed()) {
        clients.delete(peer);
      }
    }
  }, 10);

  process.on('SIGINT', () => {
    console.log('\nshutting down...');
    socket.close();
    process.exit(0);
  });
}

main().catch(err => {
  console.error('error:', err);
  process.exit(1);
});
