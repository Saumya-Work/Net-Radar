# Net-Radar

**Net-Radar** is a zero-dependency local Wi-Fi & Network Intelligence Dashboard for Windows that inspects hardware Wi-Fi telemetry, discovers connected LAN devices, analyzes nearby Wi-Fi spectrum & channel congestion, monitors real-time gateway vs. internet latency, and reveals saved Wi-Fi credentials with instant QR code sharing.

## Features

- **Real-Time Wi-Fi Signal & Radio Telemetry**:
  - Signal Quality (`%`), Exact RSSI (`dBm`), Estimated Noise Floor & SNR (`dB`)
  - SSID, AP BSSID, Router Hardware Vendor (IEEE OUI Lookup)
  - Wi-Fi Generation (`Wi-Fi 4 / 5 / 6 / 6E / 7`), Band (`2.4 GHz` / `5 GHz` / `6 GHz`), Channel, Center Frequency (`MHz`), Wavelength (`cm`)
  - Negotiated Link Speeds (`RX` / `TX` Mbps) & Live Interface Bandwidth (`KB/s` & `Mbps`)
- **Connected Devices Scanner (LAN / Wi-Fi Subnet)**:
  - Fast ARP cache scan & Active Deep Subnet Sweep (pings all 254 IPs in `/24`)
  - Identifies Gateway/Router, This PC, and all connected clients
  - Resolves IPv4, MAC Address, Manufacturer/Vendor, Randomized/Private MAC bit detection, Hostname, Open TCP service ports, and live ICMP Ping Latency (`ms`)
- **Nearby Wi-Fi Networks & Channel Congestion Analyzer**:
  - Scans all visible SSIDs and individual mesh/dual-band BSSIDs
  - Interactive 2.4 GHz & 5 GHz RF Channel Spectrum overlap charts
  - Recommends optimal least-congested 2.4 GHz and 5 GHz channels
- **IP, DHCP, DNS, Packet Stats & Adapter Hardware**:
  - Full `ipconfig /all`, `netstat -e`, and `netsh wlan show drivers` breakdown
  - Overview of all physical and virtual network interfaces on the system
- **Live Latency Monitor, Public IP / ISP & Speed Test**:
  - Dual real-time ping graph comparing Wi-Fi Router Gateway latency vs. Internet (`1.1.1.1`) latency + Jitter calculation
  - Public IP, ISP/ASN, Geolocation & built-in Download Speed Test
- **Saved Wi-Fi Profiles & Instant QR Code Share**:
  - Inspect saved Windows WLAN profiles, reveal/copy saved Wi-Fi passwords, and scan a live `WIFI:` QR code to connect phones immediately

## Quick Start

```bash
npm start
```

Then open **http://localhost:3000** in your browser.
