// Comprehensive demo of ALL new features
const dgram = require('dgram');
const { Config, Connection, generateCid, encodeAlpn, PROTOCOL_VERSION } = require('..');

console.log('=== Comprehensive Features Demo ===\n');

const SERVER_PORT = 4439;
const clients = new Map();

// Server
const server = dgram.createSocket('udp4');
const serverConfig = new Config(PROTOCOL_VERSION);
serverConfig.loadCertChainFromPemFile('../quiche/examples/cert.crt');
serverConfig.loadPrivKeyFromPemFile('../quiche/examples/cert.key');
serverConfig.setApplicationProtos(encodeAlpn(['all-features']));
serverConfig.setInitialMaxData(10000000);
serverConfig.setInitialMaxStreamDataBidiLocal(1000000);
serverConfig.setInitialMaxStreamDataBidiRemote(1000000);
serverConfig.setInitialMaxStreamDataUni(1000000);
serverConfig.setInitialMaxStreamsBidi(100);
serverConfig.setInitialMaxStreamsUni(100);
serverConfig.setMaxIdleTimeout(5000);

// NEW: 0-RTT
serverConfig.enableEarlyData();
console.log('✓ 0-RTT enabled');

// NEW: Performance tuning
serverConfig.setInitialRtt(50); // 50ms initial RTT estimate
serverConfig.enableHystart(true);
serverConfig.enablePacing(true);
serverConfig.setMaxPacingRate(1000000); // 1 MB/s max pacing
console.log('✓ Performance tuning: RTT=50ms, HyStart++, Pacing=1MB/s\n');

server.on('message', (msg, rinfo) => {
  const from = `${rinfo.address}:${rinfo.port}`;
  let conn = clients.get(from);

  if (!conn) {
    const scid = generateCid(16);
    conn = Connection.accept(scid, null, `127.0.0.1:${SERVER_PORT}`, from, serverConfig);
    clients.set(from, conn);

    console.log('[Server] New connection');
    console.log(`  - Is server: ${conn.isServer()}`);
    console.log(`  - Source ID: ${conn.sourceId().toString('hex')}`);
    console.log(`  - Dest ID: ${conn.destinationId().toString('hex')}`);
  }

  try {
    conn.recv(msg, from);
  } catch (e) {}

  if (conn.isEstablished()) {
    // NEW: 0-RTT status
    if (conn.isInEarlyData()) {
      console.log('[Server] Using 0-RTT early data!');
    }
    if (conn.isResumed()) {
      console.log('[Server] Session resumed');
    }

    // NEW: PMTU
    const pmtu = conn.pmtu();
    if (pmtu) {
      console.log(`[Server] PMTU: ${pmtu} bytes`);
    }

    // Handle streams
    let streamId;
    while ((streamId = conn.streamReadableNext()) !== null) {
      const buf = Buffer.allocUnsafe(65535);
      try {
        const result = conn.streamRecv(streamId, buf);
        const data = buf.slice(0, result.bytes);
        console.log(`[Server] Received: ${data.toString()}`);

        if (result.fin) {
          const response = Buffer.from(`echo: ${data.toString()}`);
          conn.streamSend(streamId, response, true);
        }
      } catch (e) {}
    }
  }

  // NEW: Error inspection
  if (conn.isTimedOut()) {
    console.log('[Server] ⚠️  Connection timed out');
  }

  const peerErr = conn.peerError();
  if (peerErr) {
    console.log(`[Server] ⚠️  Peer error: ${peerErr.errorCode} - ${peerErr.reason}`);
  }

  const out = Buffer.allocUnsafe(1350);
  let count = 0;
  while (count++ < 100) {
    const len = conn.send(out);
    if (len === null) break;
    server.send(out.slice(0, len), rinfo.port, rinfo.address);
  }
});

setInterval(() => {
  for (const [from, conn] of clients.entries()) {
    const timeout = conn.timeout();
    if (timeout !== null) {
      conn.onTimeout();
      const fromParts = from.split(':');
      const out = Buffer.allocUnsafe(1350);
      let count = 0;
      while (count++ < 100) {
        const len = conn.send(out);
        if (len === null) break;
        server.send(out.slice(0, len), parseInt(fromParts[1]), fromParts[0]);
      }
    }
    if (conn.isClosed()) clients.delete(from);
  }
}, 10);

