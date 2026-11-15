const http = require('http');
const https = require('https');
const { exec } = require('child_process');
const os = require('os');
const dns = require('dns');
const net = require('net');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3000;

// Helper to execute shell commands with timeout
function runCmd(cmd, timeout = 8000) {
  return new Promise((resolve) => {
    exec(cmd, { timeout, maxBuffer: 1024 * 1024 * 4, windowsHide: true }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        stdout: (stdout || '').toString(),
        stderr: (stderr || '').toString()
      });
    });
  });
}

// Common IEEE OUI Vendor Database + Dynamic Online OUI Cache
const OUI_DB = {
  '60:32:B1': 'TP-Link Systems Inc.',
  '50:C7:BF': 'TP-Link Systems Inc.',
  'B0:BE:76': 'TP-Link Systems Inc.',
  '14:EB:B6': 'TP-Link Systems Inc.',
  'E8:48:B8': 'TP-Link Systems Inc.',
  'C0:06:C3': 'TP-Link Systems Inc.',
  '98:DA:C4': 'TP-Link Systems Inc.',
  '48:68:4A': 'Intel Corporate',
  '8C:8D:28': 'Intel Corporate',
  'A4:34:D9': 'Intel Corporate',
  'DC:FB:48': 'Intel Corporate',
  '00:15:5D': 'Microsoft Corporation (Hyper-V)',
  '40:B0:34': 'HP Inc.',
  '3C:D9:2B': 'HP Inc.',
  'A0:B3:CC': 'HP Inc.',
  '50:C2:E8': 'Cloud Network Technology (Foxconn)',
  '68:B9:C2': 'Xiaomi Communications Co Ltd',
  '40:2F:86': 'LG Innotek / Smart Device',
  'BC:D0:74': 'Apple, Inc.',
  'F0:18:98': 'Apple, Inc.',
  'AC:BC:32': 'Apple, Inc.',
  '3C:22:FB': 'Apple, Inc.',
  'D8:BB:2C': 'Apple, Inc.',
  '28:6A:BA': 'Apple, Inc.',
  '00:1A:11': 'Google, Inc.',
  '3C:5A:B4': 'Google, Inc.',
  'F4:F5:D8': 'Google, Inc.',
  'A4:77:33': 'Google, Inc.',
  'FC:A6:67': 'Amazon Technologies Inc.',
  '44:65:0D': 'Amazon Technologies Inc.',
  '68:54:FD': 'Amazon Technologies Inc.',
  '24:FD:5B': 'Samsung Electronics Co., Ltd',
  '50:01:BB': 'Samsung Electronics Co., Ltd',
  '78:47:1D': 'Samsung Electronics Co., Ltd',
  '8C:79:F5': 'Samsung Electronics Co., Ltd',
  'E4:5F:01': 'Raspberry Pi Trading Ltd',
  'B8:27:EB': 'Raspberry Pi Foundation',
  'DC:A6:32': 'Raspberry Pi Trading Ltd',
  '24:0A:C4': 'Espressif Inc. (ESP32/IoT)',
  '30:AE:A4': 'Espressif Inc. (ESP32/IoT)',
  '84:CC:A8': 'Espressif Inc. (ESP8266/IoT)',
  '00:E0:4C': 'Realtek Semiconductor Corp.',
  '54:E1:AD': 'LCFC(HeFei) Electronics (Lenovo)',
  'F8:75:A4': 'LCFC(HeFei) Electronics (Lenovo)',
  'D4:3D:7E': 'Micro-Star INTL CO., LTD. (MSI)',
  '04:D4:C4': 'ASUSTek COMPUTER INC.',
  '2C:FD:A1': 'ASUSTek COMPUTER INC.',
  '70:8B:CD': 'ASUSTek COMPUTER INC.',
  'F0:2F:74': 'ASUSTek COMPUTER INC.',
  '18:31:BF': 'ASUSTek COMPUTER INC.',
  '9C:B6:D0': 'Rivet Networks (Killer Networking)',
  'B4:2E:99': 'Giga-Byte Technology Co., Ltd.',
  'E0:D5:5E': 'Giga-Byte Technology Co., Ltd.',
  '00:50:56': 'VMware, Inc.',
  '00:0C:29': 'VMware, Inc.',
  '08:00:27': 'Oracle VirtualBox'
};

const dynamicOuiCache = new Map();

function normalizeMac(mac) {
  if (!mac) return '';
  return mac.trim().replace(/-/g, ':').toUpperCase();
}

function isLocallyAdministeredMac(mac) {
  const norm = normalizeMac(mac);
  if (!norm || norm.length < 2) return false;
  const firstByte = parseInt(norm.slice(0, 2), 16);
  if (isNaN(firstByte)) return false;
  // Bit 1 of first octet is the U/L bit (1 = Locally Administered / Randomized)
  // Bit 0 is Unicast/Multicast (0 = Unicast)
  return (firstByte & 0b00000010) !== 0 && (firstByte & 0b00000001) === 0;
}

