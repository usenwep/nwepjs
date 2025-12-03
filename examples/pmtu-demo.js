// PMTU (Path MTU) demonstration
const dgram = require('dgram');
const { Config, Connection, generateCid, encodeAlpn, PROTOCOL_VERSION } = require('..');

console.log('=== PMTU Demo ===\n');

const SERVER_PORT = 4438;
const clients = new Map();

// Server
const server = dgram.createSocket('udp4');
const serverConfig = new Config(PROTOCOL_VERSION);
serverConfig.loadCertChainFromPemFile('../quiche/examples/cert.crt');
serverConfig.loadPrivKeyFromPemFile('../quiche/examples/cert.key');
serverConfig.setApplicationProtos(encodeAlpn(['pmtu-test']));
serverConfig.setInitialMaxData(10000000);
serverConfig.setInitialMaxStreamDataBidiLocal(1000000);
serverConfig.setInitialMaxStreamDataBidiRemote(1000000);
serverConfig.setInitialMaxStreamDataUni(1000000);
serverConfig.setInitialMaxStreamsBidi(100);
serverConfig.setInitialMaxStreamsUni(100);
serverConfig.setMaxIdleTimeout(5000);

server.on('message', (msg, rinfo) => {
  const from = `${rinfo.address}:${rinfo.port}`;
  let conn = clients.get(from);

  if (!conn) {
    const scid = generateCid(16);
    conn = Connection.accept(scid, null, `127.0.0.1:${SERVER_PORT}`, from, serverConfig);
    clients.set(from, conn);
  }

  try {
    conn.recv(msg, from);
  } catch (e) {}

  if (conn.isEstablished()) {
    const pmtu = conn.pmtu();
    const stats = conn.stats();

    console.log(`[Server] PMTU: ${pmtu || 'not yet determined'} bytes`);
    console.log(`[Server] Packets sent: ${stats.sent}, recv: ${stats.recv}`);
    console.log(`[Server] Bytes sent: ${stats.sentBytes}, recv: ${stats.recvBytes}\n`);
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
  console.log(`Server listening on 127.0.0.1:${SERVER_PORT}\n`);

  // Client
  setTimeout(() => {
    const socket = dgram.createSocket('udp4');
    const config = new Config(PROTOCOL_VERSION);
    config.verifyPeer(false);
    config.setApplicationProtos(encodeAlpn(['pmtu-test']));
    config.setInitialMaxData(10000000);
    config.setInitialMaxStreamDataBidiLocal(1000000);
    config.setInitialMaxStreamDataBidiRemote(1000000);
    config.setInitialMaxStreamDataUni(1000000);
    config.setInitialMaxStreamsBidi(100);
    config.setInitialMaxStreamsUni(100);
    config.setMaxIdleTimeout(5000);

    const scid = generateCid(16);
    const conn = Connection.connect(scid, '0.0.0.0:0', `127.0.0.1:${SERVER_PORT}`, config);

    socket.on('message', (msg, rinfo) => {
      try {
        conn.recv(msg, `${rinfo.address}:${rinfo.port}`);
      } catch (e) {}

      if (conn.isEstablished()) {
        const pmtu = conn.pmtu();
        const stats = conn.stats();
        const pathStats = conn.pathStats();

        console.log(`[Client] PMTU: ${pmtu || 'not yet determined'} bytes`);
        console.log(`[Client] Packets sent: ${stats.sent}, recv: ${stats.recv}`);
        console.log(`[Client] Bytes sent: ${stats.sentBytes}, recv: ${stats.recvBytes}`);

        if (pathStats.length > 0) {
          console.log(`[Client] Path PMTU from stats: ${pathStats[0].pmtu} bytes`);
        }

        setTimeout(() => {
          console.log('\n✅ PMTU successfully retrieved!');
          process.exit(0);
        }, 100);
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
  console.log('\n⏱️  Timeout');
  process.exit(1);
}, 5000);
