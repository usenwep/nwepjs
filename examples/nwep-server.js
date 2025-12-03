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
    this.conn = conn;      // QUIC connection
    this.h3Conn = null;    // HTTP/3 connection
    this.peer = peer;      // "address:port"
  }
}

async function main() {
  const PORT = await findAvailablePort(4433);
  const clients = new Map();

  // Create QUIC config
  const config = new Config(PROTOCOL_VERSION);
  config.loadCertChainFromPemFile('../quiche/examples/cert.crt');
  config.loadPrivKeyFromPemFile('../quiche/examples/cert.key');
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

  console.log('nwep server listening on 127.0.0.1:' + PORT);

  // Create UDP socket
  const socket = dgram.createSocket('udp4');

  socket.on('message', (msg, rinfo) => {
    const from = `${rinfo.address}:${rinfo.port}`;

    // Use peer address as connection key
    let client = clients.get(from);

    if (!client) {
      console.log('new connection from', from);

      // Generate server connection ID
      const scid = generateCid(16);

      try {
        // Create new QUIC connection
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

    // Create HTTP/3 connection once QUIC is established
    if (client.conn.isEstablished() && !client.h3Conn) {
      try {
        client.h3Conn = H3Connection.withTransport(client.conn, h3Config);
        console.log('http/3 connection established');

        // Check if using NWEP
        if (client.h3Conn.isNwep(client.conn)) {
          console.log('using nwep protocol');
        }
      } catch (e) {
        console.error('h3 connection failed:', e.message);
      }
    }

    // Poll for HTTP/3 events
    if (client.h3Conn) {
      while (true) {
        let event;
        try {
          event = client.h3Conn.poll(client.conn);
          if (!event) break;
        } catch (e) {
          console.error('poll error:', e.message);
          break;
        }

        console.log('h3 event:', event.eventType, 'stream:', event.streamId);

        if (event.eventType === 'headers') {
          const headers = event.headers || [];
          console.log('headers received:');
          headers.forEach(h => {
            console.log(' ', h.name.toString(), ':', h.value.toString());
          });

          // Extract request details
          let method = null;
          let path = null;
          for (const h of headers) {
            const name = h.name.toString();
            const value = h.value.toString();
            if (name === ':method') method = value;
            if (name === ':path') path = value;
          }

          console.log(`nwep request: ${method} ${path}`);

          // Send NWEP response with text status token
          const response = [
            { name: Buffer.from(':status'), value: Buffer.from('ok') },
            { name: Buffer.from('server'), value: Buffer.from('nwep-nodejs') },
            { name: Buffer.from('content-type'), value: Buffer.from('text/plain') },
          ];

          try {
            client.h3Conn.sendResponse(client.conn, event.streamId, response, false);
            console.log('sent nwep response with status: ok');
          } catch (e) {
            console.error('send response error:', e.message);
          }
        }

        if (event.eventType === 'finished') {
          console.log('stream', event.streamId, 'finished');

          // Send response body
          const body = Buffer.from('hello from nwep server!\n');
          try {
            client.h3Conn.sendBody(client.conn, event.streamId, body, true);
            console.log('sent response body');
          } catch (e) {
            if (!e.message.includes('Done')) {
              console.error('send body error:', e.message);
            }
          }
        }
      }
    }

    // Send outgoing QUIC packets
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
