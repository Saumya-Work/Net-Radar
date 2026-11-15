// State management
const state = {
  liveEnabled: true,
  liveTimer: null,
  maxHistory: 40,
  signalHistory: [],
  pingHistory: [],
  devices: [],
  nearby: null,
  mesh: null,
  signalFilter: 'all',
  pendingConnectNet: null,
  lastOverview: null,
  activeProfile: null,
  passwordVisible: false
};

// Formatters
function formatBytes(bytes) {
  if (!bytes || isNaN(bytes)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(i > 1 ? 2 : 1)} ${units[i]}`;
}

function formatRateBps(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec < 10) return '0.0 KB/s';
  if (bytesPerSec >= 1024 * 1024) {
    return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s (${((bytesPerSec * 8) / 1e6).toFixed(1)} Mbps)`;
  }
  return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getSignalColor(pct) {
  if (pct >= 80) return '#10b981';
  if (pct >= 60) return '#06b6d4';
  if (pct >= 40) return '#f59e0b';
  return '#ef4444';
}

// Update Hero & Detailed UI from Wi-Fi + Network + Traffic data
function renderTelemetry(data) {
  const { wifi, network, traffic, ping, publicIp, driverAndProfiles } = data;
  if (!wifi) return;

  const pill = document.getElementById('connectionPill');
  const pillText = document.getElementById('pillText');
  if (wifi.connected) {
    pill.className = 'status-pill connected';
    pillText.textContent = `Connected • ${wifi.ssid} • ${wifi.band} (Ch ${wifi.channel || '--'})`;
  } else {
    pill.className = 'status-pill disconnected';
    pillText.textContent = 'Wi-Fi Disconnected';
  }

  // Hero 1: Signal Gauge
  const pct = wifi.signalPercent || 0;
  const arc = document.getElementById('gaugeArc');
  const maxArc = 251.2;
  const offset = maxArc - (pct / 100) * maxArc;
  arc.style.strokeDashoffset = offset.toFixed(1);
  arc.style.stroke = getSignalColor(pct);

  document.getElementById('heroSignalPercent').textContent = `${pct}%`;
  document.getElementById('heroRssiDbm').textContent = `${wifi.rssiDbm} dBm`;
  document.getElementById('heroSnr').textContent = `~${wifi.snrDb} dB`;
  document.getElementById('heroBandChannel').textContent = `${wifi.band} • Ch ${wifi.channel || '--'}`;
  document.getElementById('heroFrequency').textContent = wifi.frequencyMHz ? `${wifi.frequencyMHz} MHz` : '--';

  const ratingBadge = document.getElementById('signalRatingBadge');
  ratingBadge.textContent = wifi.signalRating;
  ratingBadge.className = `rating-badge ${wifi.signalRating.toLowerCase()}`;

  // Hero 2: Link Speed & Traffic
  document.getElementById('wifiGenBadge').textContent = `${wifi.wifiGeneration} (${wifi.radioType || '802.11'})`;
  document.getElementById('heroRxRate').textContent = wifi.rxRateMbps || '--';
  document.getElementById('heroTxRate').textContent = wifi.txRateMbps || '--';

  if (traffic) {
    document.getElementById('liveRxSpeed').textContent = formatRateBps(traffic.rxBytesPerSec);
    document.getElementById('liveTxSpeed').textContent = formatRateBps(traffic.txBytesPerSec);
    document.getElementById('heroBytesIn').textContent = formatBytes(traffic.bytesIn);
    document.getElementById('heroBytesOut').textContent = formatBytes(traffic.bytesOut);
    document.getElementById('heroPktErrors').textContent = `${traffic.errors || 0} err / ${traffic.discards || 0} drop`;
  }

  // Hero 3: AP & Local IP
  document.getElementById('heroSsid').textContent = wifi.ssid || 'Not Connected';
  document.getElementById('heroBssid').textContent = wifi.bssid || '--';
  document.getElementById('heroApVendor').textContent = wifi.apVendor || 'Unknown';
  document.getElementById('heroSecurity').textContent = `${wifi.authentication || '--'} (${wifi.cipher || '--'})`;

  if (network && network.wifiAdapter) {
    const wa = network.wifiAdapter;
    document.getElementById('heroLocalIp').textContent = wa.ipv4 ? `${wa.ipv4}/${wa.cidr}` : '--';
    document.getElementById('heroGatewayIp').textContent = wa.ipv4Gateway || '--';
    const routerLink = document.getElementById('routerAdminLink');
    if (wa.ipv4Gateway) {
      routerLink.href = `http://${wa.ipv4Gateway}`;
      routerLink.style.display = 'inline-block';
    } else {
      routerLink.style.display = 'none';
    }
  }

  // Hero 4: Ping & Public IP
  if (ping) {
    document.getElementById('liveGatewayPing').textContent = ping.gatewayPingMs !== null ? ping.gatewayPingMs : 'Timeout';
    document.getElementById('liveInternetPing').textContent = ping.internetPingMs !== null ? ping.internetPingMs : 'Timeout';

    state.pingHistory.push({
      time: new Date().toLocaleTimeString(),
      gatewayMs: ping.gatewayPingMs ?? 0,
      internetMs: ping.internetPingMs ?? 0
    });
    if (state.pingHistory.length > state.maxHistory) state.pingHistory.shift();

    if (state.pingHistory.length >= 2) {
      let diffs = 0;
      for (let i = 1; i < state.pingHistory.length; i++) {
        diffs += Math.abs(state.pingHistory[i].gatewayMs - state.pingHistory[i - 1].gatewayMs);
      }
      const jitter = (diffs / (state.pingHistory.length - 1)).toFixed(1);
      document.getElementById('liveJitter').textContent = `${jitter} ms`;
    }
  }

  if (publicIp) {
    document.getElementById('heroPublicIp').textContent = publicIp.ip || '--';
    document.getElementById('heroIsp').textContent = publicIp.isp || '--';
    const loc = [publicIp.city, publicIp.region, publicIp.country].filter(Boolean).join(', ');
    document.getElementById('heroLocation').textContent = loc || '--';
  }

  state.signalHistory.push({
    time: new Date().toLocaleTimeString(),
    signal: wifi.signalPercent || 0,
    rssi: wifi.rssiDbm || -100,
    rxRate: wifi.rxRateMbps || 0,
    txRate: wifi.txRateMbps || 0
  });
  if (state.signalHistory.length > state.maxHistory) state.signalHistory.shift();

  drawSignalChart();
  drawPingChart();
  renderDetailedLists(wifi, network, traffic, driverAndProfiles);

  document.getElementById('lastUpdatedText').textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
}

