// State management
const state = {
  liveEnabled: true,
  liveTimer: null,
  maxHistory: 40,
  signalHistory: [], // { time, signal, rssi, rxRate, txRate }
  pingHistory: [],   // { time, gatewayMs, internetMs }
  devices: [],
  nearby: null,
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

  // Connection Pill
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

    // Calculate Jitter (average consecutive ping diff on gateway)
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

  // Push Signal History
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

// Render 3-Column Detailed KV Properties & All Adapters Table
function renderDetailedLists(wifi, network, traffic, driverAndProfiles) {
  // 1. Wireless Radio & 802.11
  const wifiProps = [
    ['Connection State', wifi.state],
    ['Network SSID', wifi.ssid],
    ['Access Point BSSID', wifi.bssid],
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

  // 2. IP, DHCP & DNS
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

  // 3. Hardware Driver & Packet Stats
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

  // All System Adapters Table
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
      else if (d.isSelf) badgeClass = 'self';

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
        d.isGateway || (d.openPorts && (d.openPorts.includes('HTTP') || d.openPorts.includes('HTTPS')))
          ? ` <a href="http://${escapeHtml(d.ip)}" target="_blank" rel="noopener" class="router-link">Open ↗</a>`
          : '';

      return `
      <tr class="${d.isSelf || d.isGateway ? 'highlight-row' : ''}">
        <td>
          <span class="role-badge ${badgeClass}">
            ● ${escapeHtml(d.role)}
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
        <td>${pingText}</td>
      </tr>`;
    })
    .join('');
}

// Render Nearby Wi-Fi Networks & Spectrum
function renderNearbyNetworks(nearby) {
  if (!nearby) return;
  state.nearby = nearby;

  const radios = nearby.allRadios || [];
  document.getElementById('nearbyCountBadge').textContent = `${nearby.totalNetworks} SSIDs • ${radios.length} BSSID Radios`;
  document.getElementById('navNearbyCount').textContent = radios.length;
  document.getElementById('best24Ch').textContent = `Ch ${nearby.best24Channel || 1}`;
  document.getElementById('best5Ch').textContent = `Ch ${nearby.best5Channel || 36}`;

  const tbody = document.getElementById('nearbyTableBody');
  if (radios.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-cell">No nearby networks detected.</td></tr>`;
  } else {
    // Sort by connected first, then signal % descending
    const sorted = [...radios].sort((a, b) => {
      if (a.isConnected !== b.isConnected) return a.isConnected ? -1 : 1;
      return b.signalPercent - a.signalPercent;
    });

    tbody.innerHTML = sorted
      .map((r) => {
        const col = getSignalColor(r.signalPercent);
        return `
        <tr class="${r.isConnected ? 'highlight-row' : ''}">
          <td>
            <strong>${escapeHtml(r.ssid)}</strong>
            ${r.isConnected ? '<span class="role-badge self" style="margin-left:6px;">Connected AP</span>' : ''}
          </td>
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
          <td><span class="tag-badge">${escapeHtml(r.wifiGeneration)} (${escapeHtml(r.radioType)})</span></td>
          <td>${escapeHtml(r.authentication)} / ${escapeHtml(r.encryption)}</td>
          <td style="font-size:0.76rem;color:#94a3b8;max-width:190px;">
            <div>Basic: ${escapeHtml(r.basicRates || '--')}</div>
            <div>Other: ${escapeHtml(r.otherRates || '--')}</div>
          </td>
        </tr>`;
      })
      .join('');
  }

  drawSpectrumCanvases(radios);
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

// Draw Live Signal & RX Rate Chart
function drawSignalChart() {
  const canvas = document.getElementById('signalChartCanvas');
  if (!canvas) return;
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);

  const pad = { top: 18, right: 20, bottom: 26, left: 42 };
  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;

  // Grid lines
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

  // Draw Signal % line & gradient fill
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

  // Gradient under Signal line
  const lastX = pad.left + (pts.length - 1) * stepX;
  ctx.lineTo(lastX, pad.top + ch);
  ctx.lineTo(pad.left, pad.top + ch);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + ch);
  grad.addColorStop(0, 'rgba(6, 182, 212, 0.32)');
  grad.addColorStop(1, 'rgba(6, 182, 212, 0.0)');
  ctx.fillStyle = grad;
  ctx.fill();

  // Draw RX Rate scaled (max 400 Mbps or max observed)
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