server.bind(SERVER_PORT, () => {
  console.log(`[Server] Listening on 127.0.0.1:${SERVER_PORT}\n`);

  // Client
  setTimeout(() => {
    console.log('[Client] Starting...\n');

    const socket = dgram.createSocket('udp4');
    const config = new Config(PROTOCOL_VERSION);
    config.verifyPeer(false);
    config.setApplicationProtos(encodeAlpn(['all-features']));
    config.setInitialMaxData(10000000);
    config.setInitialMaxStreamDataBidiLocal(1000000);
    config.setInitialMaxStreamDataBidiRemote(1000000);
    config.setInitialMaxStreamDataUni(1000000);
    config.setInitialMaxStreamsBidi(100);
    config.setInitialMaxStreamsUni(100);
    config.setMaxIdleTimeout(5000);

    // NEW: Performance features
    config.enableEarlyData();
    config.setInitialRtt(50);
    config.enableHystart(true);
    config.enablePacing(true);
    config.setMaxPacingRate(1000000);

    const scid = generateCid(16);
    const conn = Connection.connect(scid, '0.0.0.0:0', `127.0.0.1:${SERVER_PORT}`, config);

    console.log('[Client] Connection created');
    console.log(`  - Is server: ${conn.isServer()}`);
    console.log(`  - Source ID: ${conn.sourceId().toString('hex')}`);
    console.log(`  - Dest ID: ${conn.destinationId().toString('hex')}\n`);

    let sent = false;

    socket.on('message', (msg, rinfo) => {
      try {
        conn.recv(msg, `${rinfo.address}:${rinfo.port}`);
      } catch (e) {}

      if (conn.isEstablished() && !sent) {
        console.log('[Client] Connection established');

        // NEW: 0-RTT status
        console.log(`  - In early data: ${conn.isInEarlyData()}`);
        console.log(`  - Resumed: ${conn.isResumed()}`);
        console.log(`  - Timed out: ${conn.isTimedOut()}`);

        // NEW: PMTU
        const pmtu = conn.pmtu();
        console.log(`  - PMTU: ${pmtu || 'not yet determined'}`);

        const stats = conn.stats();
        console.log(`  - Packets: sent=${stats.sent}, recv=${stats.recv}`);

        const pathStats = conn.pathStats();
        if (pathStats.length > 0) {
          console.log(`  - Path PMTU: ${pathStats[0].pmtu} bytes`);
          console.log(`  - RTT: ${pathStats[0].rttMs.toFixed(2)}ms`);
          console.log(`  - CWND: ${pathStats[0].cwnd} bytes\n`);
        }

        // NEW: Error checking
        const peerErr = conn.peerError();
        const localErr = conn.localError();
        console.log(`  - Peer error: ${peerErr ? 'YES' : 'none'}`);
        console.log(`  - Local error: ${localErr ? 'YES' : 'none'}\n`);

        const message = 'Testing all new features!';
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
          console.log(`[Client] Received: ${data.toString()}`);

          if (result.fin) {
            setTimeout(() => {
              console.log('\n' + '='.repeat(50));
              console.log('✅ ALL FEATURES TESTED SUCCESSFULLY!');
              console.log('='.repeat(50));
              console.log('\nNew features demonstrated:');
              console.log('  ✓ 0-RTT / Early Data (enableEarlyData, isInEarlyData, isResumed)');
              console.log('  ✓ Error Inspection (isTimedOut, peerError, localError)');
              console.log('  ✓ PMTU Info (pmtu)');
              console.log('  ✓ Connection Info (isServer, sourceId, destinationId)');
              console.log('  ✓ Performance Tuning (setInitialRtt, enableHystart, enablePacing)');
              console.log('='.repeat(50) + '\n');
              process.exit(0);
            }, 100);
          }
        } catch (e) {}
      }

      const out = Buffer.allocUnsafe(1350);
      let count = 0;
      while (count++ < 100) {
        const len = conn.send(out);
        if (len === null) break;
        socket.send(out.slice(0, len), SERVER_PORT, '127.0.0.1');
      }
    });

    setInterval(() => {
      const timeout = conn.timeout();
      if (timeout !== null) {
        conn.onTimeout();
        const out = Buffer.allocUnsafe(1350);
        let count = 0;
        while (count++ < 100) {
          const len = conn.send(out);
          if (len === null) break;
          socket.send(out.slice(0, len), SERVER_PORT, '127.0.0.1');
        }
      }
      if (conn.isClosed()) process.exit(1);
    }, 10);

    socket.bind(() => {
      const out = Buffer.allocUnsafe(1350);
      const len = conn.send(out);
      socket.send(out.slice(0, len), SERVER_PORT, '127.0.0.1');
    });
  }, 500);
});

setTimeout(() => {
  console.log('\n❌ Timeout');
  process.exit(1);
}, 5000);