// Render Satellite Mesh Topology & Node Inspector
function renderMeshSection(mesh) {
  if (!mesh) return;
  state.mesh = mesh;

  const nodes = mesh.nodes || [];
  document.getElementById('navMeshCount').textContent = nodes.length;
  document.getElementById('meshSummaryBadge').textContent = `${nodes.length} Mesh Nodes (1 Main + ${mesh.satelliteCount} Satellite${mesh.satelliteCount === 1 ? '' : 's'})`;
  document.getElementById('meshRoamingText').textContent = mesh.roamingAdvice || 'Mesh topology active.';

  const grid = document.getElementById('meshNodesGrid');
  if (nodes.length === 0) {
    grid.innerHTML = `<div class="empty-cell">No mesh nodes detected. Click "Hardware Scan Mesh Satellites" to rescan.</div>`;
    return;
  }

  const renderRadioItem = (label, radio, isBackhaul = false) => {
    if (!radio) {
      return `
      <div class="mesh-radio-row" style="opacity:0.55;">
        <div><strong>${escapeHtml(label)}</strong></div>
        <div><span style="color:#94a3b8;">Out of range or not broadcasting in current scan</span></div>
      </div>`;
    }
    const col = getSignalColor(radio.signalPercent);
    return `
    <div class="mesh-radio-row ${isBackhaul ? 'backhaul-row' : ''}">
      <div>
        <strong>${escapeHtml(label)}</strong>
        ${radio.isConnected ? '<span class="role-badge self" style="margin-left:6px;">Active Link</span>' : ''}
        <div style="font-size:0.74rem;color:#94a3b8;margin-top:2px;">
          BSSID: <code>${escapeHtml(radio.bssid)}</code> • ${escapeHtml(radio.band)} Ch ${radio.channel || '--'} (${radio.frequencyMHz ? `${radio.frequencyMHz} MHz` : '--'}) • ${escapeHtml(radio.wifiGeneration || radio.radioType)}
        </div>
      </div>
      <div class="sig-bar-wrap">
        <div class="sig-bar">
          <div class="sig-bar-fill" style="width:${radio.signalPercent}%;background:${col};"></div>
        </div>
        <strong style="color:${col};">${radio.signalPercent}%</strong>
        <span style="color:#94a3b8;font-size:0.75rem;">(${radio.rssiDbm} dBm)</span>
      </div>
    </div>`;
  };

  grid.innerHTML = nodes
    .map((node) => {
      const icon = node.isMainGateway ? '👑' : '🛰️';
      const badgeClass = node.isMainGateway ? 'gateway' : 'self';
      const portsHtml = (node.openPorts || [])
        .map((p) => `<span class="port-pill">${escapeHtml(p)}</span>`)
        .join(' ');

      const backhaulHtml =
        node.backhaulRadios && node.backhaulRadios.length > 0
          ? node.backhaulRadios
              .map((br) => renderRadioItem(`🛰️ Hidden Mesh Backhaul (${br.band})`, br, true))
              .join('')
          : `<div class="mesh-radio-row backhaul-row">
              <div><strong>🛰️ Dedicated Mesh Backhaul</strong></div>
              <div style="font-size:0.76rem;color:#c4b5fd;">Linked via TP-Link Deco TMP Mesh Port 20001 / 5 GHz Backhaul</div>
            </div>`;

      return `
      <div class="mesh-node-card ${node.isConnectedNode ? 'active-node' : ''}">
        <div class="mesh-node-top">
          <div>
            <div class="mesh-node-title">
              <span>${icon} ${escapeHtml(node.nodeName)}</span>
              <span class="role-badge ${badgeClass}">${escapeHtml(node.nodeRole)}</span>
            </div>
            <div style="font-size:0.78rem;color:#94a3b8;margin-top:3px;">
              Vendor: <strong>${escapeHtml(node.vendor)}</strong> • Hardware Unit Base: <code>${escapeHtml(node.unitKey)}</code>
            </div>
          </div>
          <div style="text-align:right;">
            ${
              node.isConnectedNode
                ? '<span class="role-badge client">● This PC Associated Here</span>'
                : '<span class="tag-badge">Mesh Roaming Peer</span>'
            }
            ${
              node.webUiUrl
                ? `<div style="margin-top:5px;"><a href="${escapeHtml(node.webUiUrl)}" target="_blank" rel="noopener" class="router-link">Node Admin UI ↗</a></div>`
                : ''
            }
          </div>
        </div>

        <div class="mesh-meta-grid">
          <div>
            <span>Node LAN IPv4</span>
            <strong><code>${escapeHtml(node.ip)}</code></strong>
          </div>
          <div>
            <span>LAN MAC Address</span>
            <strong><code>${escapeHtml(node.lanMac)}</code></strong>
          </div>
          <div>
            <span>Node Ping Latency</span>
            <strong style="color:${node.pingMs !== null && node.pingMs < 15 ? '#34d399' : '#fbbf24'};">
              ${node.pingMs !== null ? `${node.pingMs} ms (Online)` : 'Wireless Active'}
            </strong>
          </div>
        </div>

        <div class="mesh-radios-list">
          ${renderRadioItem('📶 2.4 GHz Client Radio', node.client24GHz)}
          ${renderRadioItem('🚀 5 GHz Client Radio', node.client5GHz)}
          ${backhaulHtml}
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;font-size:0.76rem;color:#94a3b8;padding-top:4px;">
          <div>Active Mesh Services: ${portsHtml || '<span class="port-pill">802.11 Mesh Radio</span>'}</div>
          <div>Peak Signal: <strong style="color:#f8fafc;">${node.bestSignalPercent}% (${node.bestRssiDbm ?? '--'} dBm)</strong></div>
        </div>
      </div>`;
    })
    .join('');
}