function getVendorSync(mac) {
  const norm = normalizeMac(mac);
  if (!norm || norm.length < 8) return { vendor: 'Unknown', isPrivateMac: false };
  if (norm === 'FF:FF:FF:FF:FF:FF') return { vendor: 'Broadcast', isPrivateMac: false };
  if (norm.startsWith('01:00:5E')) return { vendor: 'IPv4 Multicast', isPrivateMac: false };
  if (norm.startsWith('33:33:')) return { vendor: 'IPv6 Multicast', isPrivateMac: false };

  const prefix = norm.slice(0, 8);
  const isPrivate = isLocallyAdministeredMac(norm);

  if (OUI_DB[prefix]) {
    return { vendor: OUI_DB[prefix], isPrivateMac: isPrivate };
  }
  if (dynamicOuiCache.has(prefix)) {
    return { vendor: dynamicOuiCache.get(prefix), isPrivateMac: isPrivate };
  }

  // Check if it's a virtual AP BSSID derived from a known OUI (e.g. 66:32:B1 from 60:32:B1)
  if (isPrivate) {
    const firstByte = parseInt(norm.slice(0, 2), 16);
    const baseByte = (firstByte & ~0x06).toString(16).padStart(2, '0').toUpperCase();
    const basePrefix = `${baseByte}:${norm.slice(3, 8)}`;
    if (OUI_DB[basePrefix]) {
      return { vendor: `${OUI_DB[basePrefix]} (Virtual/Mesh Radio)`, isPrivateMac: true };
    }
    return { vendor: 'Private / Randomized MAC (Phone / Modern OS)', isPrivateMac: true };
  }

  return { vendor: 'Unknown Vendor', isPrivateMac: false };
}

