const dgram = require('dgram');
const { Config, Connection, generateCid, encodeAlpn, PROTOCOL_VERSION } = require('..');

// Configuration
const PORT = 4433;

// Create server config
const serverConfig = new Config(PROTOCOL_VERSION);
serverConfig.loadCertChainFromPemFile('../quiche/examples/cert.crt');
serverConfig.loadPrivKeyFromPemFile('../quiche/examples/cert.key');
serverConfig.setApplicationProtos(encodeAlpn(['echo']));
serverConfig.setInitialMaxData(10000000);
serverConfig.setInitialMaxStreamDataBidiLocal(1000000);
serverConfig.setInitialMaxStreamDataBidiRemote(1000000);
serverConfig.setInitialMaxStreamsBidi(100);
serverConfig.setMaxIdleTimeout(30000);

// Create server socket
const server = dgram.createSocket('udp4');

// Client tracking
const clients = new Map();

server.on('message', (msg, rinfo) => {
  const from = `${rinfo.address}:${rinfo.port}`;
  let client = clients.get(from);

  if (!client) {
    // New connection
    const scid = generateCid(16);
    const localAddr = `127.0.0.1:${PORT}`;

    const conn = Connection.accept(scid, null, localAddr, from, serverConfig);

    client = {
      conn,
      address: rinfo.address,
      port: rinfo.port,
    };
    clients.set(from, client);

    console.log(`new connection from ${from}`);
  }

  // Process incoming packet
  try {
    client.conn.recv(msg, from);
  } catch (e) {
    if (!e.message.includes('Done')) {
      console.error('recv error:', e.message);
    }
  }

  //Connection is now established, print statistics
  if (client.conn.isEstablished() && !client.statsShown) {
      console.log('\n=== Connection Statistics ===');
      const stats = client.conn.stats();
      console.log('Packets received:', stats.recv);
      console.log('Packets sent:', stats.sent);
      console.log('Packets lost:', stats.lost);
      console.log('Bytes received:', stats.recvBytes);
      console.log('Bytes sent:', stats.sentBytes);
      console.log('Paths count:', stats.pathsCount);

      console.log('\n=== Path Statistics ===');
      const pathStats = client.conn.pathStats();
      pathStats.forEach((path, index) => {
        console.log(`\nPath ${index}:`);
        console.log('  Local address:', path.localAddr);
        console.log('  Peer address:', path.peerAddr);
        console.log('  Validation state:', path.validationState);
        console.log('  Active:', path.active);
        console.log('  RTT:', path.rttMs.toFixed(2), 'ms');
        console.log('  Min RTT:', path.minRttMs ? path.minRttMs.toFixed(2) + ' ms' : 'N/A');
        console.log('  Congestion window:', path.cwnd, 'bytes');
        console.log('  PMTU:', path.pmtu, 'bytes');
        console.log('  Delivery rate:', path.deliveryRate, 'bytes/s');
        if (path.startupExit) {
          console.log('  Startup exit:');
          console.log('    Reason:', path.startupExit.reason);
          console.log('    CWND at exit:', path.startupExit.cwnd);
          if (path.startupExit.bandwidth) {
            console.log('    Bandwidth at exit:', path.startupExit.bandwidth, 'bytes/s');
          }
        }
      });
      console.log('');

      client.statsShown = true;
  }

  // Handle readable streams (echo them back)
  if (client.conn.isEstablished()) {
    const streamId = client.conn.streamReadableNext();
    if (streamId !== null) {
      const buf = Buffer.allocUnsafe(65535);
      const result = client.conn.streamRecv(streamId, buf);

      if (result.bytes > 0) {
        const data = buf.slice(0, result.bytes);
        console.log(`received ${result.bytes} bytes on stream ${streamId}`);

        if (result.fin) {
          // Echo back and close stream
          const response = Buffer.from(`echo: ${data.toString()}`);
          client.conn.streamSend(streamId, response, true);
          console.log(`sent echo response on stream ${streamId}`);

          // Print updated stats after data transfer
          console.log('\n=== Updated Statistics ===');
          const updatedStats = client.conn.stats();
          console.log('Total packets received:', updatedStats.recv);
          console.log('Total packets sent:', updatedStats.sent);
          console.log('Total bytes received:', updatedStats.recvBytes);
          console.log('Total bytes sent:', updatedStats.sentBytes);
          console.log('');
        }
      }
    }
  }

  // Send outgoing packets
    const out = Buffer.allocUnsafe(1350);
    while (true) {
      const written = client.conn.send(out);
      if (written === 0) break;

      const packet = out.slice(0, written);
      server.send(packet, client.port, client.address);
    }
});

server.on('listening', () => {
  console.log(`statistics test server listening on 127.0.0.1:${PORT}`);
  console.log('waiting for client connection...\n');
});

server.bind(PORT);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nshutting down...');
  server.close();
  process.exit(0);
});
