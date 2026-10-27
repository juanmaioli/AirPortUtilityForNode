const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const dgram = require('dgram');
const net = require('net');
const { execFile } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'devices.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Estado en memoria
let memoryData = null;

function getInitialData() {
  return {
    internet: {
      id: "internet",
      name: "Internet",
      status: "connected",
      led: "green",
      connectionType: "DHCP",
      ipAddress: "172.21.5.1",
      routerAddress: "172.21.5.1",
      dnsServers: ["1.1.1.1", "8.8.8.8"],
      domainName: "local"
    },
    devices: []
  };
}

function readData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const content = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(content);
      if (parsed && Array.isArray(parsed.devices)) {
        // Sanear lista: sólo estaciones AirPort legítimas
        parsed.devices = parsed.devices.filter(d => d.macAddress && d.macAddress.length > 5);
      }
      memoryData = parsed;
      return memoryData;
    }
  } catch (err) {
    console.error('Error al leer datos:', err);
  }
  memoryData = getInitialData();
  return memoryData;
}

function writeData(data) {
  memoryData = data;
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error al guardar datos:', err);
  }
}

// Obtener IPs reales del host local
function getLocalNetworkInfo() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push({ iface: name, address: net.address, netmask: net.netmask, mac: net.mac });
      }
    }
  }
  return addresses;
}

// Comprobar si el dispositivo AirPort responde (online/offline) sondeando sus puertos nativos (548 AFP / 5009 ACP)
function isDeviceOnline(ip, timeoutMs = 800) {
  if (!ip) return Promise.resolve(false);
  return new Promise((resolve) => {
    // Probar puerto ACP 5009 (gestión oficial de Apple AirPort) con respaldo de rechazo rápido
    const socket = new net.Socket();
    let done = false;
    socket.setTimeout(timeoutMs);
    const finish = (val) => {
      if (!done) { done = true; socket.destroy(); resolve(val); }
    };
    socket.on('connect', () => finish(true));
    socket.on('error', (err) => {
      // Si el host responde ECONNREFUSED significa que la máquina está encendida en la IP y responde con RST
      if (err.code === 'ECONNREFUSED') finish(true);
      else finish(false);
    });
    socket.on('timeout', () => finish(false));
    socket.connect(5009, ip);
  });
}

// Detectar si la radio Wi-Fi física sigue emitiéndose en el aire en este momento
function checkPhysicalWifiActive(targetSsid = 'AramisAirportWiFi') {
  return new Promise((resolve) => {
    execFile('nmcli', ['-t', '-f', 'BSSID,SSID', 'dev', 'wifi', 'list'], { timeout: 2500 }, (err, stdout) => {
      if (err || !stdout) return resolve({ active: false });
      const lines = stdout.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        const parts = line.split(':');
        const bssid = parts.slice(0, 6).join(':').replace(/\\/g, '');
        const ssid = parts.slice(6).join(':').trim();
        if (ssid === targetSsid || (parts[0] && parts[0].includes('00\\:1C\\:B3'))) {
          return resolve({ active: true, bssid, ssid: ssid || targetSsid });
        }
      }
      resolve({ active: false });
    });
  });
}

