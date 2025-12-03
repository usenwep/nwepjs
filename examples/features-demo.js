// Demo of new high-priority features: 0-RTT, Error Inspection, PMTU
const dgram = require('dgram');
const { Config, Connection, generateCid, encodeAlpn, PROTOCOL_VERSION } = require('..');

console.log('=== New Features Demo ===\n');

const SERVER_PORT = 4437;
const SERVER_HOST = '127.0.0.1';

// Server
const server = dgram.createSocket('udp4');
const serverConfig = new Config(PROTOCOL_VERSION);
serverConfig.loadCertChainFromPemFile('../quiche/examples/cert.crt');
serverConfig.loadPrivKeyFromPemFile('../quiche/examples/cert.key');
serverConfig.setApplicationProtos(encodeAlpn(['features-test']));
serverConfig.setInitialMaxData(10000000);
serverConfig.setInitialMaxStreamDataBidiLocal(1000000);
serverConfig.setInitialMaxStreamDataBidiRemote(1000000);
serverConfig.setInitialMaxStreamDataUni(1000000);
serverConfig.setInitialMaxStreamsBidi(100);
serverConfig.setInitialMaxStreamsUni(100);
serverConfig.setMaxIdleTimeout(5000);

// Enable early data (0-RTT)
serverConfig.enableEarlyData();
console.log('✓ Server: Early data (0-RTT) enabled');

const clients = new Map();

server.on('message', (msg, rinfo) => {
  const from = `${rinfo.address}:${rinfo.port}`;
  let conn = clients.get(from);

  if (!conn) {
    const scid = generateCid(16);
    conn = Connection.accept(scid, null, `${SERVER_HOST}:${SERVER_PORT}`, from, serverConfig);
    clients.set(from, conn);
    console.log(`\n[Server] New connection from ${from}`);
  }

  try {
    conn.recv(msg, from);
  } catch (e) {
    if (!e.message.includes('Done')) {
      console.error('[Server] recv error:', e.message);
    }
  }

  if (conn.isEstablished()) {
    // Check 0-RTT status
    if (conn.isInEarlyData()) {
      console.log('[Server] Connection is using 0-RTT early data!');
    }
    if (conn.isResumed()) {
      console.log('[Server] Connection resumed from previous session');
    }

    // Check PMTU
    const pmtu = conn.pmtu();
    if (pmtu !== null) {
      console.log(`[Server] Path MTU: ${pmtu} bytes`);
    }

    // Handle stream data
    let streamId;
    while ((streamId = conn.streamReadableNext()) !== null) {
      const buf = Buffer.allocUnsafe(65535);
      try {
        const result = conn.streamRecv(streamId, buf);
        const data = buf.slice(0, result.bytes);
        console.log(`[Server] Stream ${streamId} received: ${data.toString()}`);

        if (result.fin) {
          const response = Buffer.from(`echo: ${data.toString()}`);
          conn.streamSend(streamId, response, true);
          console.log(`[Server] Stream ${streamId} sent response`);
        }
      } catch (e) {
        console.error('[Server] streamRecv error:', e.message);
      }
    }
  }

  // Check for errors
  if (conn.isTimedOut()) {
    console.log('[Server] Connection timed out');
  }

  const peerError = conn.peerError();
  if (peerError !== null) {
    console.log('[Server] Peer error:', peerError);
  }

  const localError = conn.localError();
  if (localError !== null) {
    console.log('[Server] Local error:', localError);
  }

  // Send packets
  const out = Buffer.allocUnsafe(1350);
  let count = 0;
  while (count++ < 100) {
    const len = conn.send(out);
    if (len === null) break;
    server.send(out.slice(0, len), rinfo.port, rinfo.address);
  }
});

// Handle server timeouts
setInterval(() => {
  for (const [from, conn] of clients.entries()) {
    const timeout = conn.timeout();
    if (timeout !== null) {
      conn.onTimeout();

      const fromParts = from.split(':');
      const address = fromParts[0];
      const port = parseInt(fromParts[1]);
      const out = Buffer.allocUnsafe(1350);
      let count = 0;
      while (count++ < 100) {
        const len = conn.send(out);
        if (len === null) break;
        server.send(out.slice(0, len), port, address);
      }
    }

    if (conn.isClosed()) {
      clients.delete(from);
    }
  }
}, 10);

