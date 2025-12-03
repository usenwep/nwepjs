// Minimal datagram demo - based on working echo structure
const dgram = require('dgram');
const { Config, Connection, generateCid, encodeAlpn, PROTOCOL_VERSION } = require('..');

const SERVER_PORT = 4436;
const SERVER_HOST = '127.0.0.1';

// Server
const server = dgram.createSocket('udp4');
const serverConfig = new Config(PROTOCOL_VERSION);
serverConfig.loadCertChainFromPemFile('../quiche/examples/cert.crt');
serverConfig.loadPrivKeyFromPemFile('../quiche/examples/cert.key');
serverConfig.setApplicationProtos(encodeAlpn(['dgram']));
serverConfig.setInitialMaxData(10000000);
serverConfig.setInitialMaxStreamDataBidiLocal(1000000);
serverConfig.setInitialMaxStreamDataBidiRemote(1000000);
serverConfig.setInitialMaxStreamDataUni(1000000);
serverConfig.setInitialMaxStreamsBidi(100);
serverConfig.setInitialMaxStreamsUni(100);
serverConfig.setMaxIdleTimeout(5000);
serverConfig.enableDgram(true, 10, 10);

const clients = new Map();

server.on('message', (msg, rinfo) => {
  const from = `${rinfo.address}:${rinfo.port}`;
  let conn = clients.get(from);

  if (!conn) {
    const scid = generateCid(16);
    conn = Connection.accept(scid, null, `${SERVER_HOST}:${SERVER_PORT}`, from, serverConfig);
    clients.set(from, conn);
    console.log('[Server] New connection from', from);
  }

  try {
    conn.recv(msg, from);
  } catch (e) {
    if (!e.message.includes('Done')) {
      console.error('[Server] recv error:', e.message);
    }
  }

  // Check for datagrams
  if (conn.isEstablished()) {
    const buf = Buffer.allocUnsafe(1200);
    const len = conn.dgramRecv(buf);
    if (len !== null) {
      const data = buf.slice(0, len).toString();
      console.log('[Server] RX datagram:', data);
      const response = Buffer.from('PONG: ' + data);
      conn.dgramSend(response);
      console.log('[Server] TX datagram:', response.toString());
    }
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

server.bind(SERVER_PORT, () => {
  console.log(`[Server] Listening on ${SERVER_HOST}:${SERVER_PORT}\n`);
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
      console.log('[Server] Connection closed:', from);
      clients.delete(from);
    }
  }
}, 10);

// Client
setTimeout(() => {
  console.log('[Client] Starting...\n');

  const socket = dgram.createSocket('udp4');
  const config = new Config(PROTOCOL_VERSION);
  config.verifyPeer(false);
  config.setApplicationProtos(encodeAlpn(['dgram']));
  config.setInitialMaxData(10000000);
  config.setInitialMaxStreamDataBidiLocal(1000000);
  config.setInitialMaxStreamDataBidiRemote(1000000);
  config.setInitialMaxStreamDataUni(1000000);
  config.setInitialMaxStreamsBidi(100);
  config.setInitialMaxStreamsUni(100);
  config.setMaxIdleTimeout(5000);
  config.enableDgram(true, 10, 10);

  const scid = generateCid(16);
  const conn = Connection.connect(scid, '0.0.0.0:0', `${SERVER_HOST}:${SERVER_PORT}`, config);

  console.log('[Client] Connecting to', `${SERVER_HOST}:${SERVER_PORT}`);

  let sent = false;
  let done = false;

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
      const ping = Buffer.from('PING');
      conn.dgramSend(ping);
      console.log('[Client] TX datagram: PING');
      sent = true;
    }

    // Check for response
    if (conn.isEstablished()) {
      const buf = Buffer.allocUnsafe(1200);
      const len = conn.dgramRecv(buf);
      if (len !== null) {
        console.log('[Client] RX datagram:', buf.slice(0, len).toString());
        done = true;
        setTimeout(() => {
          console.log('\n✅ Success!');
          process.exit(0);
        }, 100);
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
      process.exit(done ? 0 : 1);
    }
  }, 10);

  socket.bind(() => {
    console.log('[Client] Sent initial packet\n');
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