// Lookup unknown non-private OUI from macvendors API in background
function lookupMacVendorOnline(mac) {
  return new Promise((resolve) => {
    const norm = normalizeMac(mac);
    if (!norm || norm.length < 8) return resolve(null);
    const prefix = norm.slice(0, 8);
    if (OUI_DB[prefix] || dynamicOuiCache.has(prefix) || isLocallyAdministeredMac(norm)) {
      return resolve(getVendorSync(norm).vendor);
    }

    const req = https.get(`https://api.macvendors.com/${encodeURIComponent(prefix)}`, { timeout: 2500 }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        if (res.statusCode === 200 && body && body.length < 100 && !body.includes('{')) {
          const clean = body.trim();
          dynamicOuiCache.set(prefix, clean);
          resolve(clean);
        } else {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

// Convert Wi-Fi Channel & Band to exact Frequency in MHz
function channelToFrequencyMHz(channel, bandStr = '') {
  const ch = parseInt(channel, 10);
  if (!ch || isNaN(ch)) return null;
  if (bandStr.includes('6 GHz')) {
    return 5950 + ch * 5;
  }
  if (ch >= 1 && ch <= 13 && !bandStr.includes('5 GHz')) {
    return 2407 + ch * 5;
  }
  if (ch === 14) return 2484;
  if (ch >= 32 && ch <= 177) {
    return 5000 + ch * 5;
  }
  return null;
}

// Map 802.11 Radio Type to human-readable Wi-Fi Generation
function getWifiGeneration(radioType = '') {
  const r = radioType.toLowerCase();
  if (r.includes('802.11be')) return { gen: 'Wi-Fi 7', standard: '802.11be', maxTheoreticalMbps: 46000 };
  if (r.includes('802.11ax')) return { gen: 'Wi-Fi 6 / 6E', standard: '802.11ax', maxTheoreticalMbps: 9600 };
  if (r.includes('802.11ac')) return { gen: 'Wi-Fi 5', standard: '802.11ac', maxTheoreticalMbps: 3500 };
  if (r.includes('802.11n')) return { gen: 'Wi-Fi 4', standard: '802.11n', maxTheoreticalMbps: 600 };
  if (r.includes('802.11g')) return { gen: 'Wi-Fi 3', standard: '802.11g', maxTheoreticalMbps: 54 };
  if (r.includes('802.11a')) return { gen: 'Wi-Fi 2', standard: '802.11a', maxTheoreticalMbps: 54 };
  if (r.includes('802.11b')) return { gen: 'Wi-Fi 1', standard: '802.11b', maxTheoreticalMbps: 11 };
  return { gen: 'Wi-Fi', standard: radioType || 'Unknown', maxTheoreticalMbps: 1000 };
}

// Parse `netsh wlan show interfaces`
async function getCurrentWifiInfo() {
  const { stdout } = await runCmd('netsh wlan show interfaces');
  const lines = stdout.split(/\r?\n/);
  const raw = {};

  for (const line of lines) {
    const match = line.match(/^\s*([^:]+?)\s*:\s*(.*)$/);
    if (match) {
      const key = match[1].trim();
      const val = match[2].trim();
      raw[key] = val;
    }
  }

  const signalMatch = (raw['Signal'] || '').match(/(\d+)%/);
  const signalPercent = signalMatch ? parseInt(signalMatch[1], 10) : 0;

  // Use native Rssi if available, otherwise calculate from signal %
  let rssiDbm = raw['Rssi'] ? parseInt(raw['Rssi'], 10) : null;
  if (rssiDbm === null || isNaN(rssiDbm)) {
    rssiDbm = signalPercent > 0 ? Math.round(signalPercent / 2 - 100) : -100;
  }

  const noiseFloorDbm = -95;
  const snrDb = Math.max(0, rssiDbm - noiseFloorDbm);

  let signalRating = 'Disconnected';
  if (raw['State'] === 'connected') {
    if (rssiDbm >= -55 || signalPercent >= 85) signalRating = 'Excellent';
    else if (rssiDbm >= -67 || signalPercent >= 65) signalRating = 'Good';
    else if (rssiDbm >= -78 || signalPercent >= 45) signalRating = 'Fair';
    else signalRating = 'Weak';
  }

  const channel = parseInt(raw['Channel'] || '0', 10) || null;
  const band = raw['Band'] || (channel && channel > 14 ? '5 GHz' : channel ? '2.4 GHz' : 'Unknown');
  const frequencyMHz = channelToFrequencyMHz(channel, band);
  const wavelengthCm = frequencyMHz ? +(29979.2458 / frequencyMHz).toFixed(2) : null;
  const genInfo = getWifiGeneration(raw['Radio type']);
  const bssid = normalizeMac(raw['AP BSSID'] || raw['BSSID'] || '');
  const adapterMac = normalizeMac(raw['Physical address'] || '');
  const apVendorInfo = getVendorSync(bssid);
  const adapterVendorInfo = getVendorSync(adapterMac);

  return {
    connected: raw['State'] === 'connected',
    interfaceName: raw['Name'] || 'WiFi',
    description: raw['Description'] || '',
    guid: raw['GUID'] || '',
    adapterMac,
    adapterVendor: adapterVendorInfo.vendor,
    interfaceType: raw['Interface type'] || '',
    state: raw['State'] || 'disconnected',
    ssid: raw['SSID'] || '',
    bssid,
    apVendor: apVendorInfo.vendor,
    band,
    channel,
    frequencyMHz,
    wavelengthCm,
    networkType: raw['Network type'] || '',
    radioType: raw['Radio type'] || '',
    wifiGeneration: genInfo.gen,
    authentication: raw['Authentication'] || '',
    cipher: raw['Cipher'] || '',
    akmCipher: raw['Connected Akm-cipher'] || '',
    connectionMode: raw['Connection mode'] || '',
    rxRateMbps: parseFloat(raw['Receive rate (Mbps)']) || 0,
    txRateMbps: parseFloat(raw['Transmit rate (Mbps)']) || 0,
    signalPercent,
    rssiDbm,
    noiseFloorDbm,
    snrDb,
    signalRating,
    profile: raw['Profile'] || '',
    qosMscs: raw['QoS MSCS Configured'] || '0',
    qosMap: raw['QoS Map Configured'] || '0',
    raw
  };
}

// Parse `ipconfig /all` and `os.networkInterfaces()`
async function getNetworkConfig(wifiInterfaceName = 'WiFi') {
  const { stdout } = await runCmd('ipconfig /all');
  const sections = [];
  let currentSection = null;
  let lastKey = null;

  const globalInfo = {
    hostName: os.hostname(),
    nodeType: '',
    ipRoutingEnabled: '',
    winsProxyEnabled: ''
  };

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (!line.startsWith(' ') && line.endsWith(':')) {
      currentSection = { title: line.slice(0, -1).trim(), props: {} };
      sections.push(currentSection);
      lastKey = null;
      continue;
    }

    const kv = line.match(/^\s+([^.:]+?)(?:\s*\.\s*)*:\s*(.*)$/);
    if (kv) {
      const k = kv[1].trim();
      const v = kv[2].trim();
      lastKey = k;
      if (!currentSection) {
        if (k === 'Host Name') globalInfo.hostName = v;
        if (k === 'Node Type') globalInfo.nodeType = v;
        if (k === 'IP Routing Enabled') globalInfo.ipRoutingEnabled = v;
        if (k === 'WINS Proxy Enabled') globalInfo.winsProxyEnabled = v;
      } else {
        if (currentSection.props[k]) {
          if (Array.isArray(currentSection.props[k])) {
            currentSection.props[k].push(v);
          } else {
            currentSection.props[k] = [currentSection.props[k], v];
          }
        } else {
          currentSection.props[k] = v;
        }
      }
    } else if (currentSection && lastKey && line.match(/^\s{25,}(.+)$/)) {
      const extraVal = line.trim();
      if (Array.isArray(currentSection.props[lastKey])) {
        currentSection.props[lastKey].push(extraVal);
      } else {
        currentSection.props[lastKey] = [currentSection.props[lastKey], extraVal];
      }
    }
  }

  // Find the active WiFi section
  const wifiSection = sections.find(
    (s) =>
      s.title.toLowerCase().includes(`adapter ${wifiInterfaceName.toLowerCase()}`) ||
      (s.title.toLowerCase().includes('wireless lan adapter') && s.props['IPv4 Address'])
  ) || { title: 'Wireless LAN adapter WiFi', props: {} };

  const p = wifiSection.props;
  const cleanIp = (val) => {
    if (!val) return '';
    const str = Array.isArray(val) ? val[0] : val;
    return str.replace(/\(Preferred\)/gi, '').trim();
  };

  const ipv4 = cleanIp(p['IPv4 Address']);
  const subnetMask = cleanIp(p['Subnet Mask']);
  const ipv6 = cleanIp(p['Link-local IPv6 Address'] || p['IPv6 Address']);

  const gateways = Array.isArray(p['Default Gateway'])
    ? p['Default Gateway'].filter(Boolean)
    : p['Default Gateway']
    ? [p['Default Gateway']]
    : [];
  const ipv4Gateway = gateways.find((g) => /^\d+\.\d+\.\d+\.\d+$/.test(g)) || gateways[0] || '';
  const ipv6Gateway = gateways.find((g) => g.includes(':')) || '';

  const dnsServers = Array.isArray(p['DNS Servers'])
    ? p['DNS Servers'].filter(Boolean)
    : p['DNS Servers']
    ? [p['DNS Servers']]
    : [];

  // Calculate CIDR and Subnet info
  let cidr = 24;
  let networkAddress = '';
  let broadcastAddress = '';
  if (ipv4 && subnetMask) {
    const maskParts = subnetMask.split('.').map(Number);
    cidr = maskParts.reduce((acc, oct) => acc + (oct.toString(2).match(/1/g) || []).length, 0);
    const ipParts = ipv4.split('.').map(Number);
    const netParts = ipParts.map((oct, i) => oct & maskParts[i]);
    const bcastParts = ipParts.map((oct, i) => oct | (~maskParts[i] & 255));
    networkAddress = netParts.join('.');
    broadcastAddress = bcastParts.join('.');
  }

  return {
    globalInfo,
    wifiAdapter: {
      title: wifiSection.title,
      description: p['Description'] || '',
      physicalAddress: normalizeMac(p['Physical Address'] || ''),
      dhcpEnabled: p['DHCP Enabled'] || '',
      autoconfigEnabled: p['Autoconfiguration Enabled'] || '',
      ipv4,
      subnetMask,
      cidr,
      networkAddress,
      broadcastAddress,
      ipv6,
      ipv4Gateway,
      ipv6Gateway,
      dhcpServer: p['DHCP Server'] || '',
      leaseObtained: p['Lease Obtained'] || '',
      leaseExpires: p['Lease Expires'] || '',
      dnsServers,
      netbiosOverTcpip: p['NetBIOS over Tcpip'] || '',
      dhcpv6Iaid: p['DHCPv6 IAID'] || '',
      dhcpv6ClientDuid: p['DHCPv6 Client DUID'] || ''
    },
    allAdapters: sections.map((s) => ({
      name: s.title,
      description: s.props['Description'] || '',
      mac: normalizeMac(s.props['Physical Address'] || ''),
      mediaState: s.props['Media State'] || 'Connected',
      ipv4: cleanIp(s.props['IPv4 Address']),
      ipv6: cleanIp(s.props['Link-local IPv6 Address'] || s.props['IPv6 Address']),
      subnetMask: cleanIp(s.props['Subnet Mask']),
      gateway: Array.isArray(s.props['Default Gateway'])
        ? s.props['Default Gateway'].join(', ')
        : s.props['Default Gateway'] || ''
    }))
  };
}

// Track live interface traffic delta
let lastTrafficSample = null;
async function getTrafficStats(wifiInterfaceName = 'WiFi') {
  const [subRes, netstatRes] = await Promise.all([
    runCmd('netsh interface ipv4 show subinterfaces'),
    runCmd('netstat -e')
  ]);

  let mtu = 1500;
  let bytesIn = 0;
  let bytesOut = 0;

  for (const line of subRes.stdout.split(/\r?\n/)) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
    if (m && m[5].trim().toLowerCase() === wifiInterfaceName.toLowerCase()) {
      mtu = parseInt(m[1], 10);
      bytesIn = parseInt(m[3], 10);
      bytesOut = parseInt(m[4], 10);
      break;
    }
  }

  const pktStats = {
    unicastReceived: 0,
    unicastSent: 0,
    nonUnicastReceived: 0,
    nonUnicastSent: 0,
    discards: 0,
    errors: 0
  };

  for (const line of netstatRes.stdout.split(/\r?\n/)) {
    const u = line.match(/^\s*Unicast packets\s+(\d+)\s+(\d+)/i);
    if (u) {
      pktStats.unicastReceived = parseInt(u[1], 10);
      pktStats.unicastSent = parseInt(u[2], 10);
    }
    const nu = line.match(/^\s*Non-unicast packets\s+(\d+)\s+(\d+)/i);
    if (nu) {
      pktStats.nonUnicastReceived = parseInt(nu[1], 10);
      pktStats.nonUnicastSent = parseInt(nu[2], 10);
    }
    const d = line.match(/^\s*Discards\s+(\d+)\s+(\d+)/i);
    if (d) pktStats.discards = parseInt(d[1], 10) + parseInt(d[2], 10);
    const e = line.match(/^\s*Errors\s+(\d+)\s+(\d+)/i);
    if (e) pktStats.errors = parseInt(e[1], 10) + parseInt(e[2], 10);
  }

  const now = Date.now();
  let rxBps = 0;
  let txBps = 0;
  if (lastTrafficSample && now > lastTrafficSample.timestamp && bytesIn >= lastTrafficSample.bytesIn) {
    const dtSec = (now - lastTrafficSample.timestamp) / 1000;
    rxBps = Math.round((bytesIn - lastTrafficSample.bytesIn) / dtSec);
    txBps = Math.round((bytesOut - lastTrafficSample.bytesOut) / dtSec);
  }
  lastTrafficSample = { timestamp: now, bytesIn, bytesOut };

  return {
    mtu,
    bytesIn,
    bytesOut,
    rxBytesPerSec: rxBps,
    txBytesPerSec: txBps,
    rxMbps: +((rxBps * 8) / 1_000_000).toFixed(2),
    txMbps: +((txBps * 8) / 1_000_000).toFixed(2),
    ...pktStats
  };
}

// Parse nearby Wi-Fi networks (`netsh wlan show networks mode=bssid`)
async function getNearbyNetworks(currentBssid = '') {
  const { stdout } = await runCmd('netsh wlan show networks mode=bssid');
  const networks = [];
  let currentNet = null;
  let currentBssidObj = null;

  for (const line of stdout.split(/\r?\n/)) {
    const ssidMatch = line.match(/^SSID\s+(\d+)\s*:\s*(.*)$/);
    if (ssidMatch) {
      currentNet = {
        index: parseInt(ssidMatch[1], 10),
        ssid: ssidMatch[2].trim() || '[Hidden Network]',
        isHidden: !ssidMatch[2].trim(),
        networkType: '',
        authentication: '',
        encryption: '',
        bssids: []
      };
      networks.push(currentNet);
      currentBssidObj = null;
      continue;
    }

    if (!currentNet) continue;

    const bssidMatch = line.match(/^\s+BSSID\s+(\d+)\s*:\s*(.*)$/);
    if (bssidMatch) {
      const mac = normalizeMac(bssidMatch[2]);
      const vendorInfo = getVendorSync(mac);
      currentBssidObj = {
        index: parseInt(bssidMatch[1], 10),
        bssid: mac,
        vendor: vendorInfo.vendor,
        isPrivateMac: vendorInfo.isPrivateMac,
        isConnected: mac && currentBssid && mac === normalizeMac(currentBssid),
        signalPercent: 0,
        rssiDbm: -100,
        radioType: '',
        wifiGeneration: '',
        band: '',
        channel: null,
        frequencyMHz: null,
        basicRates: '',
        otherRates: ''
      };
      currentNet.bssids.push(currentBssidObj);
      continue;
    }

    const kv = line.match(/^\s+([^:]+?)\s*:\s*(.*)$/);
    if (kv) {
      const key = kv[1].trim();
      const val = kv[2].trim();
      if (!currentBssidObj) {
        if (key === 'Network type') currentNet.networkType = val;
        if (key === 'Authentication') currentNet.authentication = val;
        if (key === 'Encryption') currentNet.encryption = val;
      } else {
        if (key === 'Signal') {
          const sm = val.match(/(\d+)%/);
          currentBssidObj.signalPercent = sm ? parseInt(sm[1], 10) : 0;
          currentBssidObj.rssiDbm = Math.round(currentBssidObj.signalPercent / 2 - 100);
        } else if (key === 'Radio type') {
          currentBssidObj.radioType = val;
          currentBssidObj.wifiGeneration = getWifiGeneration(val).gen;
        } else if (key === 'Band') {
          currentBssidObj.band = val;
        } else if (key === 'Channel') {
          currentBssidObj.channel = parseInt(val, 10) || null;
          currentBssidObj.frequencyMHz = channelToFrequencyMHz(currentBssidObj.channel, currentBssidObj.band);
        } else if (key === 'Basic rates (Mbps)') {
          currentBssidObj.basicRates = val;
        } else if (key === 'Other rates (Mbps)') {
          currentBssidObj.otherRates = val;
        }
      }
    }
  }

  // Flatten all BSSID radios for channel congestion analysis
  const allRadios = [];
  for (const net of networks) {
    for (const b of net.bssids) {
      allRadios.push({
        ssid: net.ssid,
        isHidden: net.isHidden,
        authentication: net.authentication,
        encryption: net.encryption,
        ...b
      });
    }
  }

  // Channel congestion summary
  const channelUsage24 = { 1: 0, 6: 0, 9: 0, 11: 0 };
  const channelUsage5 = { 36: 0, 40: 0, 44: 0, 48: 0, 149: 0, 153: 0, 157: 0, 161: 0 };
  for (const r of allRadios) {
    if (!r.channel) continue;
    if (r.channel <= 14) {
      channelUsage24[r.channel] = (channelUsage24[r.channel] || 0) + 1;
    } else {
      channelUsage5[r.channel] = (channelUsage5[r.channel] || 0) + 1;
    }
  }

  const best24Channel = [1, 6, 11].sort((a, b) => (channelUsage24[a] || 0) - (channelUsage24[b] || 0))[0];
  const best5Channel = [36, 40, 44, 48, 149, 153, 157, 161].sort(
    (a, b) => (channelUsage5[a] || 0) - (channelUsage5[b] || 0)
  )[0];

  return {
    totalNetworks: networks.length,
    totalRadios: allRadios.length,
    best24Channel,
    best5Channel,
    networks,
    allRadios
  };
}

// Ping a single IP quickly and return latency in ms (or null if unreachable)
async function pingHost(ip, timeoutMs = 900) {
  const { stdout } = await runCmd(`ping -n 1 -w ${timeoutMs} ${ip}`, timeoutMs + 1500);
  const timeMatch = stdout.match(/time[=<](\d+)ms/i);
  if (timeMatch) {
    return parseInt(timeMatch[1], 10);
  }
  if (/TTL=/i.test(stdout)) {
    return 1;
  }
  return null;
}

// Check if a TCP port is open on a LAN device (helps classify devices & web UIs)
function checkTcpPort(ip, port, timeoutMs = 450) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (open) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, ip);
  });
}