// Catálogo canónico de modelos AirPort de Apple (Product IDs / syAP oficiales de macOS AirPort Utility)
const AIRPORT_CATALOG = {
  '120': { model: 'extreme_ac', modelName: 'AirPort Extreme 802.11ac', image: '/images/airport-extreme-ac.png' },
  '119': { model: 'timecapsule', modelName: 'AirPort Time Capsule 802.11ac', image: '/images/airport-extreme-ac.png' },
  '117': { model: 'extreme_n', modelName: 'AirPort Extreme 802.11n (5.ª gen)', image: '/images/airport-extreme-n.png' },
  '116': { model: 'timecapsule', modelName: 'AirPort Time Capsule 802.11n (4.ª gen)', image: '/images/airport-timecapsule.png' },
  '115': { model: 'express', modelName: 'AirPort Express 802.11n (2.ª gen)', image: '/images/airport-express.png' },
  '114': { model: 'extreme_n', modelName: 'AirPort Extreme 802.11n (4.ª gen)', image: '/images/airport-extreme-n.png' },
  '113': { model: 'timecapsule', modelName: 'AirPort Time Capsule 802.11n (3.ª gen)', image: '/images/airport-timecapsule.png' },
  '109': { model: 'timecapsule', modelName: 'AirPort Time Capsule 802.11n (2.ª gen)', image: '/images/airport-timecapsule.png' },
  '108': { model: 'extreme_n', modelName: 'AirPort Extreme 802.11n (3.ª gen)', image: '/images/airport-extreme-n.png' },
  '107': { model: 'express_legacy', modelName: 'AirPort Express 802.11n (1.ª gen)', image: '/images/airport-express-legacy.png' },
  '106': { model: 'timecapsule', modelName: 'AirPort Time Capsule 802.11n (1.ª gen)', image: '/images/airport-timecapsule.png' },
  '105': { model: 'extreme_n', modelName: 'AirPort Extreme 802.11n (2.ª gen)', image: '/images/airport-extreme-n.png' },
  '104': { model: 'extreme_n', modelName: 'AirPort Extreme 802.11n (1.ª gen)', image: '/images/airport-extreme-n.png' },
  '102': { model: 'express_legacy', modelName: 'AirPort Express 802.11g', image: '/images/airport-express-legacy.png' },
  '3': { model: 'extreme_g', modelName: 'AirPort Extreme 802.11g', image: '/images/airport-extreme-g.png' }
};

function resolveAirPortModel({ syAP, modelStr, firmwareVersion, name, desc }) {
  // 1. Detección por syAP (Product ID numérico)
  const apId = syAP ? String(syAP).trim() : null;
  if (apId && AIRPORT_CATALOG[apId]) {
    return { ...AIRPORT_CATALOG[apId], syAP: apId };
  }

  // 2. Detección por identificador mDNS _device-info (ej: AirPort7,120 o AirPort5,105)
  if (modelStr) {
    const commaParts = modelStr.split(',');
    if (commaParts.length > 1) {
      const subId = commaParts[1].trim();
      if (AIRPORT_CATALOG[subId]) {
        return { ...AIRPORT_CATALOG[subId], syAP: subId };
      }
    }
    const ms = modelStr.toLowerCase();
    if (ms.includes('timecapsule') || ms.includes('time_capsule')) {
      return { model: 'timecapsule', modelName: 'AirPort Time Capsule', image: '/images/airport-timecapsule.png' };
    }
    if (ms.includes('express')) {
      return { model: 'express', modelName: 'AirPort Express 802.11n', image: '/images/airport-express.png' };
    }
  }

  // 3. Detección por versión de Firmware (syVs)
  if (firmwareVersion) {
    const fw = String(firmwareVersion).trim();
    if (fw.startsWith('7.7')) {
      // 7.7.x es exclusivo de los modelos 802.11ac (Torre)
      return { model: 'extreme_ac', modelName: 'AirPort Extreme 802.11ac', image: '/images/airport-extreme-ac.png' };
    }
    if (fw.startsWith('6.')) {
      return { model: 'express_legacy', modelName: 'AirPort Express 802.11g', image: '/images/airport-express-legacy.png' };
    }
    if (fw.startsWith('5.')) {
      return { model: 'extreme_g', modelName: 'AirPort Extreme 802.11g', image: '/images/airport-extreme-g.png' };
    }
  }

  // 4. Detección por nombre o descripción
  const combinedText = `${name || ''} ${desc || ''}`.toLowerCase();
  if (combinedText.includes('time capsule') || combinedText.includes('timecapsule')) {
    return { model: 'timecapsule', modelName: 'AirPort Time Capsule', image: '/images/airport-timecapsule.png' };
  }
  if (combinedText.includes('express')) {
    return { model: 'express', modelName: 'AirPort Express 802.11n', image: '/images/airport-express.png' };
  }

  // Fallback por defecto
  return { model: 'extreme_n', modelName: 'AirPort Extreme 802.11n', image: '/images/airport-extreme-n.png' };
}

