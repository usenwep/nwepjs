const dgram = require('dgram');
const { Config, Connection, generateCid, encodeAlpn, PROTOCOL_VERSION } = require('..');

console.log('=== Simple Datagram Test ===\n');

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

serverSocket.on('message', (msg, rinfo) => {
  if (!serverConn) {
    const scid = generateCid(16);
    serverConn = Connection.accept(scid, null, '127.0.0.1:4435', `${rinfo.address}:${rinfo.port}`, serverConfig);
    console.log('Server: accepted connection');
  }

  try {
    serverConn.recv(msg, `${rinfo.address}:${rinfo.port}`);
  } catch (e) {
    if (!e.message.includes('Done')) {
      console.error('Server recv error:', e.message);
    }
  }

  if (serverConn.isEstablished()) {
    // Try to receive datagram
    const buf = Buffer.allocUnsafe(1200);
    const len = serverConn.dgramRecv(buf);
    if (len !== null) {
      console.log('Server RX:', buf.slice(0, len).toString());
      const response = Buffer.from('PONG');
      serverConn.dgramSend(response);
      console.log('Server TX: PONG');
    }
  }

  // Send responses (with safety limit)
  const out = Buffer.allocUnsafe(1350);
  let sendCount = 0;
  while (sendCount++ < 100) {  // Safety limit to prevent infinite loop
    const written = serverConn.send(out);
    if (written === null || written === 0) break;
    serverSocket.send(out.slice(0, written), rinfo.port, rinfo.address);
  }
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
    try {
      clientConn.recv(msg, `${rinfo.address}:${rinfo.port}`);
    } catch (e) {
      if (!e.message.includes('Done')) {
        console.error('Client recv error:', e.message);
      }
    }

    if (clientConn.isEstablished()) {
      if (!sent) {
        console.log('Client: established');
        const ping = Buffer.from('PING');
        clientConn.dgramSend(ping);
        console.log('Client TX: PING');
        sent = true;
      }

      // Check for response
      const buf = Buffer.allocUnsafe(1200);
      const len = clientConn.dgramRecv(buf);
      if (len !== null) {
        console.log('Client RX:', buf.slice(0, len).toString());
        console.log('\n✅ Success!');
        process.exit(0);
      }
    }

    // Send packets (with safety limit)
    const out = Buffer.allocUnsafe(1350);
    let sendCount = 0;
    while (sendCount++ < 100) {  // Safety limit to prevent infinite loop
      const written = clientConn.send(out);
      if (written === null || written === 0) break;
      clientSocket.send(out.slice(0, written), 4435, '127.0.0.1');
    }
  });

  clientSocket.bind(() => {
    const out = Buffer.allocUnsafe(1350);
    const written = clientConn.send(out);
    clientSocket.send(out.slice(0, written), 4435, '127.0.0.1');
  });
});

setTimeout(() => {
  console.log('\n⏱️  Timeout');
  process.exit(1);
}, 5000);