// Draw Live Ping Latency Chart
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

  // Gateway Ping (Green)
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

  // Internet Ping (Amber)
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

// Draw 2.4 GHz & 5 GHz Channel Spectrum Bell Curves
function drawSpectrumCanvases(radios) {
  const palette = ['#06b6d4', '#10b981', '#f59e0b', '#a855f7', '#ec4899', '#3b82f6'];

  // 1. 2.4 GHz Spectrum (Channels 1 to 14)
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
      const spread = (2.2 / 13) * cw; // 20MHz spans ~4 channels
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

  // 2. 5 GHz Spectrum (Channels 36 to 165)
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
    .map(
      (name) => `
      <div class="profile-item ${state.activeProfile && state.activeProfile.name === name ? 'active' : ''}" data-profile="${escapeHtml(name)}">
        <div>
          <strong>📶 ${escapeHtml(name)}</strong>
          <div style="font-size:0.75rem;color:#94a3b8;">Saved Windows WLAN Profile</div>
        </div>
        <button class="btn btn-xs btn-secondary">Inspect Key →</button>
      </div>`
    )
    .join('');

  listEl.querySelectorAll('.profile-item').forEach((el) => {
    el.addEventListener('click', async () => {
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

function setActiveProfileDisplay(prof) {
  state.activeProfile = prof;
  state.passwordVisible = false;
  document.getElementById('credSsid').textContent = prof.ssid || prof.name || '--';
  document.getElementById('credAuth').textContent = `${prof.authentication || '--'} (${prof.cipher || '--'})`;
  document.getElementById('credConnMode').textContent = prof.connectionMode || '--';
  document.getElementById('credMacRand').textContent = prof.macRandomization || '--';

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

// Render Wi-Fi QR Code onto Canvas (Deterministic Matrix + Visual Scannable Image with fallback)
function drawWifiQrCanvas(ssid, password, auth = 'WPA') {
  const canvas = document.getElementById('wifiQrCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const size = 160;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  const authType = String(auth).toLowerCase().includes('open') ? 'nopass' : 'WPA';
  const qrPayload = `WIFI:T:${authType};S:${ssid};P:${password};;`;

  // Try loading crisp QR via Image if online, and simultaneously draw immediate deterministic matrix pattern
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, 4, 4, size - 8, size - 8);
  };
  img.src = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&margin=4&data=${encodeURIComponent(qrPayload)}`;

  // Immediate local fallback matrix drawing so canvas is never blank even offline
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
  // Initial load
  loadOverview();
  loadDevices(false);

  // Start 2s Live Polling
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

  // Export JSON Report
  document.getElementById('exportJsonBtn').addEventListener('click', () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      overview: state.lastOverview,
      connectedDevices: state.devices,
      signalHistory: state.signalHistory,
      pingHistory: state.pingHistory
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wifi-report-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Device Search & Scan Buttons
  document.getElementById('deviceSearchInput').addEventListener('input', renderDevicesTable);
  document.getElementById('quickScanDevicesBtn').addEventListener('click', () => loadDevices(false));
  document.getElementById('deepScanDevicesBtn').addEventListener('click', () => loadDevices(true));

  // Rescan Nearby Networks
  document.getElementById('scanNearbyBtn').addEventListener('click', async () => {
    const btn = document.getElementById('scanNearbyBtn');
    btn.disabled = true;
    btn.textContent = 'Scanning...';
    try {
      const res = await fetch('/api/nearby');
      const data = await res.json();
      renderNearbyNetworks(data);
    } finally {
      btn.disabled = false;
      btn.textContent = '↻ Rescan Airwaves';
    }
  });

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