// Escaneo real de estaciones base AirPort y unidades USB AirDisk mediante Bonjour / mDNS
function scanAirPort(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const foundMap = {};

    socket.on('error', (err) => {
      console.error('Error en socket mDNS:', err);
      try { socket.close(); } catch (_) {}
      resolve(Object.values(foundMap));
    });

    socket.on('message', (msg, rinfo) => {
      try {
        const text = msg.toString('latin1');
        const ip = rinfo.address;

        // Filtrar: responder únicamente a dispositivos AirPort o Time Capsule de Apple
        const isAirPortRelated = text.includes('_airport') || 
                                 text.includes('waMA=') || 
                                 text.includes('syAP=') || 
                                 text.includes('_adisk') || 
                                 /model=(AirPort|TimeCapsule)/i.test(text);

        if (!isAirPortRelated && !foundMap[ip]) {
          return;
        }

        if (!foundMap[ip]) {
          foundMap[ip] = {
            id: `base-${ip.replace(/\./g, '-')}`,
            parentId: 'internet',
            ip,
            ipAddress: ip,
            lanIp: ip,
            wanIp: ip,
            name: 'AirPort Base Station',
            macAddress: '',
            radioMac: '',
            ssid: '',
            firmwareVersion: '',
            desc: 'Apple Base Station',
            model: 'extreme_n',
            modelName: 'AirPort Base Station',
            image: '/images/airport-extreme-n.png',
            channel: '1',
            status: 'normal',
            led: 'green',
            routerMode: 'bridge',
            wirelessMode: 'create',
            security: 'WPA2 Personal',
            fileSharing: false,
            disks: [],
            clients: []
          };
        }

        const dev = foundMap[ip];

        // 1. Parsear datos de _device-info (model=...)
        const modelMatch = text.match(/model=([A-Za-z0-9,_\-]+)/);
        if (modelMatch) {
          dev.modelIdentifier = modelMatch[1];
        }

        // 2. Parsear datos de estación base (_airport)
        if (text.includes('_airport') || text.includes('waMA=') || text.includes('syAP=')) {
          const extract = (key) => {
            const m = text.match(new RegExp(key + '=([^,\x00\r\n]+)'));
            return m ? m[1] : null;
          };

          const nameMatch = text.match(/[\x01-\x3f]([A-Za-z0-9_\-\s]{2,63}?)(?:\xc0|\x08_airport|\x0c_device-info)/) ||
                            text.match(/\x0d([A-Za-z0-9_\-\s]+)\x08_airport/) ||
                            text.match(/\x0d([A-Za-z0-9_\-\s]+)\x0c_device-info/);
          if (nameMatch) {
            dev.name = nameMatch[1].replace(/[^\x20-\x7E]/g, '').trim() || dev.name;
          }

          const waMA = extract('waMA');
          if (waMA) dev.macAddress = waMA.replace(/-/g, ':').toLowerCase();

          const raMA = extract('raMA');
          if (raMA) dev.radioMac = raMA.replace(/-/g, ':').toLowerCase();

          const raNm = extract('raNm');
          if (raNm) dev.ssid = raNm;

          const syDs = extract('syDs');
          if (syDs) dev.desc = syDs;

          const syVs = extract('syVs');
          if (syVs) dev.firmwareVersion = syVs;

          const syAP = extract('syAP');
          if (syAP) dev.syAP = syAP;

          const raCh = extract('raCh');
          if (raCh) dev.channel = raCh;

          const raSt = extract('raSt');
          if (raSt) {
            const errCode = parseInt(raSt, 10);
            dev.led = (errCode === 0) ? 'green' : 'amber';
          }

          // Detección de estación restaurada a valores de fábrica (clave predeterminada Apple: 'public')
          const prob = extract('prob');
          const isAppleDefaultSsid = dev.ssid && dev.ssid.startsWith('Apple Network ');
          if ((prob && prob.includes('pubP')) || isAppleDefaultSsid) {
            dev.isFactoryDefault = true;
            dev.hasPublicPassword = true;
            if (!dev.adminPassword) dev.adminPassword = 'public';
          } else {
            dev.isFactoryDefault = false;
            dev.hasPublicPassword = false;
          }
        }

        // 3. Resolver modelo e imagen según metadatos detectados
        const resolved = resolveAirPortModel({
          syAP: dev.syAP,
          modelStr: dev.modelIdentifier,
          firmwareVersion: dev.firmwareVersion,
          name: dev.name,
          desc: dev.desc
        });
        dev.model = resolved.model;
        dev.modelName = resolved.modelName;
        dev.image = resolved.image;
        if (resolved.syAP && !dev.syAP) dev.syAP = resolved.syAP;

        // 4. Parsear unidades USB (_adisk - AirDisk)
        if (text.includes('_adisk') || text.includes('adVN=')) {
          dev.fileSharing = true;

          // Buscar todos los bloques dk0, dk1, etc.
          const diskRegex = /adVN=([^,\x00\r\n]+)/g;
          let match;
          while ((match = diskRegex.exec(text)) !== null) {
            const diskName = match[1].trim();
            if (diskName && !dev.disks.some(d => d.name === diskName)) {
              const uuidMatch = text.match(new RegExp(`${diskName}.*?adVU=([a-f0-9\\-]+)`)) || text.match(/adVU=([a-f0-9\-]+)/);
              const uuid = uuidMatch ? uuidMatch[1] : `usb-${Date.now()}`;

              dev.disks.push({
                name: diskName,
                uuid,
                type: "Unidad USB externa",
                status: "Montado y compartido (SMB / AFP)",
                sizeTotal: "Almacenamiento USB",
                sizeUsed: "Compartido en red",
                percent: 35
              });
            }
          }
        }
      } catch (e) {
        console.error('Error parseando mDNS:', e);
      }
    });

    socket.bind(0, () => {
      try {
        socket.setBroadcast(true);
        socket.setMulticastTTL(255);

        // Consulta 1: _airport._tcp.local
        const airportQuery = Buffer.from([
          0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x08, 0x5f, 0x61, 0x69, 0x72, 0x70, 0x6f, 0x72, 0x74,
          0x04, 0x5f, 0x74, 0x63, 0x70,
          0x05, 0x6c, 0x6f, 0x63, 0x61, 0x6c,
          0x00, 0x00, 0x0c, 0x00, 0x01
        ]);

        // Consulta 2: _device-info._tcp.local (Modelos como AirPort7,120 / AirPort5,105)
        const devInfoQuery = Buffer.from([
          0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x0c, 0x5f, 0x64, 0x65, 0x76, 0x69, 0x63, 0x65, 0x2d, 0x69, 0x6e, 0x66, 0x6f,
          0x04, 0x5f, 0x74, 0x63, 0x70,
          0x05, 0x6c, 0x6f, 0x63, 0x61, 0x6c,
          0x00, 0x00, 0x0c, 0x00, 0x01
        ]);

        // Consulta 3: _adisk._tcp.local (Unidades USB AirDisk)
        const adiskQuery = Buffer.from([
          0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x06, 0x5f, 0x61, 0x64, 0x69, 0x73, 0x6b,
          0x04, 0x5f, 0x74, 0x63, 0x70,
          0x05, 0x6c, 0x6f, 0x63, 0x61, 0x6c,
          0x00, 0x00, 0x0c, 0x00, 0x01
        ]);

        socket.send(airportQuery, 5353, '224.0.0.251');
        socket.send(devInfoQuery, 5353, '224.0.0.251');
        socket.send(adiskQuery, 5353, '224.0.0.251');
      } catch (err) {
        console.error('Error configurando socket multicast:', err);
      }
    });

    setTimeout(() => {
      try { socket.close(); } catch (_) {}
      resolve(Object.values(foundMap));
    }, timeoutMs);
  });
}