// Render 3-Column Detailed KV Properties & All Adapters Table
function renderDetailedLists(wifi, network, traffic, driverAndProfiles) {
  const wifiProps = [
    ['Connection State', wifi.state],
    ['Network SSID', wifi.ssid],
    ['Access Point BSSID', wifi.bssid],
    ['Mesh Hardware Unit Key', wifi.apUnitKey],
    ['AP Hardware Vendor', wifi.apVendor],
    ['Wi-Fi Generation', `${wifi.wifiGeneration} (${wifi.radioType})`],
    ['Frequency Band', wifi.band],
    ['Channel Number', wifi.channel],
    ['Center Frequency', wifi.frequencyMHz ? `${wifi.frequencyMHz} MHz` : '--'],
    ['Signal Wavelength', wifi.wavelengthCm ? `${wifi.wavelengthCm} cm` : '--'],
    ['Signal Quality', `${wifi.signalPercent}% (${wifi.signalRating})`],
    ['Exact RSSI', `${wifi.rssiDbm} dBm`],
    ['Est. Noise Floor / SNR', `${wifi.noiseFloorDbm} dBm / +${wifi.snrDb} dB`],
    ['Receive Rate (RX Link)', `${wifi.rxRateMbps} Mbps`],
    ['Transmit Rate (TX Link)', `${wifi.txRateMbps} Mbps`],
    ['Authentication', wifi.authentication],
    ['Encryption Cipher', wifi.cipher],
    ['AKM-Cipher Suite', wifi.akmCipher],
    ['Network Type', wifi.networkType],
    ['Connection Mode', wifi.connectionMode],
    ['Active Profile Name', wifi.profile],
    ['Interface GUID', wifi.guid]
  ];

  document.getElementById('wifiPropsList').innerHTML = wifiProps
    .map(
      ([k, v]) => `
      <div class="kv-row">
        <span class="kv-key">${escapeHtml(k)}</span>
        <span class="kv-val">${escapeHtml(v || '--')}</span>
      </div>`
    )
    .join('');

  if (network && network.wifiAdapter) {
    const wa = network.wifiAdapter;
    const g = network.globalInfo || {};
    const ipProps = [
      ['PC Hostname', g.hostName],
      ['Adapter MAC Address', wa.physicalAddress || wifi.adapterMac],
      ['Adapter Vendor', wifi.adapterVendor],
      ['IPv4 Address', wa.ipv4 ? `${wa.ipv4} (/${wa.cidr})` : '--'],
      ['Subnet Mask', wa.subnetMask],
      ['Network / Subnet ID', wa.networkAddress ? `${wa.networkAddress}/${wa.cidr}` : '--'],
      ['Broadcast Address', wa.broadcastAddress],
      ['IPv6 Link-Local Address', wa.ipv6],
      ['Default Gateway (IPv4)', wa.ipv4Gateway],
      ['Default Gateway (IPv6)', wa.ipv6Gateway],
      ['DHCP Enabled', wa.dhcpEnabled],
      ['DHCP Server', wa.dhcpServer],
      ['DHCP Lease Obtained', wa.leaseObtained],
      ['DHCP Lease Expires', wa.leaseExpires],
      ['DNS Servers', (wa.dnsServers || []).join(', ')],
      ['NetBIOS over TCP/IP', wa.netbiosOverTcpip],
      ['DHCPv6 IAID', wa.dhcpv6Iaid],
      ['DHCPv6 Client DUID', wa.dhcpv6ClientDuid],
      ['Node Type / IP Routing', `${g.nodeType || '--'} / ${g.ipRoutingEnabled || 'No'}`]
    ];

    document.getElementById('ipPropsList').innerHTML = ipProps
      .map(
        ([k, v]) => `
        <div class="kv-row">
          <span class="kv-key">${escapeHtml(k)}</span>
          <span class="kv-val">${escapeHtml(v || '--')}</span>
        </div>`
      )
      .join('');
  }

  const drv = (driverAndProfiles && driverAndProfiles.driver) || state.lastOverview?.driverAndProfiles?.driver || {};
  const t = traffic || {};
  const driverProps = [
    ['Wi-Fi Adapter Model', wifi.description || drv.driverName],
    ['Hardware Vendor', drv.vendor || wifi.adapterVendor],
    ['Driver Version', drv.version],
    ['Driver Date', drv.date],
    ['Driver INF File', drv.infFile],
    ['Supported 802.11 Radios', drv.radioTypesSupported],
    ['802.11w PMF Protection', drv.pmf80211wSupported],
    ['FIPS 140-2 Mode Support', drv.fips140Supported],
    ['Miracast / Wireless Display', drv.wirelessDisplaySupported],
    ['Interface MTU Size', t.mtu ? `${t.mtu} bytes` : '1500 bytes'],
    ['Total Bytes Received', formatBytes(t.bytesIn)],
    ['Total Bytes Sent', formatBytes(t.bytesOut)],
    ['Unicast Packets (RX / TX)', `${(t.unicastReceived || 0).toLocaleString()} / ${(t.unicastSent || 0).toLocaleString()}`],
    ['Non-Unicast Packets (RX / TX)', `${(t.nonUnicastReceived || 0).toLocaleString()} / ${(t.nonUnicastSent || 0).toLocaleString()}`],
    ['Packet Discards / Errors', `${t.discards || 0} / ${t.errors || 0}`]
  ];

  document.getElementById('driverPropsList').innerHTML = driverProps
    .map(
      ([k, v]) => `
      <div class="kv-row">
        <span class="kv-key">${escapeHtml(k)}</span>
        <span class="kv-val">${escapeHtml(v || '--')}</span>
      </div>`
    )
    .join('');

  if (network && Array.isArray(network.allAdapters)) {
    document.getElementById('adaptersTableBody').innerHTML = network.allAdapters
      .map((a) => {
        const isConnected = a.ipv4 || !String(a.mediaState).toLowerCase().includes('disconnected');
        return `
        <tr class="${a.name.includes('WiFi') ? 'highlight-row' : ''}">
          <td><strong>${escapeHtml(a.name)}</strong></td>
          <td>${escapeHtml(a.description)}</td>
          <td><code>${escapeHtml(a.mac || '--')}</code></td>
          <td>
            <span class="role-badge ${isConnected ? 'client' : ''}">
              ${isConnected ? '● Connected' : '○ Disconnected'}
            </span>
          </td>
          <td><code>${escapeHtml(a.ipv4 || '--')}</code></td>
          <td>${escapeHtml(a.subnetMask || '--')}</td>
          <td>${escapeHtml(a.gateway || '--')}</td>
        </tr>`;
      })
      .join('');
  }
}

// Render Connected Devices Table
function renderDevicesTable() {
  const tbody = document.getElementById('devicesTableBody');
  const filter = (document.getElementById('deviceSearchInput').value || '').trim().toLowerCase();

  const filtered = state.devices.filter((d) => {
    if (!filter) return true;
    const hay = `${d.ip} ${d.mac} ${d.vendor} ${d.hostname} ${d.role} ${d.deviceCategory}`.toLowerCase();
    return hay.includes(filter);
  });

  document.getElementById('devicesCountBadge').textContent = `${state.devices.length} devices`;
  document.getElementById('navDeviceCount').textContent = state.devices.length;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">No matching devices found.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map((d) => {
      let badgeClass = 'client';
      if (d.isGateway) badgeClass = 'gateway';
      else if (d.isSatellite || d.isSelf) badgeClass = 'self';

      const pingText =
        d.isSelf
          ? '<span style="color:#22d3ee;font-weight:700;">0 ms (Local)</span>'
          : d.pingMs !== null
          ? `<span style="color:${d.pingMs < 20 ? '#34d399' : d.pingMs < 80 ? '#fbbf24' : '#f87171'};font-weight:700;">${d.pingMs} ms</span>`
          : '<span style="color:#94a3b8;">ARP Active (ICMP Blocked)</span>';

      const portsHtml = (d.openPorts || [])
        .map((p) => `<span class="port-pill">${escapeHtml(p)}</span>`)
        .join('');

      const webLink =
        d.isGateway || d.isSatellite || (d.openPorts && (d.openPorts.includes('HTTP') || d.openPorts.includes('HTTPS')))
          ? ` <a href="http://${escapeHtml(d.ip)}" target="_blank" rel="noopener" class="router-link">Open ↗</a>`
          : '';

      const wolBtn =
        !d.isSelf && !d.isGateway && !d.isSatellite && d.mac
          ? ` <button class="btn btn-xs btn-secondary wol-btn" data-mac="${escapeHtml(d.mac)}" title="Send Wake-on-LAN Magic Packet">⚡ Wake</button>`
          : '';

      return `
      <tr class="${d.isSelf || d.isGateway || d.isSatellite ? 'highlight-row' : ''}">
        <td>
          <span class="role-badge ${badgeClass}">
            ${d.isGateway ? '👑' : d.isSatellite ? '🛰️' : '●'} ${escapeHtml(d.role)}
          </span>
        </td>
        <td>
          <code>${escapeHtml(d.ip)}</code>${webLink}
        </td>
        <td><strong>${escapeHtml(d.hostname || '—')}</strong></td>
        <td>
          <code>${escapeHtml(d.mac || '—')}</code>
          ${d.isPrivateMac ? '<span class="private-mac-tag" title="Locally Administered / Randomized Private Wi-Fi MAC">Private MAC</span>' : ''}
        </td>
        <td>${escapeHtml(d.vendor || 'Unknown')}</td>
        <td>
          <div>${escapeHtml(d.deviceCategory || 'Network Client')}</div>
          ${portsHtml ? `<div style="margin-top:3px;">${portsHtml}</div>` : ''}
        </td>
        <td>${pingText}${wolBtn}</td>
      </tr>`;
    })
    .join('');

  tbody.querySelectorAll('.wol-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const mac = btn.getAttribute('data-mac');
      const res = await fetch('/api/device/wol', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mac })
      });
      const data = await res.json();
      showMgmtToast(data.message, data.ok);
    });
  });
}

