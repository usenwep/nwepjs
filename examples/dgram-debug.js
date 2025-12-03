const dgram = require('dgram');
const { Config, Connection, generateCid, encodeAlpn, PROTOCOL_VERSION } = require('..');

console.log('=== Datagram Debug Test ===\n');

// Server
const serverSocket = dgram.createSocket('udp4');
const serverConfig = new Config(PROTOCOL_VERSION);
serverConfig.loadCertChainFromPemFile('../quiche/examples/cert.crt');
serverConfig.loadPrivKeyFromPemFile('../quiche/examples/cert.key');
serverConfig.setApplicationProtos(encodeAlpn(['dgram-test']));
serverConfig.setInitialMaxData(1000000);
serverConfig.setInitialMaxStreamDataBidiLocal(1000000);
serverConfig.setInitialMaxStreamDataBidiRemote(1000000);
serverConfig.setInitialMaxStreamDataUni(1000000);
serverConfig.setInitialMaxStreamsBidi(100);
serverConfig.setInitialMaxStreamsUni(100);
serverConfig.setMaxIdleTimeout(5000);
serverConfig.enableDgram(true, 10, 10);

let serverConn = null;
let clientAddr = null;

serverSocket.on('message', (msg, rinfo) => {
  console.log(`[Server] Received ${msg.length} bytes from ${rinfo.address}:${rinfo.port}`);

  if (!serverConn) {
    const scid = generateCid(16);
    serverConn = Connection.accept(scid, null, '127.0.0.1:4435', `${rinfo.address}:${rinfo.port}`, serverConfig);
    clientAddr = rinfo;
    console.log('[Server] Connection accepted');
  }

  try {
    const recvBytes = serverConn.recv(msg, `${rinfo.address}:${rinfo.port}`);
    console.log(`[Server] recv() processed ${recvBytes} bytes`);
  } catch (e) {
    console.log(`[Server] recv() error: ${e.message}`);
  }

  console.log(`[Server] isEstablished: ${serverConn.isEstablished()}, isClosed: ${serverConn.isClosed()}, isDraining: ${serverConn.isDraining()}`);

  if (serverConn.isEstablished()) {
    console.log('[Server] Connection ESTABLISHED!');

    // Try to receive datagram
    const buf = Buffer.allocUnsafe(1200);
    const len = serverConn.dgramRecv(buf);
    if (len !== null) {
      console.log('[Server] RX datagram:', buf.slice(0, len).toString());
      const response = Buffer.from('PONG');
      serverConn.dgramSend(response);
      console.log('[Server] TX datagram: PONG');
    }
  }

  // Send responses
  const out = Buffer.allocUnsafe(1350);
  let sendCount = 0;
  let totalSent = 0;
  while (sendCount++ < 100) {
    const written = serverConn.send(out);
    if (written === null || written === 0) break;
    serverSocket.send(out.slice(0, written), rinfo.port, rinfo.address);
    totalSent += written;
  }
  console.log(`[Server] Sent ${sendCount - 1} packets (${totalSent} bytes)\n`);
});

serverSocket.bind(4435, () => {
  console.log('Server listening on 4435\n');

  // Client
  const clientSocket = dgram.createSocket('udp4');
  const clientConfig = new Config(PROTOCOL_VERSION);
  clientConfig.verifyPeer(false);
  clientConfig.setApplicationProtos(encodeAlpn(['dgram-test']));
  clientConfig.setInitialMaxData(1000000);
  clientConfig.setInitialMaxStreamDataBidiLocal(1000000);
  clientConfig.setInitialMaxStreamDataBidiRemote(1000000);
  clientConfig.setInitialMaxStreamDataUni(1000000);
  clientConfig.setInitialMaxStreamsBidi(100);
  clientConfig.setInitialMaxStreamsUni(100);
  clientConfig.setMaxIdleTimeout(5000);
  clientConfig.enableDgram(true, 10, 10);

  const scid = generateCid(16);
  const clientConn = Connection.connect(scid, '0.0.0.0:0', '127.0.0.1:4435', clientConfig);

  let sent = false;

  clientSocket.on('message', (msg, rinfo) => {
    console.log(`[Client] Received ${msg.length} bytes from ${rinfo.address}:${rinfo.port}`);

    try {
      const recvBytes = clientConn.recv(msg, `${rinfo.address}:${rinfo.port}`);
      console.log(`[Client] recv() processed ${recvBytes} bytes`);
    } catch (e) {
      console.log(`[Client] recv() error: ${e.message}`);
    }

    console.log(`[Client] isEstablished: ${clientConn.isEstablished()}, isClosed: ${clientConn.isClosed()}, isDraining: ${clientConn.isDraining()}`);

    if (clientConn.isEstablished()) {
      if (!sent) {
        console.log('[Client] Connection ESTABLISHED!');
        const ping = Buffer.from('PING');
        clientConn.dgramSend(ping);
        console.log('[Client] TX datagram: PING');
        sent = true;
      }

      // Check for response
      const buf = Buffer.allocUnsafe(1200);
      const len = clientConn.dgramRecv(buf);
      if (len !== null) {
        console.log('[Client] RX datagram:', buf.slice(0, len).toString());
        console.log('\n✅ Success!');
        process.exit(0);
      }
    }

    // Send packets
    const out = Buffer.allocUnsafe(1350);
    let sendCount = 0;
    let totalSent = 0;
    while (sendCount++ < 100) {
      const written = clientConn.send(out);
      if (written === null || written === 0) break;
      clientSocket.send(out.slice(0, written), 4435, '127.0.0.1');
      totalSent += written;
    }
    console.log(`[Client] Sent ${sendCount - 1} packets (${totalSent} bytes)\n`);
  });

  clientSocket.bind(() => {
    console.log('[Client] Socket bound, sending initial packet');
    const out = Buffer.allocUnsafe(1350);
    const written = clientConn.send(out);
    console.log(`[Client] Initial packet: ${written} bytes`);
    clientSocket.send(out.slice(0, written), 4435, '127.0.0.1');
  });

  // Handle client timeouts (critical for handshake!)
  const clientInterval = setInterval(() => {
    const timeout = clientConn.timeout();
    if (timeout !== null) {
      console.log(`[Client] Timeout handler triggered (${timeout}ms)`);
      clientConn.onTimeout();

      const out = Buffer.allocUnsafe(1350);
      let count = 0;
      while (count++ < 100) {
        const len = clientConn.send(out);
        if (len === null) break;
        clientSocket.send(out.slice(0, len), 4435, '127.0.0.1');
      }
    }

    if (clientConn.isClosed()) {
      clearInterval(clientInterval);
      clearInterval(serverInterval);
    }
  }, 10);
});

// Handle server timeouts
const serverInterval = setInterval(() => {
  if (!serverConn || !clientAddr) return;

  const timeout = serverConn.timeout();
  if (timeout !== null) {
    console.log(`[Server] Timeout handler triggered (${timeout}ms)`);
    serverConn.onTimeout();

    // Send any packets generated by timeout
    const out = Buffer.allocUnsafe(1350);
    let count = 0;
    let totalSent = 0;
    while (count++ < 100) {
      const len = serverConn.send(out);
      if (len === null) break;
      serverSocket.send(out.slice(0, len), clientAddr.port, clientAddr.address);
      totalSent += len;
    }
    if (totalSent > 0) {
      console.log(`[Server] Timeout sent ${count - 1} packets (${totalSent} bytes)`);
    }
  }

  if (serverConn.isClosed()) {
    clearInterval(serverInterval);
  }
}, 10);

setTimeout(() => {
  console.log('\n⏱️  Timeout');
  process.exit(1);
}, 5000);