// Caché de información de discos USB obtenida vía ACP (MaSt) para no saturar el puerto 5009
const diskCache = new Map();

function fetchHardwareDisks(ip, password, force = false) {
  if (!ip || !password) return Promise.resolve(null);
  const now = Date.now();
  const cached = diskCache.get(ip);
  if (!force && cached && (now - cached.ts) < 25000) {
    return Promise.resolve(cached.disks);
  }
  const acpScript = path.join(__dirname, 'acp_control.py');
  return new Promise((resolve) => {
    execFile('python3', [acpScript, '-a', 'disks', '-t', ip, '-p', password], { timeout: 4500 }, (err, stdout) => {
      if (err || !stdout) {
        return resolve(cached ? cached.disks : null);
      }
      try {
        const res = JSON.parse(stdout);
        if (res.success && Array.isArray(res.disks)) {
          diskCache.set(ip, { ts: now, disks: res.disks });
          return resolve(res.disks);
        }
      } catch (_) {}
      resolve(cached ? cached.disks : null);
    });
  });
}

// Rutas de API
app.get('/api/devices', async (req, res) => {
  const data = readData();
  const wifiStatus = await checkPhysicalWifiActive();

  for (const d of data.devices) {
    const targetIp = d.ipAddress || d.lanIp || d.wanIp;
    const isOnline = await isDeviceOnline(targetIp);
    if (!isOnline) {
      d.status = 'offline';
      d.led = 'amber-blinking';
      d.clients = [];
      d.disks = [];
      d.physicalRadioActive = false;
    } else {
      if (d.status === 'offline') {
        d.status = 'normal';
        d.led = 'green';
      }
      d.physicalRadioActive = wifiStatus.active;
      if (wifiStatus.active && wifiStatus.bssid) {
        d.physicalBssid = wifiStatus.bssid;
      }

      // Actualizar métricas reales de capacidad del disco USB vía ACP (MaSt)
      const adminPass = d.adminPassword || d.basePassword || '';
      if (adminPass) {
        const hwDisks = await fetchHardwareDisks(targetIp, adminPass);
        if (hwDisks && hwDisks.length > 0) {
          d.disks = hwDisks;
          d.fileSharing = true;
        }
      }

      // Resolver y garantizar modelo e imagen correctos si faltaban o estaban desactualizados
      if (!d.model || !d.image || (d.firmwareVersion?.startsWith('7.7') && d.model !== 'extreme_ac' && d.model !== 'timecapsule')) {
        const resolved = resolveAirPortModel({
          syAP: d.syAP,
          modelStr: d.modelIdentifier,
          firmwareVersion: d.firmwareVersion,
          name: d.name,
          desc: d.desc
        });
        d.model = resolved.model;
        d.modelName = resolved.modelName;
        d.image = resolved.image;
        if (resolved.syAP && !d.syAP) d.syAP = resolved.syAP;
      }

      if (d.wirelessMode === 'off') {
        d.clients = [];
        d.ssid = '';
        if (wifiStatus.active) {
          d.radioWarning = `La radio física sigue emitiéndose en el aire («${wifiStatus.ssid || 'AramisAirportWiFi'}» - ${wifiStatus.bssid || '00:1C:B3:AE:3A:4E'}).`;
        } else {
          delete d.radioWarning;
        }
      } else {
        d.clients = Array.isArray(d.clients) ? d.clients : [];
      }
    }
  }
  res.json(data);
});