// Hostname cache for LAN devices
const hostnameCache = new Map();

async function resolveDeviceHostname(ip) {
  if (hostnameCache.has(ip)) return hostnameCache.get(ip);

  // Try Node DNS reverse lookup first
  try {
    const names = await Promise.race([
      dns.promises.reverse(ip),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 1200))
    ]);
    if (names && names.length > 0) {
      hostnameCache.set(ip, names[0]);
      return names[0];
    }
  } catch (_) {}

  // Fallback: Windows `ping -a -n 1 -w 400 <ip>` header line
  const { stdout } = await runCmd(`ping -a -n 1 -w 400 ${ip}`, 2000);
  const m = stdout.match(/Pinging\s+([^\s\[]+)\s+\[/i);
  if (m && m[1] && m[1] !== ip) {
    hostnameCache.set(ip, m[1]);
    return m[1];
  }

  return '';
}

// Connected Devices Scanner (`arp -a` + optional active subnet sweep)
async function scanConnectedDevices({ deepScan = false } = {}) {
  const [wifiInfo, netConfig] = await Promise.all([getCurrentWifiInfo(), getNetworkConfig()]);
  const myIp = netConfig.wifiAdapter.ipv4;
  const myMac = wifiInfo.adapterMac || netConfig.wifiAdapter.physicalAddress;
  const gatewayIp = netConfig.wifiAdapter.ipv4Gateway;

  // If deepScan is requested and we have a /24 subnet, ping all 254 IPs in parallel batches
  if (deepScan && myIp && /^\d+\.\d+\.\d+\.\d+$/.test(myIp)) {
    const prefix = myIp.split('.').slice(0, 3).join('.');
    const allIps = [];
    for (let i = 1; i <= 254; i++) {
      const target = `${prefix}.${i}`;
      if (target !== myIp) allIps.push(target);
    }

    // Batch ping 45 IPs at a time for fast ~2.5s full subnet discovery
    const batchSize = 45;
    for (let i = 0; i < allIps.length; i += batchSize) {
      const batch = allIps.slice(i, i + batchSize);
      await Promise.all(batch.map((ip) => pingHost(ip, 350)));
    }
  }

  // Read updated ARP table
  const { stdout } = await runCmd('arp -a');
  const lines = stdout.split(/\r?\n/);

  let inWifiInterface = false;
  const rawDevices = new Map();

  // Add this PC first
  if (myIp) {
    rawDevices.set(myIp, {
      ip: myIp,
      mac: myMac,
      arpType: 'local',
      role: 'This PC',
      isSelf: true,
      isGateway: false
    });
  }

  const subnetPrefix = myIp ? myIp.split('.').slice(0, 3).join('.') + '.' : '';

  for (const line of lines) {
    const ifaceMatch = line.match(/^Interface:\s*(\d+\.\d+\.\d+\.\d+)/i);
    if (ifaceMatch) {
      inWifiInterface = myIp ? ifaceMatch[1] === myIp : true;
      continue;
    }

    if (!inWifiInterface && myIp) continue;

    const entryMatch = line.trim().match(/^(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F-]{17})\s+(\w+)/);
    if (entryMatch) {
      const ip = entryMatch[1];
      const mac = normalizeMac(entryMatch[2]);
      const arpType = entryMatch[3].toLowerCase();

      // Skip multicast and broadcast addresses
      if (ip.endsWith('.255') || ip.startsWith('224.') || ip.startsWith('239.') || mac === 'FF:FF:FF:FF:FF:FF') {
        continue;
      }
      if (subnetPrefix && !ip.startsWith(subnetPrefix)) continue;

      const isGateway = ip === gatewayIp;
      rawDevices.set(ip, {
        ip,
        mac,
        arpType,
        role: isGateway ? 'Router / Gateway' : 'Connected Device',
        isSelf: ip === myIp,
        isGateway
      });
    }
  }

  // Enrich each device concurrently (Vendor lookup, Ping latency, Hostname, Open Ports)
  const CommonPorts = [
    { port: 80, name: 'HTTP' },
    { port: 443, name: 'HTTPS' },
    { port: 53, name: 'DNS' },
    { port: 22, name: 'SSH' },
    { port: 445, name: 'SMB' },
    { port: 62078, name: 'iOS-Sync' },
    { port: 8080, name: 'Web-Alt' }
  ];

  const devices = await Promise.all(
    Array.from(rawDevices.values()).map(async (dev) => {
      if (dev.isSelf) {
        const vendorInfo = getVendorSync(dev.mac);
        return {
          ...dev,
          hostname: os.hostname(),
          vendor: vendorInfo.vendor,
          isPrivateMac: vendorInfo.isPrivateMac,
          pingMs: 0,
          online: true,
          openPorts: [],
          deviceCategory: 'Computer (This PC)'
        };
      }

      // Online OUI lookup if unknown, plus ping and hostname resolution
      const [onlineVendor, pingMs, hostname, openPortsList] = await Promise.all([
        lookupMacVendorOnline(dev.mac),
        pingHost(dev.ip, deepScan ? 800 : 500),
        resolveDeviceHostname(dev.ip),
        deepScan
          ? Promise.all(
              CommonPorts.map(async (p) => ((await checkTcpPort(dev.ip, p.port, 350)) ? p.name : null))
            ).then((res) => res.filter(Boolean))
          : Promise.resolve([])
      ]);

      const syncVendor = getVendorSync(dev.mac);
      const vendor = onlineVendor || syncVendor.vendor;
      const isPrivateMac = syncVendor.isPrivateMac;

      let deviceCategory = 'Network Client';
      if (dev.isGateway) deviceCategory = 'Wi-Fi Router / Mesh Gateway';
      else if (openPortsList.includes('iOS-Sync') || vendor.includes('Apple')) deviceCategory = 'Apple / iOS Device';
      else if (openPortsList.includes('SMB')) deviceCategory = 'Windows / File Server';
      else if (isPrivateMac) deviceCategory = 'Smartphone / Tablet (Private MAC)';
      else if (vendor.includes('Xiaomi') || vendor.includes('Samsung')) deviceCategory = 'Smartphone / Smart Device';
      else if (vendor.includes('HP') || vendor.includes('Epson') || vendor.includes('Canon')) deviceCategory = 'Printer';
      else if (vendor.includes('Espressif') || vendor.includes('Tuya')) deviceCategory = 'Smart Home / IoT';

      return {
        ...dev,
        hostname: hostname || (dev.isGateway ? 'wifi-gateway.local' : ''),
        vendor,
        isPrivateMac,
        pingMs,
        online: pingMs !== null || dev.arpType === 'dynamic',
        openPorts: openPortsList,
        deviceCategory
      };
    })
  );

  // Sort: Gateway first, This PC second, then by IP octet
  devices.sort((a, b) => {
    if (a.isGateway !== b.isGateway) return a.isGateway ? -1 : 1;
    if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
    const aLast = parseInt(a.ip.split('.')[3], 10) || 0;
    const bLast = parseInt(b.ip.split('.')[3], 10) || 0;
    return aLast - bLast;
  });

  return {
    scannedAt: new Date().toISOString(),
    deepScan,
    subnet: netConfig.wifiAdapter.networkAddress
      ? `${netConfig.wifiAdapter.networkAddress}/${netConfig.wifiAdapter.cidr}`
      : '',
    gatewayIp,
    myIp,
    totalDevices: devices.length,
    devices
  };
}