server.bind(SERVER_PORT, () => {
  console.log(`[Server] Listening on ${SERVER_HOST}:${SERVER_PORT}\n`);
});

// Client
setTimeout(() => {
  const socket = dgram.createSocket('udp4');
  const config = new Config(PROTOCOL_VERSION);
  config.verifyPeer(false);
  config.setApplicationProtos(encodeAlpn(['features-test']));
  config.setInitialMaxData(10000000);
  config.setInitialMaxStreamDataBidiLocal(1000000);
  config.setInitialMaxStreamDataBidiRemote(1000000);
  config.setInitialMaxStreamDataUni(1000000);
  config.setInitialMaxStreamsBidi(100);
  config.setInitialMaxStreamsUni(100);
  config.setMaxIdleTimeout(5000);

  // Enable early data (0-RTT)
  config.enableEarlyData();
  console.log('✓ Client: Early data (0-RTT) enabled\n');

  const scid = generateCid(16);
  const conn = Connection.connect(scid, '0.0.0.0:0', `${SERVER_HOST}:${SERVER_PORT}`, config);

  let sent = false;
  let responseReceived = false;

  socket.on('message', (msg, rinfo) => {
    try {
      conn.recv(msg, `${rinfo.address}:${rinfo.port}`);
    } catch (e) {
      if (!e.message.includes('Done')) {
        console.error('[Client] recv error:', e.message);
      }
    }

    if (conn.isEstablished() && !sent) {
      console.log('[Client] Connection established');

      // Check 0-RTT status
      if (conn.isInEarlyData()) {
        console.log('[Client] Using 0-RTT early data!');
      }
      if (conn.isResumed()) {
        console.log('[Client] Session resumed');
      }

      // Check PMTU
      const pmtu = conn.pmtu();
      if (pmtu !== null) {
        console.log(`[Client] Path MTU: ${pmtu} bytes`);
      }

      // Send test message
      const message = 'hello from features demo';
      conn.streamSend(0, Buffer.from(message), true);
      console.log(`[Client] Sent: ${message}\n`);
      sent = true;
    }

    // Handle responses
    let streamId;
    while ((streamId = conn.streamReadableNext()) !== null) {
      const buf = Buffer.allocUnsafe(65535);
      try {
        const result = conn.streamRecv(streamId, buf);
        const data = buf.slice(0, result.bytes);
        console.log(`[Client] Stream ${streamId} received: ${data.toString()}`);

        if (result.fin) {
          responseReceived = true;

          // Check for any errors before closing
          if (conn.isTimedOut()) {
            console.log('[Client] Connection timed out');
          }

          const peerError = conn.peerError();
          if (peerError !== null) {
            console.log('[Client] Peer error:', peerError);
          } else {
            console.log('[Client] No peer errors');
          }

          const localError = conn.localError();
          if (localError !== null) {
            console.log('[Client] Local error:', localError);
          } else {
            console.log('[Client] No local errors');
          }

          setTimeout(() => {
            console.log('\n✅ All features tested successfully!');
            process.exit(0);
          }, 100);
        }
      } catch (e) {
        console.error('[Client] streamRecv error:', e.message);
      }
    }

    // Send packets
    const out = Buffer.allocUnsafe(1350);
    let count = 0;
    while (count++ < 100) {
      const len = conn.send(out);
      if (len === null) break;
      socket.send(out.slice(0, len), SERVER_PORT, SERVER_HOST);
    }
  });

  // Handle client timeouts
  const timeoutInterval = setInterval(() => {
    const timeout = conn.timeout();
    if (timeout !== null) {
      conn.onTimeout();

      const out = Buffer.allocUnsafe(1350);
      let count = 0;
      while (count++ < 100) {
        const len = conn.send(out);
        if (len === null) break;
        socket.send(out.slice(0, len), SERVER_PORT, SERVER_HOST);
      }
    }

    if (conn.isClosed()) {
      clearInterval(timeoutInterval);
      socket.close();
      process.exit(responseReceived ? 0 : 1);
    }
  }, 10);

  socket.bind(() => {
    const out = Buffer.allocUnsafe(1350);
    const len = conn.send(out);
    socket.send(out.slice(0, len), SERVER_PORT, SERVER_HOST);
  });

  setTimeout(() => {
    console.error('\n❌ Timeout');
    clearInterval(timeoutInterval);
    socket.close();
    process.exit(1);
  }, 5000);
}, 500);