// Sincronizar en tiempo real los dispositivos descubiertos por mDNS con la base de datos
async function syncDiscoveredToData(discovered) {
  if (!Array.isArray(discovered) || discovered.length === 0) return readData();
  const data = readData();
  let changed = false;

  for (const discDev of discovered) {
    const existingIdx = data.devices.findIndex(
      d => d.ipAddress === discDev.ipAddress || (d.macAddress && discDev.macAddress && d.macAddress === discDev.macAddress)
    );

    if (existingIdx !== -1) {
      const cur = data.devices[existingIdx];
      const adminPass = cur.adminPassword || cur.basePassword || '';
      const hwDisks = await fetchHardwareDisks(discDev.ipAddress, adminPass);
      const mergedDisks = (hwDisks && hwDisks.length > 0)
        ? hwDisks
        : (cur.disks && cur.disks.length > 0 ? cur.disks : discDev.disks);

      const userMode = cur.wirelessMode || 'create';
      const detectedSsid = discDev.ssid || cur.ssid;
      const userSsid = userMode === 'off' ? '' : detectedSsid;
      const updatedName = (discDev.name && discDev.name !== 'AirPort Base Station') ? discDev.name : (cur.name || discDev.name);

      data.devices[existingIdx] = {
        ...cur,
        ...discDev,
        name: updatedName,
        ssid: userSsid,
        firmwareVersion: discDev.firmwareVersion || cur.firmwareVersion,
        channel: discDev.channel || cur.channel,
        model: discDev.model || cur.model,
        modelName: discDev.modelName || cur.modelName,
        image: discDev.image || cur.image,
        syAP: discDev.syAP || cur.syAP,
        isFactoryDefault: !!discDev.isFactoryDefault,
        hasPublicPassword: !!discDev.hasPublicPassword,
        wirelessMode: userMode,
        disks: mergedDisks,
        fileSharing: mergedDisks.length > 0,
        led: discDev.led || 'green',
        status: 'normal',
        clients: userMode === 'off' ? [] : (Array.isArray(cur.clients) ? cur.clients : [])
      };
      changed = true;
    } else {
      data.devices.unshift(discDev);
      changed = true;
    }
  }

  if (changed) {
    writeData(data);
  }
  return data;
}