// Get Wi-Fi Driver & Saved Profiles + Current Profile Key
async function getDriverAndProfiles(currentProfileName = '') {
  const [driverRes, profilesRes] = await Promise.all([
    runCmd('netsh wlan show drivers'),
    runCmd('netsh wlan show profiles')
  ]);

  const driver = {};
  for (const line of driverRes.stdout.split(/\r?\n/)) {
    const kv = line.match(/^\s*([^:]+?)\s*:\s*(.*)$/);
    if (kv && kv[2].trim()) {
      driver[kv[1].trim()] = kv[2].trim();
    }
  }

  const profiles = [];
  for (const line of profilesRes.stdout.split(/\r?\n/)) {
    const pm = line.match(/All User Profile\s*:\s*(.+)$/i) || line.match(/User Profile\s*:\s*(.+)$/i);
    if (pm) {
      profiles.push(pm[1].trim());
    }
  }

  let activeProfileDetails = null;
  if (currentProfileName) {
    activeProfileDetails = await getProfileDetails(currentProfileName);
  }

  return {
    driver: {
      driverName: driver['Driver'] || '',
      vendor: driver['Vendor'] || '',
      provider: driver['Provider'] || '',
      date: driver['Date'] || '',
      version: driver['Version'] || '',
      infFile: driver['INF file'] || '',
      radioTypesSupported: driver['Radio types supported'] || '',
      fips140Supported: driver['FIPS 140 mode supported'] || '',
      pmf80211wSupported: driver['802.11w Management Frame Protection supported'] || '',
      wirelessDisplaySupported: driver['Wireless Display Supported'] || '',
      supportedBands: driver['Number of supported bands'] || ''
    },
    profiles,
    activeProfileDetails
  };
}