// Render Available Wi-Fi & Mobile Data Signals + BSSID Table + Spectrum
function renderNearbyNetworks(nearby) {
  if (!nearby) return;
  state.nearby = nearby;

  const networks = nearby.networks || [];
  const radios = nearby.allRadios || [];

  const connectableNets = networks.filter((n) => !n.isHidden);
  const wifiNets = connectableNets.filter((n) => !n.isDataHotspot && n.category !== 'Range Extender');
  const dataNets = connectableNets.filter((n) => n.isDataHotspot);
  const extNets = connectableNets.filter((n) => n.category === 'Range Extender');
  const savedNets = connectableNets.filter((n) => n.isSavedProfile || n.isConnectedNet);

  document.getElementById('countAllSignals').textContent = connectableNets.length;
  document.getElementById('countWifiSignals').textContent = wifiNets.length;
  document.getElementById('countDataSignals').textContent = dataNets.length;
  document.getElementById('countExtSignals').textContent = extNets.length;
  document.getElementById('countSavedSignals').textContent = savedNets.length;

  document.getElementById('nearbyCountBadge').textContent = `${connectableNets.length} Connectable Networks • ${radios.length} Total Radios`;
  document.getElementById('navNearbyCount').textContent = connectableNets.length;
  document.getElementById('best24Ch').textContent = `Ch ${nearby.best24Channel || 1}`;
  document.getElementById('best5Ch').textContent = `Ch ${nearby.best5Channel || 36}`;

  // Filter Connectable Signal Cards
  let filteredNets = [...connectableNets];
  if (state.signalFilter === 'wifi') filteredNets = wifiNets;
  else if (state.signalFilter === 'data') filteredNets = dataNets;
  else if (state.signalFilter === 'extender') filteredNets = extNets;
  else if (state.signalFilter === 'saved') filteredNets = savedNets;

  filteredNets.sort((a, b) => {
    if (a.isConnectedNet !== b.isConnectedNet) return a.isConnectedNet ? -1 : 1;
    if (a.isSavedProfile !== b.isSavedProfile) return a.isSavedProfile ? -1 : 1;
    return b.bestSignalPercent - a.bestSignalPercent;
  });

  const cardsGrid = document.getElementById('availableSignalsGrid');
  if (filteredNets.length === 0) {
    cardsGrid.innerHTML = `<div class="empty-cell" style="grid-column: 1 / -1;">No signals in this filter category. Click "Scan Available Wi-Fi & Data Signals" to sweep all channels.</div>`;
  } else {
    cardsGrid.innerHTML = filteredNets
      .map((n) => {
        const col = getSignalColor(n.bestSignalPercent);
        let typeClass = '';
        if (n.isDataHotspot) typeClass = 'hotspot';
        else if (n.isMesh) typeClass = 'mesh';
        else if (n.category === 'Range Extender') typeClass = 'extender';

        const bssInfo = n.bssids.find((b) => b.bssLoadStations !== null);
        const loadText = bssInfo
          ? ` • BSS Load: ${bssInfo.bssLoadStations} clients (${bssInfo.bssLoadUtilization})`
          : '';

        let actionBtn = '';
        if (n.isConnectedNet) {
          actionBtn = `<span class="role-badge client">✓ Connected</span>`;
        } else if (n.isSavedProfile) {
          actionBtn = `<button class="btn btn-xs btn-primary connect-net-btn" data-ssid="${escapeHtml(n.rawSsid)}" data-saved="true" data-open="${n.isOpen}">⚡ 1-Click Connect (Saved)</button>`;
        } else {
          actionBtn = `<button class="btn btn-xs btn-secondary connect-net-btn" data-ssid="${escapeHtml(n.rawSsid)}" data-saved="false" data-open="${n.isOpen}">🔑 Connect</button>`;
        }

        return `
        <div class="signal-card ${n.isConnectedNet ? 'connected-card' : ''} ${n.isDataHotspot ? 'hotspot-card' : ''}">
          <div class="signal-card-top">
            <div>
              <div class="signal-card-ssid">${escapeHtml(n.ssid)}</div>
              <span class="signal-type-badge ${typeClass}">${escapeHtml(n.badge)}</span>
            </div>
            <div style="text-align:right;">
              <div style="font-size:1.15rem;font-weight:800;color:${col};">${n.bestSignalPercent}%</div>
              <div style="font-size:0.74rem;color:#94a3b8;">${n.bestRssiDbm} dBm</div>
            </div>
          </div>

          <div style="font-size:0.77rem;color:#94a3b8;">
            <div>Bands: <strong style="color:#e2e8f0;">${escapeHtml(n.bands.join(' + ') || '2.4 GHz')}</strong> (Ch ${escapeHtml(n.channels.join(', '))}) • ${n.bssids.length} BSSID${n.bssids.length > 1 ? 's' : ''}${escapeHtml(loadText)}</div>
            <div style="margin-top:2px;">Vendor: ${escapeHtml(n.bssids[0]?.vendor || 'Unknown')}</div>
          </div>

          <div class="signal-card-footer">
            <span>🔒 ${escapeHtml(n.authentication)} (${escapeHtml(n.encryption)})</span>
            ${actionBtn}
          </div>
        </div>`;
      })
      .join('');

    cardsGrid.querySelectorAll('.connect-net-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ssid = btn.getAttribute('data-ssid');
        const isSaved = btn.getAttribute('data-saved') === 'true';
        const isOpen = btn.getAttribute('data-open') === 'true';
        handleConnectSignal(ssid, isSaved, isOpen);
      });
    });
  }

  // Render BSSID Table
  const tbody = document.getElementById('nearbyTableBody');
  if (radios.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-cell">No nearby networks detected.</td></tr>`;
  } else {
    const sorted = [...radios].sort((a, b) => {
      if (a.isConnected !== b.isConnected) return a.isConnected ? -1 : 1;
      return b.signalPercent - a.signalPercent;
    });

    tbody.innerHTML = sorted
      .map((r) => {
        const col = getSignalColor(r.signalPercent);
        const loadHtml =
          r.bssLoadStations !== null
            ? `<div style="font-size:0.72rem;color:#fbbf24;margin-top:2px;">Stations: ${r.bssLoadStations} • Load: ${escapeHtml(r.bssLoadUtilization)}</div>`
            : '';

        const rowConnectBtn =
          r.isConnected
            ? '<span class="role-badge client">Active Radio</span>'
            : !r.isHidden
            ? `<button class="btn btn-xs btn-secondary row-connect-btn" data-ssid="${escapeHtml(r.rawSsid)}" data-saved="${r.isSavedProfile}" data-open="${r.isOpen}">Connect</button>`
            : '<span style="font-size:0.74rem;color:#94a3b8;">Mesh Backhaul</span>';

        return `
        <tr class="${r.isConnected ? 'highlight-row' : ''}">
          <td>
            <strong>${escapeHtml(r.ssid)}</strong>
            ${r.isConnected ? '<span class="role-badge self" style="margin-left:6px;">Connected AP</span>' : ''}
          </td>
          <td><span class="signal-type-badge ${r.isDataHotspot ? 'hotspot' : r.isMesh ? 'mesh' : ''}">${escapeHtml(r.badge)}</span></td>
          <td><code>${escapeHtml(r.bssid)}</code></td>
          <td>${escapeHtml(r.vendor)}</td>
          <td>
            <div class="sig-bar-wrap">
              <div class="sig-bar">
                <div class="sig-bar-fill" style="width:${r.signalPercent}%;background:${col};"></div>
              </div>
              <strong>${r.signalPercent}%</strong>
              <span style="color:#94a3b8;font-size:0.78rem;">(${r.rssiDbm} dBm)</span>
            </div>
          </td>
          <td>
            <strong>${escapeHtml(r.band)}</strong> • Ch ${r.channel || '--'}
            <div style="font-size:0.74rem;color:#94a3b8;">${r.frequencyMHz ? `${r.frequencyMHz} MHz` : ''}</div>
          </td>
          <td>
            <span class="tag-badge">${escapeHtml(r.wifiGeneration)} (${escapeHtml(r.radioType)})</span>
            ${loadHtml}
          </td>
          <td>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
              <span style="font-size:0.76rem;">${escapeHtml(r.authentication)}</span>
              ${rowConnectBtn}
            </div>
          </td>
        </tr>`;
      })
      .join('');

    tbody.querySelectorAll('.row-connect-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ssid = btn.getAttribute('data-ssid');
        const isSaved = btn.getAttribute('data-saved') === 'true';
        const isOpen = btn.getAttribute('data-open') === 'true';
        handleConnectSignal(ssid, isSaved, isOpen);
      });
    });
  }

  drawSpectrumCanvases(radios);
}