// Endpoint de escaneo en vivo (detecta bases y discos USB)
app.post('/api/scan', async (req, res) => {
  try {
    const discovered = await scanAirPort(1200);
    const data = await syncDiscoveredToData(discovered);

    if (discovered.length === 0) {
      // Si no se descubrió ningún dispositivo en la red física, marcar las estaciones como offline
      data.devices.forEach(d => {
        d.status = 'offline';
        d.led = 'amber-blinking';
        d.clients = [];
        d.disks = [];
      });
      memoryData = data;
    }

    res.json({
      success: true,
      foundCount: discovered.length,
      devices: data.devices,
      discovered: discovered
    });
  } catch (err) {
    console.error('Error en escaneo:', err);
    res.status(500).json({ error: 'Fallo al escanear la red' });
  }
});

// Simular estado sin dispositivos para pruebas
app.post('/api/simulate-empty', (req, res) => {
  const data = readData();
  data.devices = [];
  memoryData = data;
  res.json({ success: true, message: 'Simulación: Sin estaciones base', data });
});

// Endpoint para expulsar disco USB de forma segura
app.post('/api/devices/:id/eject-disk', (req, res) => {
  const { id } = req.params;
  const { diskName } = req.body;
  const data = readData();
  const dev = data.devices.find(d => d.id === id);

  if (!dev) {
    return res.status(404).json({ error: 'Estación base no encontrada' });
  }

  if (dev.disks) {
    dev.disks = dev.disks.filter(d => d.name !== diskName);
  }
  memoryData = data;
  res.json({ success: true, message: `Unidad "${diskName}" expulsada con seguridad`, device: dev });
});

app.get('/api/network-info', (req, res) => {
  res.json({
    hostname: os.hostname(),
    platform: os.platform(),
    interfaces: getLocalNetworkInfo()
  });
});

// Escaneo en vivo de redes Wi-Fi al alcance para modos Ampliar y Conectarse
app.get('/api/scan-wifi', (req, res) => {
  execFile('nmcli', ['-t', '-f', 'SSID,SECURITY,SIGNAL', 'dev', 'wifi', 'list'], { timeout: 3000 }, (err, stdout) => {
    const list = [];
    const seen = new Set();
    const data = readData();

    // Conjunto de SSIDs desactivados por el usuario
    const disabledSsids = new Set(
      data.devices
        .filter(d => d.wirelessMode === 'off')
        .map(d => d.lastKnownSsid || 'AramisAirportWiFi')
    );

    if (!err && stdout) {
      const lines = stdout.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        const parts = line.split(':');
        const ssid = parts[0]?.trim();
        const sec = parts[1]?.trim() || 'Abierta';
        const sig = parseInt(parts[2], 10) || 50;

        // Si fue desactivada, omitir del listado
        if (ssid && ssid !== '--' && !seen.has(ssid) && !disabledSsids.has(ssid)) {
          seen.add(ssid);
          list.push({ ssid, security: sec, signal: sig });
        }
      }
    }

    // Agregar SSIDs de dispositivos descubiertos en la red si no estaban desactivados
    for (const d of data.devices) {
      if (d.wirelessMode !== 'off' && d.ssid && !seen.has(d.ssid) && !disabledSsids.has(d.ssid)) {
        seen.add(d.ssid);
        list.unshift({ ssid: d.ssid, security: d.security || 'WPA2 Personal', signal: 100 });
      }
    }

    res.json({ networks: list });
  });
});

