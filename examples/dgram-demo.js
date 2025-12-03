const dgram = require('dgram');
const { Config, Connection, generateCid, encodeAlpn, PROTOCOL_VERSION } = require('..');

console.log('=== QUIC Datagrams Demo (Ping-Pong) ===\n');

const SERVER_PORT = 4434;
let serverConn = null;
let clientConn = null;
let serverEstablished = false;

// Create server
const serverSocket = dgram.createSocket('udp4');
const serverConfig = new Config(PROTOCOL_VERSION);
serverConfig.loadCertChainFromPemFile('../quiche/examples/cert.crt');
serverConfig.loadPrivKeyFromPemFile('../quiche/examples/cert.key');
serverConfig.setApplicationProtos(encodeAlpn(['dgram-demo']));
serverConfig.setInitialMaxData(1000000);
serverConfig.setInitialMaxStreamDataBidiLocal(1000000);
serverConfig.setInitialMaxStreamDataBidiRemote(1000000);
serverConfig.setMaxIdleTimeout(5000);

// IMPORTANT: Enable datagrams!
serverConfig.enableDgram(true, 10, 10);  // enable=true, recv_queue=10, send_queue=10

console.log('✓ Server config created with datagrams enabled');

serverSocket.on('message', (msg, rinfo) => {
  if (!serverConn) {
    const scid = generateCid(16);
    const from = `${rinfo.address}:${rinfo.port}`;
    serverConn = Connection.accept(scid, null, `127.0.0.1:${SERVER_PORT}`, from, serverConfig);
    console.log('✓ Server: Connection accepted');
  }

  try {
    serverConn.recv(msg, `${rinfo.address}:${rinfo.port}`);
  } catch (e) {
    if (!e.message.includes('Done')) {
      console.error('Server recv error:', e.message);
    }
  }

  if (serverConn.isEstablished()) {
    if (!serverEstablished) {
      console.log('✓ Server: Connection established\n');
      serverEstablished = true;
    }

    // Check for incoming datagrams
    const recvBuf = Buffer.allocUnsafe(1200);
    const len = serverConn.dgramRecv(recvBuf);

    if (len !== null) {
      const data = recvBuf.slice(0, len);
      console.log(`📨 Server received datagram (${len} bytes):`, data.toString());

      // Echo back with "PONG: " prefix
      const response = Buffer.from('PONG: ' + data.toString());
      try {
        serverConn.dgramSend(response);
        console.log(`📤 Server sent datagram (${response.length} bytes):`, response.toString());
      } catch (e) {
        console.error('Server dgram send error:', e.message);
      }
    }
  }

  // Send packets
  const out = Buffer.allocUnsafe(1350);
  while (true) {
    const written = serverConn.send(out);
    if (written === 0) break;
    serverSocket.send(out.slice(0, written), rinfo.port, rinfo.address);
  }
});

serverSocket.on('listening', () => {
  console.log(`✓ Server listening on 127.0.0.1:${SERVER_PORT}\n`);

  // Now start client
  startClient();
});

function startClient() {
  const clientSocket = dgram.createSocket('udp4');

  const clientConfig = new Config(PROTOCOL_VERSION);
  clientConfig.setApplicationProtos(encodeAlpn(['dgram-demo']));
  clientConfig.setInitialMaxData(1000000);
  clientConfig.setInitialMaxStreamDataBidiLocal(1000000);
  clientConfig.setInitialMaxStreamDataBidiRemote(1000000);
  clientConfig.setMaxIdleTimeout(5000);
  clientConfig.verifyPeer(false);

  // IMPORTANT: Enable datagrams!
  clientConfig.enableDgram(true, 10, 10);

  console.log('✓ Client config created with datagrams enabled\n');

  let pingCount = 0;
  const MAX_PINGS = 3;
  let clientEstablished = false;

  clientSocket.on('message', (msg, rinfo) => {
    try {
      clientConn.recv(msg, `${rinfo.address}:${rinfo.port}`);
    } catch (e) {
      if (!e.message.includes('Done')) {
        console.error('Client recv error:', e.message);
      }
    }

    if (clientConn.isEstablished()) {
      if (!clientEstablished) {
        console.log('✓ Client: Connection established\n');
        clientEstablished = true;
      }

      // Send a ping datagram
      if (pingCount < MAX_PINGS && clientConn.dgramSendQueueLen() === 0) {
        pingCount++;
        const ping = Buffer.from(`PING #${pingCount}`);

        const maxLen = clientConn.dgramMaxWritableLen();
        console.log(`📊 Max datagram size: ${maxLen} bytes`);

        try {
          clientConn.dgramSend(ping);
          console.log(`📤 Client sent datagram (${ping.length} bytes):`, ping.toString());
        } catch (e) {
          console.error('Client dgram send error:', e.message);
        }
      }

      // Check for incoming datagrams (PONGs)
      const recvBuf = Buffer.allocUnsafe(1200);
      const len = clientConn.dgramRecv(recvBuf);

      if (len !== null) {
        const data = recvBuf.slice(0, len);
        console.log(`📨 Client received datagram (${len} bytes):`, data.toString());

        // Show queue stats
        console.log(`📊 Send queue: ${clientConn.dgramSendQueueLen()} datagrams, ${clientConn.dgramSendQueueByteSize()} bytes`);
        console.log(`📊 Recv queue: ${clientConn.dgramRecvQueueLen()} datagrams, ${clientConn.dgramRecvQueueByteSize()} bytes`);
      }

      // Done after receiving all PONGs
      if (pingCount >= MAX_PINGS && clientConn.dgramRecvQueueLen() === 0) {
        console.log('\n✅ Datagram ping-pong complete!');
        setTimeout(() => {
          clientSocket.close();
          serverSocket.close();
          process.exit(0);
        }, 500);
      }
    }

    // Send packets
    const out = Buffer.allocUnsafe(1350);
    while (true) {
      const written = clientConn.send(out);
      if (written === 0) break;
      clientSocket.send(out.slice(0, written), SERVER_PORT, '127.0.0.1');
    }
  });

  clientSocket.bind(() => {
    const localPort = clientSocket.address().port;
    console.log(`✓ Client bound to port ${localPort}\n`);

    // Create connection after socket is bound
    const scid = generateCid(16);
    clientConn = Connection.connect(scid, `127.0.0.1:${localPort}`,
                                     `127.0.0.1:${SERVER_PORT}`, clientConfig);
    console.log('📞 Client connecting to server...');

    // Send initial packet
    const out = Buffer.allocUnsafe(1350);
    const written = clientConn.send(out);
    clientSocket.send(out.slice(0, written), SERVER_PORT, '127.0.0.1');
  });
}

serverSocket.bind(SERVER_PORT);

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  process.exit(0);
});