// Connect to a selected Wi-Fi or Mobile Data Hotspot
async function handleConnectSignal(ssid, isSaved, isOpen) {
  if (isOpen) {
    await executeWifiConnect({ ssid, password: '', isOpen: true });
    return;
  }

  // Open Password & Recovery Modal
  state.pendingConnectNet = { ssid, isOpen };
  document.getElementById('modalTitle').textContent = `Connect to "${ssid}"`;
  document.getElementById('modalDesc').textContent = `Enter the security key for "${ssid}", or use one of the recovery methods below if you forgot the password.`;
  const pwdInput = document.getElementById('modalPasswordInput');
  const qrInput = document.getElementById('qrTextInput');
  const vaultStatus = document.getElementById('vaultRecoveryStatus');
  pwdInput.value = '';
  if (qrInput) qrInput.value = '';
  document.getElementById('connectModal').classList.remove('hidden');

  // Check if Windows WLAN Vault has a saved password for this SSID
  vaultStatus.innerHTML = 'Checking Windows WLAN Credential Vault...';
  try {
    const res = await fetch(`/api/profile?name=${encodeURIComponent(ssid)}`);
    const data = await res.json();
    if (data && data.profile && data.profile.keyContent) {
      pwdInput.value = data.profile.keyContent;
      vaultStatus.innerHTML = `<span style="color:#34d399;font-weight:700;">✓ Password Recovered from Windows Vault:</span> <code>${escapeHtml(data.profile.keyContent)}</code> (auto-filled above!)`;
    } else {
      vaultStatus.innerHTML = `No previous password stored in Windows for <strong>${escapeHtml(ssid)}</strong>. Check a connected phone, router label, or press WPS.`;
    }
  } catch (_) {
    vaultStatus.textContent = 'Could not query Windows Vault.';
  }

  pwdInput.focus();
}

async function executeWifiConnect({ ssid, password, isOpen }) {
  const msgEl = document.getElementById('connectStatusMsg');
  msgEl.classList.remove('hidden');
  msgEl.textContent = `Connecting to "${ssid}"...`;

  try {
    const res = await fetch('/api/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ssid, password, isOpen })
    });
    const data = await res.json();
    msgEl.textContent = `${data.ok ? '✓' : '⚠'} ${data.message}`;
    setTimeout(() => loadOverview(), 2500);
  } catch (err) {
    msgEl.textContent = `Connection error: ${err.message}`;
  }
}

// High-DPI Canvas Setup Helper
function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = rect.width || canvas.width || 560;
  const h = rect.height || canvas.height || 190;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return { ctx, w, h };
}