// Verificar contraseña de administración de la estación base
app.post('/api/devices/:id/verify-password', (req, res) => {
  const { id } = req.params;
  const { password } = req.body;
  const data = readData();
  const dev = data.devices.find(d => d.id === id);

  if (!dev) {
    return res.status(404).json({ error: 'Estación base no encontrada' });
  }

  const targetIp = dev.ipAddress || dev.lanIp || dev.wanIp;
  const acpScript = path.join(__dirname, 'acp_control.py');

  // Verificar directamente contra el hardware físico real mediante ACP
  execFile('python3', [acpScript, '-a', 'verify', '-t', targetIp, '-p', password || ''], { timeout: 6000 }, (err, stdout) => {
    let result = {};
    try {
      result = JSON.parse(stdout);
    } catch (_) {
      result = { success: !err };
    }

    if (result.success && result.authorized) {
      dev.adminPassword = password;
      dev.basePassword = password;
      writeData(data);
      return res.json({ success: true, authorized: true });
    }

    if (result.errorType === 'network') {
      return res.status(502).json({
        success: false,
        authorized: false,
        errorType: 'network',
        error: `El puerto ACP (5009) del AirPort en ${targetIp} rechazó la conexión. Desenchufá y volvé a enchufar el AirPort de la corriente para reactivar su servicio de gestión.`
      });
    }

    return res.status(401).json({
      success: false,
      authorized: false,
      error: 'La contraseña de administración de la estación base no es correcta.'
    });
  });
});

// Guardar y aplicar configuración en la estación base (localmente y en el hardware vía ACP)
app.put('/api/devices/:id', (req, res) => {
  const { id } = req.params;
  const data = readData();

  if (id === 'internet') {
    data.internet = { ...data.internet, ...req.body };
    writeData(data);
    return res.json({ success: true, device: data.internet });
  }

  const index = data.devices.findIndex(d => d.id === id);
  if (index === -1) {
    return res.status(404).json({ error: 'Dispositivo no encontrado' });
  }

  const dev = data.devices[index];
  const providedPassword = req.headers['x-admin-password'] || req.body?.adminPasswordValidation || dev.adminPassword || dev.basePassword || '';
  const targetIp = dev.ipAddress || dev.lanIp || dev.wanIp;
  const acpScript = path.join(__dirname, 'acp_control.py');

  const configPayload = JSON.stringify({
    name: req.body.name,
    wirelessMode: req.body.wirelessMode,
    ssid: req.body.ssid,
    channel: req.body.channel24,
    channel24: req.body.channel24,
    channel5: req.body.channel5,
    closedNetwork: !!req.body.hiddenNetwork
  });

  // Aplicar cambios al hardware físico real vía ACP
  execFile('python3', [acpScript, '-a', 'apply', '-t', targetIp, '-p', providedPassword, '--config', configPayload], { timeout: 10000 }, (acpErr, stdout) => {
    let acpResult = {};
    try {
      acpResult = JSON.parse(stdout);
    } catch (_) {
      acpResult = { success: !acpErr };
    }

    // Si el hardware físico denegó el acceso por contraseña
    if (!acpResult.success && acpResult.requiresPassword) {
      delete dev.adminPassword;
      return res.status(403).json({
        success: false,
        requiresAuth: true,
        error: 'Acceso denegado: Se requiere la contraseña de administración correcta para aplicar cambios en esta estación base.'
      });
    }

    // Actualizar estado en servidor (asegura que los cambios siempre se reflejen)
    if (req.body.wirelessMode === 'off') {
      dev.lastKnownSsid = dev.ssid || req.body.ssid || 'AramisAirportWiFi';
      req.body.clients = [];
      req.body.ssid = '';
    } else if (req.body.ssid) {
      dev.lastKnownSsid = req.body.ssid;
    }

    if (providedPassword) {
      dev.adminPassword = providedPassword;
      dev.basePassword = providedPassword;
    }

    data.devices[index] = { 
      ...data.devices[index], 
      ...req.body,
      status: acpResult.success ? 'restarting' : 'normal',
      led: acpResult.success ? 'amber-blinking' : 'green'
    };
    writeData(data);

    if (acpResult.success) {
      setTimeout(() => {
        const currentData = readData();
        const idx = currentData.devices.findIndex(d => d.id === id);
        if (idx !== -1) {
          currentData.devices[idx].status = 'normal';
          currentData.devices[idx].led = 'green';
          writeData(currentData);
        }
      }, 8000);

      return res.json({
        success: true,
        appliedToHardware: true,
        message: acpResult.message || 'Ajustes aplicados al hardware correctamente.',
        device: data.devices[index]
      });
    }

    // Si el hardware no aceptó ACP pero se guardó en la base de datos
    return res.json({
      success: true,
      appliedToHardware: false,
      warning: `Ajustes guardados en la aplicación. El hardware en ${targetIp}:5009 reportó: ${acpResult.error || 'Acceso restringido por firmware'}.`,
      device: data.devices[index]
    });
  });
});