// Get specific saved Wi-Fi profile details including clear key
async function getProfileDetails(profileName) {
  if (!profileName || /["&|<>^]/.test(profileName)) return null;
  const { stdout } = await runCmd(`netsh wlan show profile name="${profileName}" key=clear`);
  const info = {
    name: profileName,
    ssid: profileName,
    connectionMode: '',
    macRandomization: '',
    authentication: '',
    cipher: '',
    securityKeyPresent: '',
    keyContent: '',
    cost: ''
  };

  for (const line of stdout.split(/\r?\n/)) {
    const kv = line.match(/^\s*([^:]+?)\s*:\s*(.*)$/);
    if (!kv) continue;
    const k = kv[1].trim();
    const v = kv[2].trim();
    if (k === 'SSID name') info.ssid = v.replace(/^"|"$/g, '');
    if (k === 'Connection mode') info.connectionMode = v;
    if (k === 'MAC Randomization') info.macRandomization = v;
    if (k === 'Authentication' && !info.authentication) info.authentication = v;
    if (k === 'Cipher' && !info.cipher) info.cipher = v;
    if (k === 'Security key') info.securityKeyPresent = v;
    if (k === 'Key Content') info.keyContent = v;
    if (k === 'Cost' && !info.cost) info.cost = v;
  }

  return info;
}

// Fetch Public IP & ISP details
function fetchJson(url, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { headers: { 'User-Agent': 'MyWiFi-Dashboard/1.0' }, timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (_) {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

let cachedPublicIp = null;
let cachedPublicIpTime = 0;

async function getPublicIpInfo(force = false) {
  if (!force && cachedPublicIp && Date.now() - cachedPublicIpTime < 120_000) {
    return cachedPublicIp;
  }

  // Try ipwho.is, then ipinfo.io, then ip-api.com
  let data = await fetchJson('https://ipwho.is/');
  if (data && data.success !== false && data.ip) {
    cachedPublicIp = {
      ip: data.ip,
      isp: (data.connection && (data.connection.isp || data.connection.org)) || data.isp || 'Unknown ISP',
      asn: (data.connection && data.connection.asn ? `AS${data.connection.asn}` : '') || '',
      city: data.city || '',
      region: data.region || '',
      country: data.country || '',
      timezone: (data.timezone && data.timezone.id) || '',
      latitude: data.latitude || null,
      longitude: data.longitude || null
    };
    cachedPublicIpTime = Date.now();
    return cachedPublicIp;
  }

  data = await fetchJson('https://ipinfo.io/json');
  if (data && data.ip) {
    cachedPublicIp = {
      ip: data.ip,
      isp: data.org || 'Unknown ISP',
      asn: (data.org && data.org.split(' ')[0]) || '',
      city: data.city || '',
      region: data.region || '',
      country: data.country || '',
      timezone: data.timezone || '',
      latitude: data.loc ? parseFloat(data.loc.split(',')[0]) : null,
      longitude: data.loc ? parseFloat(data.loc.split(',')[1]) : null
    };
    cachedPublicIpTime = Date.now();
    return cachedPublicIp;
  }

  data = await fetchJson('http://ip-api.com/json/');
  if (data && data.query) {
    cachedPublicIp = {
      ip: data.query,
      isp: data.isp || data.org || 'Unknown ISP',
      asn: data.as || '',
      city: data.city || '',
      region: data.regionName || '',
      country: data.country || '',
      timezone: data.timezone || '',
      latitude: data.lat || null,
      longitude: data.lon || null
    };
    cachedPublicIpTime = Date.now();
    return cachedPublicIp;
  }

  return { ip: 'Offline / Unreachable', isp: 'Unknown', city: '', region: '', country: '' };
}

// Perform Download Speed Test using Cloudflare / Fast CDN payload
async function runSpeedTest() {
  const testUrls = [
    'https://speed.cloudflare.com/__down?bytes=15000000',
    'https://proof.ovh.net/files/10Mb.dat'
  ];

  const pingBefore = await pingHost('1.1.1.1', 1000);
  const startTime = Date.now();
  let totalBytes = 0;

  await new Promise((resolve) => {
    const req = https.get(
      testUrls[0],
      { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 9000 },
      (res) => {
        res.on('data', (chunk) => {
          totalBytes += chunk.length;
          if (Date.now() - startTime > 6500) {
            req.destroy();
            resolve();
          }
        });
        res.on('end', () => resolve());
        res.on('error', () => resolve());
      }
    );
    req.on('error', () => resolve());
    req.on('timeout', () => {
      req.destroy();
      resolve();
    });
  });

  const elapsedSec = Math.max(0.1, (Date.now() - startTime) / 1000);
  const downloadMbps = +((totalBytes * 8) / (elapsedSec * 1_000_000)).toFixed(2);
  const pingAfter = await pingHost('1.1.1.1', 1000);

  return {
    downloadMbps,
    bytesTransferred: totalBytes,
    durationSec: +elapsedSec.toFixed(2),
    idleLatencyMs: pingBefore,
    loadedLatencyMs: pingAfter,
    timestamp: new Date().toISOString()
  };
}

// Static file server helper
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  const sendJson = (status, obj) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify(obj));
  };

  try {
    // 1. Fast Live Telemetry Endpoint (polled every 2 seconds)
    if (pathname === '/api/live') {
      const wifi = await getCurrentWifiInfo();
      const [netConfig, traffic] = await Promise.all([
        getNetworkConfig(wifi.interfaceName),
        getTrafficStats(wifi.interfaceName)
      ]);
      const gatewayIp = netConfig.wifiAdapter.ipv4Gateway;
      const [gatewayPingMs, internetPingMs] = await Promise.all([
        gatewayIp ? pingHost(gatewayIp, 700) : Promise.resolve(null),
        pingHost('1.1.1.1', 800)
      ]);

      return sendJson(200, {
        timestamp: new Date().toISOString(),
        wifi,
        network: netConfig,
        traffic,
        ping: {
          gatewayIp,
          gatewayPingMs,
          internetHost: '1.1.1.1',
          internetPingMs
        }
      });
    }

    // 2. Full Overview Snapshot (Wi-Fi + Network + Nearby Networks + Driver/Profiles + Public IP)
    if (pathname === '/api/overview') {
      const wifi = await getCurrentWifiInfo();
      const [network, traffic, nearby, driverAndProfiles, publicIp] = await Promise.all([
        getNetworkConfig(wifi.interfaceName),
        getTrafficStats(wifi.interfaceName),
        getNearbyNetworks(wifi.bssid),
        getDriverAndProfiles(wifi.profile || wifi.ssid),
        getPublicIpInfo()
      ]);

      return sendJson(200, {
        timestamp: new Date().toISOString(),
        wifi,
        network,
        traffic,
        nearby,
        driverAndProfiles,
        publicIp
      });
    }

    // 3. Connected Devices Scanner (`/api/devices?deep=true`)
    if (pathname === '/api/devices') {
      const deepScan = parsedUrl.searchParams.get('deep') === 'true';
      const devicesData = await scanConnectedDevices({ deepScan });
      return sendJson(200, devicesData);
    }

    // 4. Nearby Wi-Fi Networks & Channel Congestion (`/api/nearby`)
    if (pathname === '/api/nearby') {
      const wifi = await getCurrentWifiInfo();
      const nearby = await getNearbyNetworks(wifi.bssid);
      return sendJson(200, nearby);
    }

    // 5. Inspect a Saved Wi-Fi Profile (`/api/profile?name=...`)
    if (pathname === '/api/profile') {
      const name = parsedUrl.searchParams.get('name') || '';
      const details = await getProfileDetails(name);
      return sendJson(200, { profile: details });
    }

    // 6. Run Speed Test (`/api/speedtest`)
    if (pathname === '/api/speedtest') {
      const result = await runSpeedTest();
      return sendJson(200, result);
    }

    // 7. Public IP Refresh (`/api/public-ip`)
    if (pathname === '/api/public-ip') {
      const info = await getPublicIpInfo(true);
      return sendJson(200, info);
    }

    // Serve Static Frontend Files from /public
    let safePath = pathname === '/' ? '/index.html' : pathname;
    const filePath = path.join(__dirname, 'public', path.normalize(safePath));
    if (!filePath.startsWith(path.join(__dirname, 'public'))) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Not Found');
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache'
      });
      res.end(content);
    });
  } catch (error) {
    sendJson(500, { error: error.message || 'Internal Server Error' });
  }
});

server.listen(PORT, () => {
  console.log(`Net-Radar Dashboard running at http://localhost:${PORT}`);
});
