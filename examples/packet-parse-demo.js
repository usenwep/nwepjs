const { parseHeader, isVersionNegotiation, PROTOCOL_VERSION } = require('..');

console.log('=== QUIC Packet Header Parsing Demo ===\n');

// Example 1: Parse an Initial packet
console.log('Example 1: Parse Initial Packet');
console.log('--------------------------------');

// Create a simple Initial packet (this is just for demo - normally you'd receive this)
const initialPacket = Buffer.from([
  0xc0 | 0x00,  // Long header, Initial packet
  ...Buffer.from([PROTOCOL_VERSION]).slice(0, 4),  // Version
  0x08,  // DCID len
  ...Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),  // DCID
  0x08,  // SCID len
  ...Buffer.from([8, 7, 6, 5, 4, 3, 2, 1]),  // SCID
  0x00,  // Token length (0 - no token)
  // ... rest of packet would go here
]);

try {
  const header = parseHeader(initialPacket, 8);  // dcid_len = 8

  console.log('Packet type:', header.packetType);
  console.log('Version:', '0x' + header.version.toString(16));
  console.log('DCID:', header.dcid.toString('hex'));
  console.log('SCID:', header.scid.toString('hex'));
  console.log('Has token:', header.token !== null);
  console.log('');
} catch (e) {
  console.error('Parse error:', e.message);
  console.log('');
}

// Example 2: Check for version negotiation
console.log('Example 2: Version Negotiation Detection');
console.log('----------------------------------------');

// Version negotiation packet has version = 0
const versionNegPacket = Buffer.from([
  0xc0,  // Long header
  0x00, 0x00, 0x00, 0x00,  // Version 0 = version negotiation
  0x04,  // DCID len
  0x01, 0x02, 0x03, 0x04,  // DCID
  0x04,  // SCID len
  0x05, 0x06, 0x07, 0x08,  // SCID
  // Supported versions would follow...
]);

const isVerNeg = isVersionNegotiation(versionNegPacket);
console.log('Is version negotiation:', isVerNeg);
console.log('');

// Example 3: Short header packet
console.log('Example 3: Parse Short Header Packet');
console.log('------------------------------------');

const shortPacket = Buffer.from([
  0x40,  // Short header (no long header bit)
  ...Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),  // DCID (8 bytes)
  // ... packet number and payload would follow
]);

try {
  const header = parseHeader(shortPacket, 8);

  console.log('Packet type:', header.packetType);
  console.log('DCID:', header.dcid.toString('hex'));
  console.log('Is short header:', header.packetType === 'Short');
  console.log('');
} catch (e) {
  console.error('Parse error:', e.message);
  console.log('');
}

// Example 4: Real-world usage pattern
console.log('Example 4: Server-Side Packet Inspection');
console.log('----------------------------------------');

function inspectIncomingPacket(buf) {
  // First, check if it's version negotiation
  if (isVersionNegotiation(buf)) {
    console.log('⚠️  Received version negotiation packet');
    return 'version_negotiation';
  }

  try {
    // Parse the header (assuming DCID length of 8)
    const hdr = parseHeader(buf, 8);

    console.log(`📦 Received ${hdr.packetType} packet`);
    console.log(`   Version: 0x${hdr.version.toString(16)}`);
    console.log(`   DCID: ${hdr.dcid.toString('hex')}`);
    console.log(`   SCID: ${hdr.scid.toString('hex')}`);

    if (hdr.token) {
      console.log(`   Token: ${hdr.token.toString('hex')}`);
    }

    return hdr.packetType;
  } catch (e) {
    console.error('❌ Failed to parse packet:', e.message);
    return 'parse_error';
  }
}

// Simulate inspecting the initial packet from Example 1
console.log('Inspecting Initial packet:');
inspectIncomingPacket(initialPacket);
console.log('');

console.log('Inspecting Short packet:');
inspectIncomingPacket(shortPacket);
console.log('');

console.log('✅ Packet parsing demo complete!');