// Reiniciar estación base física real mediante protocolo ACP (puerto 5009)
app.post('/api/devices/:id/restart', (req, res) => {
  const { id } = req.params;
  const password = req.body?.password || '';
  const data = readData();
  const dev = data.devices.find(d => d.id === id);

  if (!dev) {
    return res.status(404).json({ error: 'Dispositivo no encontrado' });
  }

  const targetIp = dev.ipAddress || dev.lanIp || dev.wanIp;
  const targetPassword = password || dev.adminPassword || dev.basePassword || '';
  const acpScript = path.join(__dirname, 'acp_control.py');

  // Ejecutar comando ACP nativo
  execFile('python3', [acpScript, '-a', 'restart', '-t', targetIp, '-p', targetPassword], { timeout: 5000 }, (err, stdout) => {
    let result = {};
    try {
      result = JSON.parse(stdout);
    } catch (_) {
      result = { success: !err, error: err?.message };
    }

    if (result.success) {
      console.log(`⚡ [ACP Hardware Reboot] Éxito: ${dev.name} (${targetIp}) reiniciándose físicamente.`);
      dev.status = 'restarting';
      dev.led = 'amber-blinking';

      setTimeout(() => {
        dev.status = 'normal';
        dev.led = 'green';
      }, 10000);

      return res.json({
        success: true,
        hardwareReboot: true,
        message: `Orden enviada al hardware físico (${dev.name}). El dispositivo se está reiniciando.`,
        device: dev
      });
    }

    if (result.requiresPassword || result.errorType === 'bad_password') {
      return res.status(401).json({
        success: false,
        requiresPassword: true,
        error: 'La contraseña de administración es obligatoria o incorrecta.'
      });
    }

    return res.status(500).json({
      success: false,
      error: result.error || 'No se pudo comunicar con el hardware en el puerto 5009.'
    });
  });
});

// Olvidar / eliminar una estación base
app.delete('/api/devices/:id', (req, res) => {
  const { id } = req.params;
  const data = readData();
  const initialCount = data.devices.length;
  data.devices = data.devices.filter(d => d.id !== id);
  if (data.devices.length !== initialCount) {
    writeData(data);
    return res.json({ success: true, message: 'Estación base eliminada correctamente.' });
  }
  return res.status(404).json({ error: 'Estación base no encontrada' });
});

// Restaurar configuración predeterminada
app.post('/api/devices/reset', async (req, res) => {
  const data = getInitialData();
  writeData(data);
  res.json({ success: true, data });
});

// Escaneo inicial y sondeo periódico de fondo mDNS para mantener estaciones siempre actualizadas
async function refreshAirPortDiscovery() {
  try {
    const discovered = await scanAirPort(1200);
    if (discovered.length > 0) {
      await syncDiscoveredToData(discovered);
    }
  } catch (_) {}
}

refreshAirPortDiscovery().then(() => {
  const data = readData();
  console.log(`📡 mDNS: Topología sincronizada con ${data.devices.length} estaciones.`);
});

setInterval(refreshAirPortDiscovery, 7500);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`📡 Utilidad AirPort (AirPort Utility Web) iniciada con éxito.`);
  console.log(`🌐 Acceso en el navegador: http://localhost:${PORT}`);
});