function drawSignalChart() {
  const canvas = document.getElementById('signalChartCanvas');
  if (!canvas) return;
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);

  const pad = { top: 18, right: 20, bottom: 26, left: 42 };
  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#64748b';
  ctx.font = '11px Inter, sans-serif';

  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (ch / 4) * i;
    const val = 100 - i * 25;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
    ctx.fillText(`${val}%`, 6, y + 4);
  }

  const pts = state.signalHistory;
  if (pts.length === 0) return;

  const stepX = cw / Math.max(1, state.maxHistory - 1);

  ctx.beginPath();
  pts.forEach((p, idx) => {
    const x = pad.left + idx * stepX;
    const y = pad.top + ch - (Math.min(100, Math.max(0, p.signal)) / 100) * ch;
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#06b6d4';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  const lastX = pad.left + (pts.length - 1) * stepX;
  ctx.lineTo(lastX, pad.top + ch);
  ctx.lineTo(pad.left, pad.top + ch);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + ch);
  grad.addColorStop(0, 'rgba(6, 182, 212, 0.32)');
  grad.addColorStop(1, 'rgba(6, 182, 212, 0.0)');
  ctx.fillStyle = grad;
  ctx.fill();

  const maxRx = Math.max(300, ...pts.map((p) => p.rxRate || 0));
  ctx.beginPath();
  pts.forEach((p, idx) => {
    const x = pad.left + idx * stepX;
    const y = pad.top + ch - (Math.min(maxRx, p.rxRate) / maxRx) * ch;
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#a855f7';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawPingChart() {
  const canvas = document.getElementById('pingChartCanvas');
  if (!canvas) return;
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);

  const pad = { top: 18, right: 20, bottom: 26, left: 48 };
  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;

  const pts = state.pingHistory;
  const maxMs = Math.max(60, ...pts.map((p) => Math.max(p.gatewayMs || 0, p.internetMs || 0)), 20);

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#64748b';
  ctx.font = '11px Inter, sans-serif';

  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (ch / 4) * i;
    const val = Math.round(maxMs - (maxMs / 4) * i);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
    ctx.fillText(`${val}ms`, 6, y + 4);
  }

  if (pts.length === 0) return;
  const stepX = cw / Math.max(1, state.maxHistory - 1);

  ctx.beginPath();
  pts.forEach((p, idx) => {
    const x = pad.left + idx * stepX;
    const y = pad.top + ch - (Math.min(maxMs, p.gatewayMs) / maxMs) * ch;
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#10b981';
  ctx.lineWidth = 2.4;
  ctx.stroke();

  ctx.beginPath();
  pts.forEach((p, idx) => {
    const x = pad.left + idx * stepX;
    const y = pad.top + ch - (Math.min(maxMs, p.internetMs) / maxMs) * ch;
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 2.2;
  ctx.stroke();
}

function drawSpectrumCanvases(radios) {
  const palette = ['#06b6d4', '#10b981', '#f59e0b', '#a855f7', '#ec4899', '#3b82f6'];

  const c24 = document.getElementById('spectrum24Canvas');
  if (c24) {
    const { ctx, w, h } = setupCanvas(c24);
    ctx.clearRect(0, 0, w, h);
    const pad = { top: 20, right: 20, bottom: 26, left: 36 };
    const cw = w - pad.left - pad.right;
    const ch = h - pad.top - pad.bottom;

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.15)';
    ctx.fillStyle = '#64748b';
    ctx.font = '10px Inter, sans-serif';

    for (let c = 1; c <= 14; c++) {
      const x = pad.left + ((c - 1) / 13) * cw;
      ctx.beginPath();
      ctx.moveTo(x, pad.top);
      ctx.lineTo(x, pad.top + ch);
      ctx.stroke();
      ctx.fillText(String(c), x - 4, h - 8);
    }

    const r24 = radios.filter((r) => r.channel && r.channel <= 14);
    r24.forEach((r, i) => {
      const centerX = pad.left + ((r.channel - 1) / 13) * cw;
      const spread = (2.2 / 13) * cw;
      const peakH = (r.signalPercent / 100) * (ch - 10);
      const peakY = pad.top + ch - peakH;
      const color = r.isConnected ? '#22d3ee' : palette[i % palette.length];

      ctx.beginPath();
      ctx.moveTo(centerX - spread, pad.top + ch);
      ctx.quadraticCurveTo(centerX, peakY - peakH * 0.25, centerX + spread, pad.top + ch);
      ctx.strokeStyle = color;
      ctx.lineWidth = r.isConnected ? 3 : 2;
      ctx.stroke();
      ctx.fillStyle = color + '28';
      ctx.fill();

      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 10px Inter, sans-serif';
      const label = `${r.ssid.slice(0, 14)} (Ch ${r.channel} • ${r.signalPercent}%)`;
      ctx.fillText(label, Math.max(pad.left, Math.min(w - 110, centerX - 38)), Math.max(14, peakY - 4));
    });
  }

  const c5 = document.getElementById('spectrum5Canvas');
  if (c5) {
    const { ctx, w, h } = setupCanvas(c5);
    ctx.clearRect(0, 0, w, h);
    const pad = { top: 20, right: 20, bottom: 26, left: 36 };
    const cw = w - pad.left - pad.right;
    const ch = h - pad.top - pad.bottom;

    const channels5 = [36, 40, 44, 48, 52, 60, 100, 116, 132, 149, 153, 157, 161, 165];
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.15)';
    ctx.fillStyle = '#64748b';
    ctx.font = '10px Inter, sans-serif';

    channels5.forEach((c, idx) => {
      const x = pad.left + (idx / (channels5.length - 1)) * cw;
      ctx.beginPath();
      ctx.moveTo(x, pad.top);
      ctx.lineTo(x, pad.top + ch);
      ctx.stroke();
      ctx.fillText(String(c), x - 7, h - 8);
    });

    const r5 = radios.filter((r) => r.channel && r.channel > 14);
    r5.forEach((r, i) => {
      let idx = channels5.indexOf(r.channel);
      if (idx === -1) {
        idx = channels5.findIndex((c) => c >= r.channel);
        if (idx === -1) idx = channels5.length - 1;
      }
      const centerX = pad.left + (idx / (channels5.length - 1)) * cw;
      const spread = (1.3 / (channels5.length - 1)) * cw;
      const peakH = (r.signalPercent / 100) * (ch - 10);
      const peakY = pad.top + ch - peakH;
      const color = r.isConnected ? '#10b981' : palette[(i + 2) % palette.length];

      ctx.beginPath();
      ctx.moveTo(centerX - spread, pad.top + ch);
      ctx.quadraticCurveTo(centerX, peakY - peakH * 0.25, centerX + spread, pad.top + ch);
      ctx.strokeStyle = color;
      ctx.lineWidth = r.isConnected ? 3 : 2;
      ctx.stroke();
      ctx.fillStyle = color + '28';
      ctx.fill();

      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 10px Inter, sans-serif';
      const label = `${r.ssid.slice(0, 14)} (Ch ${r.channel} • ${r.signalPercent}%)`;
      ctx.fillText(label, Math.max(pad.left, Math.min(w - 110, centerX - 38)), Math.max(14, peakY - 4));
    });
  }
}

// Render Saved Wi-Fi Profiles & Active Profile Credentials + QR Code
function renderProfilesSection(driverAndProfiles) {
  if (!driverAndProfiles) return;
  const profiles = driverAndProfiles.profiles || [];
  if (driverAndProfiles.activeProfileDetails) {
    setActiveProfileDisplay(driverAndProfiles.activeProfileDetails);
  }

  const listEl = document.getElementById('savedProfilesList');
  listEl.innerHTML = profiles
    .map((name) => {
      const isDataHotspot = /4g|5g|iphone|galaxy|hotspot/i.test(name);
      return `
      <div class="profile-item ${state.activeProfile && state.activeProfile.name === name ? 'active' : ''}" data-profile="${escapeHtml(name)}">
        <div>
          <strong>${isDataHotspot ? '📱' : '📶'} ${escapeHtml(name)}</strong>
          <div style="font-size:0.75rem;color:#94a3b8;">
            ${isDataHotspot ? 'Saved Mobile Data / 4G-5G Hotspot Profile' : 'Saved Windows WLAN Profile'}
          </div>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-xs btn-secondary inspect-prof-btn">Inspect Key</button>
          <button class="btn btn-xs btn-primary connect-prof-btn" data-ssid="${escapeHtml(name)}">Connect</button>
        </div>
      </div>`;
    })
    .join('');

  listEl.querySelectorAll('.profile-item').forEach((el) => {
    el.addEventListener('click', async (ev) => {
      if (ev.target.classList.contains('connect-prof-btn')) {
        const ssid = ev.target.getAttribute('data-ssid');
        executeWifiConnect({ ssid, password: '', isOpen: false });
        return;
      }
      const profName = el.getAttribute('data-profile');
      const res = await fetch(`/api/profile?name=${encodeURIComponent(profName)}`);
      const data = await res.json();
      if (data && data.profile) {
        setActiveProfileDisplay(data.profile);
        listEl.querySelectorAll('.profile-item').forEach((item) => item.classList.remove('active'));
        el.classList.add('active');
      }
    });
  });
}

function showMgmtToast(message, ok = true) {
  const toast = document.getElementById('mgmtToast');
  if (!toast) return;
  toast.textContent = `${ok ? '✓' : '⚠'} ${message}`;
  toast.style.borderColor = ok ? 'rgba(16, 185, 129, 0.45)' : 'rgba(239, 68, 68, 0.45)';
  toast.style.color = ok ? '#34d399' : '#fca5a5';
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 5000);
}

function setActiveProfileDisplay(prof) {
  state.activeProfile = prof;
  state.passwordVisible = false;
  document.getElementById('credSsid').textContent = prof.ssid || prof.name || '--';
  document.getElementById('credAuth').textContent = `${prof.authentication || '--'} (${prof.cipher || '--'})`;
  document.getElementById('credConnMode').textContent = prof.connectionMode || '--';
  document.getElementById('credMacRand').textContent = prof.macRandomization || '--';

  // Sync management dropdowns
  const connSel = document.getElementById('mgmtConnMode');
  const macSel = document.getElementById('mgmtMacRand');
  const costSel = document.getElementById('mgmtCost');
  const newPwdInput = document.getElementById('mgmtNewPwdInput');
  if (connSel) connSel.value = String(prof.connectionMode).toLowerCase().includes('manual') ? 'manual' : 'auto';
  if (macSel) {
    const mr = String(prof.macRandomization).toLowerCase();
    macSel.value = mr.includes('daily') ? 'daily' : mr.includes('enable') ? 'yes' : 'no';
  }
  if (costSel) {
    const c = String(prof.cost).toLowerCase();
    costSel.value = c.includes('fixed') ? 'fixed' : c.includes('variable') ? 'variable' : 'unrestricted';
  }
  if (newPwdInput) newPwdInput.value = '';

  const pwdEl = document.getElementById('credPassword');
  const toggleBtn = document.getElementById('togglePwdBtn');
  if (prof.keyContent) {
    pwdEl.textContent = '••••••••';
    toggleBtn.textContent = 'Show';
    toggleBtn.disabled = false;
  } else {
    pwdEl.textContent = 'No Password / Open';
    toggleBtn.disabled = true;
  }

  drawWifiQrCanvas(prof.ssid || prof.name, prof.keyContent || '', prof.authentication || 'WPA');
}

function drawWifiQrCanvas(ssid, password, auth = 'WPA') {
  const canvas = document.getElementById('wifiQrCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const size = 160;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  const authType = String(auth).toLowerCase().includes('open') ? 'nopass' : 'WPA';
  const qrPayload = `WIFI:T:${authType};S:${ssid};P:${password};;`;

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, 4, 4, size - 8, size - 8);
  };
  img.src = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&margin=4&data=${encodeURIComponent(qrPayload)}`;

  const cells = 21;
  const cellSize = Math.floor((size - 16) / cells);
  const offset = Math.floor((size - cells * cellSize) / 2);

  const drawFinder = (r0, c0) => {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(offset + c0 * cellSize, offset + r0 * cellSize, 7 * cellSize, 7 * cellSize);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(offset + (c0 + 1) * cellSize, offset + (r0 + 1) * cellSize, 5 * cellSize, 5 * cellSize);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(offset + (c0 + 2) * cellSize, offset + (r0 + 2) * cellSize, 3 * cellSize, 3 * cellSize);
  };

  drawFinder(0, 0);
  drawFinder(0, cells - 7);
  drawFinder(cells - 7, 0);

  let hash = 2166136261;
  for (let i = 0; i < qrPayload.length; i++) {
    hash ^= qrPayload.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  ctx.fillStyle = '#0f172a';
  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) {
      if ((r < 8 && c < 8) || (r < 8 && c >= cells - 8) || (r >= cells - 8 && c < 8)) continue;
      const bit = ((hash ^ (r * 31 + c * 17 + r * c)) >>> ((r + c) % 16)) & 1;
      if (bit) {
        ctx.fillRect(offset + c * cellSize, offset + r * cellSize, cellSize, cellSize);
      }
    }
  }
}

// Fetch Full Overview Snapshot
async function loadOverview() {
  try {
    const res = await fetch('/api/overview');
    const data = await res.json();
    state.lastOverview = data;
    renderTelemetry(data);
    renderMeshSection(data.mesh);
    renderNearbyNetworks(data.nearby);
    renderProfilesSection(data.driverAndProfiles);

    if (data.network && data.network.wifiAdapter) {
      const wa = data.network.wifiAdapter;
      document.getElementById('subnetLabel').textContent = wa.networkAddress
        ? `${wa.networkAddress}/${wa.cidr}`
        : wa.ipv4 || 'Local Subnet';
    }
  } catch (err) {
    console.error('Overview fetch error:', err);
  }
}

// Poll Fast Live Endpoint every 2 seconds
async function pollLive() {
  if (!state.liveEnabled) return;
  try {
    const res = await fetch('/api/live');
    const data = await res.json();
    renderTelemetry({
      ...state.lastOverview,
      ...data
    });
  } catch (err) {
    console.error('Live poll error:', err);
  }
}

// Scan Connected LAN Devices
async function loadDevices(deep = false) {
  const banner = document.getElementById('scanStatusBanner');
  const statusText = document.getElementById('scanStatusText');
  const quickBtn = document.getElementById('quickScanDevicesBtn');
  const deepBtn = document.getElementById('deepScanDevicesBtn');

  try {
    if (deep) {
      banner.classList.remove('hidden');
      statusText.textContent = 'Pinging all 254 IPs in subnet, resolving hostnames, MAC vendors & checking open service ports...';
    }
    quickBtn.disabled = true;
    deepBtn.disabled = true;

    const res = await fetch(`/api/devices?deep=${deep ? 'true' : 'false'}`);
    const data = await res.json();
    state.devices = data.devices || [];
    if (data.subnet) {
      document.getElementById('subnetLabel').textContent = data.subnet;
    }
    renderDevicesTable();
  } catch (err) {
    console.error('Devices scan error:', err);
  } finally {
    banner.classList.add('hidden');
    quickBtn.disabled = false;
    deepBtn.disabled = false;
  }
}

// Wire up interactive controls
document.addEventListener('DOMContentLoaded', () => {
  loadOverview();
  loadDevices(false);

  state.liveTimer = setInterval(pollLive, 2000);

  // Toggle Live Button
  const toggleLiveBtn = document.getElementById('toggleLiveBtn');
  toggleLiveBtn.addEventListener('click', () => {
    state.liveEnabled = !state.liveEnabled;
    toggleLiveBtn.classList.toggle('active', state.liveEnabled);
    document.getElementById('liveBtnLabel').textContent = state.liveEnabled ? 'Live: ON (2s)' : 'Live: PAUSED';
  });

  // Refresh All Button
  document.getElementById('refreshAllBtn').addEventListener('click', () => {
    loadOverview();
    loadDevices(false);
  });

  // Quick Network Management Actions (Flush DNS, Renew IP, Disconnect)
  document.getElementById('flushDnsBtn')?.addEventListener('click', async () => {
    const res = await fetch('/api/network/flushdns', { method: 'POST' });
    const data = await res.json();
    showMgmtToast(data.message, data.ok);
  });

  document.getElementById('renewIpBtn')?.addEventListener('click', async () => {
    showMgmtToast('Renewing DHCP IP lease...', true);
    const res = await fetch('/api/network/renew', { method: 'POST' });
    const data = await res.json();
    showMgmtToast(data.message, data.ok);
    loadOverview();
  });

  document.getElementById('disconnectWifiBtn')?.addEventListener('click', async () => {
    if (!confirm('Disconnect from the current Wi-Fi network?')) return;
    const res = await fetch('/api/wifi/disconnect', { method: 'POST' });
    const data = await res.json();
    showMgmtToast(data.message, data.ok);
    setTimeout(loadOverview, 1000);
  });

  // Saved Profile Management (Update Settings / Forget Profile)
  document.getElementById('saveProfileMgmtBtn')?.addEventListener('click', async () => {
    if (!state.activeProfile) return;
    const payload = {
      name: state.activeProfile.name,
      connectionMode: document.getElementById('mgmtConnMode').value,
      macRandomization: document.getElementById('mgmtMacRand').value,
      cost: document.getElementById('mgmtCost').value,
      newPassword: document.getElementById('mgmtNewPwdInput').value.trim()
    };
    const res = await fetch('/api/profile/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    showMgmtToast(data.message, data.ok);
    const profRes = await fetch(`/api/profile?name=${encodeURIComponent(state.activeProfile.name)}`);
    const profData = await profRes.json();
    if (profData?.profile) setActiveProfileDisplay(profData.profile);
  });

  document.getElementById('deleteProfileMgmtBtn')?.addEventListener('click', async () => {
    if (!state.activeProfile) return;
    const name = state.activeProfile.name;
    if (!confirm(`Forget and delete saved Wi-Fi profile "${name}" from this PC?`)) return;
    const res = await fetch('/api/profile/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    showMgmtToast(data.message, data.ok);
    loadOverview();
  });

  // Rescan Satellite Mesh Button
  document.getElementById('rescanMeshBtn').addEventListener('click', async () => {
    const btn = document.getElementById('rescanMeshBtn');
    btn.disabled = true;
    btn.textContent = '🛰️ Scanning Mesh Satellites...';
    try {
      const res = await fetch('/api/mesh');
      const data = await res.json();
      if (data.mesh) renderMeshSection(data.mesh);
      if (data.nearby) renderNearbyNetworks(data.nearby);
    } finally {
      btn.disabled = false;
      btn.textContent = '🛰️ Hardware Scan Mesh Satellites';
    }
  });

  // Rescan Available Wi-Fi & Data Signals
  document.getElementById('scanNearbyBtn').addEventListener('click', async () => {
    const btn = document.getElementById('scanNearbyBtn');
    btn.disabled = true;
    btn.textContent = '📡 Hardware Sweeping Airwaves...';
    try {
      const res = await fetch('/api/nearby');
      const data = await res.json();
      renderNearbyNetworks(data);
      if (data.mesh) renderMeshSection(data.mesh);
    } finally {
      btn.disabled = false;
      btn.textContent = '📡 Scan Available Wi-Fi & Data Signals';
    }
  });

  // Signal Type Filter Pills
  document.querySelectorAll('#signalTypeFilters .filter-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#signalTypeFilters .filter-pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      state.signalFilter = pill.getAttribute('data-filter');
      if (state.nearby) renderNearbyNetworks(state.nearby);
    });
  });

  // Connect Modal Controls
  const closeModal = () => {
    document.getElementById('connectModal').classList.add('hidden');
    state.pendingConnectNet = null;
  };
  document.getElementById('closeModalBtn').addEventListener('click', closeModal);
  document.getElementById('cancelConnectBtn').addEventListener('click', closeModal);

  // Parse pasted WIFI: QR code string (`WIFI:T:WPA;S:MyNet;P:MyPass;;`)
  const qrInput = document.getElementById('qrTextInput');
  if (qrInput) {
    qrInput.addEventListener('input', () => {
      const val = qrInput.value.trim();
      const passMatch = val.match(/P:([^;]+);/i);
      if (passMatch && passMatch[1]) {
        document.getElementById('modalPasswordInput').value = passMatch[1];
        document.getElementById('vaultRecoveryStatus').innerHTML = `<span style="color:#34d399;font-weight:700;">✓ Extracted Password from QR String:</span> <code>${escapeHtml(passMatch[1])}</code>`;
      }
    });
  }

  const wpsBtn = document.getElementById('wpsConnectBtn');
  if (wpsBtn) {
    wpsBtn.addEventListener('click', () => {
      if (!state.pendingConnectNet) return;
      const { ssid } = state.pendingConnectNet;
      closeModal();
      executeWifiConnect({ ssid, password: '', isOpen: false });
    });
  }

  document.getElementById('confirmConnectBtn').addEventListener('click', () => {
    if (!state.pendingConnectNet) return;
    const pwd = document.getElementById('modalPasswordInput').value;
    const { ssid, isOpen } = state.pendingConnectNet;
    closeModal();
    executeWifiConnect({ ssid, password: pwd, isOpen });
  });

  // Export JSON Report
  document.getElementById('exportJsonBtn').addEventListener('click', () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      overview: state.lastOverview,
      mesh: state.mesh,
      connectedDevices: state.devices,
      signalHistory: state.signalHistory,
      pingHistory: state.pingHistory
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `net-radar-report-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Device Search & Scan Buttons
  document.getElementById('deviceSearchInput').addEventListener('input', renderDevicesTable);
  document.getElementById('quickScanDevicesBtn').addEventListener('click', () => loadDevices(false));
  document.getElementById('deepScanDevicesBtn').addEventListener('click', () => loadDevices(true));

  // Speed Test Button
  document.getElementById('runSpeedTestBtn').addEventListener('click', async () => {
    const btn = document.getElementById('runSpeedTestBtn');
    const resText = document.getElementById('speedTestResultText');
    btn.disabled = true;
    btn.textContent = 'Testing...';
    resText.textContent = 'Downloading test stream...';
    try {
      const res = await fetch('/api/speedtest');
      const data = await res.json();
      resText.innerHTML = `<strong style="color:#34d399;">↓ ${data.downloadMbps} Mbps</strong>`;
    } catch (_) {
      resText.textContent = 'Speed test failed';
    } finally {
      btn.disabled = false;
      btn.textContent = '⚡ Run Speed Test';
    }
  });

  // Password Show/Hide & Copy
  document.getElementById('togglePwdBtn').addEventListener('click', () => {
    if (!state.activeProfile || !state.activeProfile.keyContent) return;
    state.passwordVisible = !state.passwordVisible;
    document.getElementById('credPassword').textContent = state.passwordVisible
      ? state.activeProfile.keyContent
      : '••••••••';
    document.getElementById('togglePwdBtn').textContent = state.passwordVisible ? 'Hide' : 'Show';
  });

  document.getElementById('copyPwdBtn').addEventListener('click', () => {
    if (!state.activeProfile || !state.activeProfile.keyContent) return;
    navigator.clipboard.writeText(state.activeProfile.keyContent);
    const btn = document.getElementById('copyPwdBtn');
    btn.textContent = 'Copied!';
    setTimeout(() => (btn.textContent = 'Copy'), 1500);
  });

  // Section Filter Tabs
  document.querySelectorAll('.nav-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.nav-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.getAttribute('data-target');
      document.querySelectorAll('main > section').forEach((sec) => {
        if (target === 'all' || sec.getAttribute('data-section') === target) {
          sec.style.display = '';
        } else {
          sec.style.display = 'none';
        }
      });
      drawSignalChart();
      drawPingChart();
      if (state.nearby) drawSpectrumCanvases(state.nearby.allRadios || []);
    });
  });

  window.addEventListener('resize', () => {
    drawSignalChart();
    drawPingChart();
    if (state.nearby) drawSpectrumCanvases(state.nearby.allRadios || []);
  });
});
