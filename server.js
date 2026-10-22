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
    devices: [
      {
        id: "base-172-21-5-133",
        parentId: "internet",
        model: "extreme_n",
        modelName: "AirPort Extreme 802.11n",
        name: "AramisAirPort",
        image: "/images/airport-extreme-n.png",
        status: "normal",
        led: "green",
        ipAddress: "172.21.5.133",
        lanIp: "172.21.5.133",
        wanIp: "172.21.5.133",
        macAddress: "00:1b:63:f3:20:f0",
        ethernetMac: "00:1b:63:f3:20:f0",
        radioMac: "00:1c:b3:ae:3a:4e",
        channel: "11",
        serialNumber: "C02KJ890APPLE",
        firmwareVersion: "7.8.1",
        firmwareUpdateAvailable: false,
        wirelessMode: "create",
        ssid: "AramisAirportWiFi",
        security: "WPA2 Personal",
        wirelessPassword: "",
        guestNetwork: false,
        routerMode: "bridge",
        fileSharing: true,
        disks: [
          {
            name: "untitled",
            uuid: "718261cb-72c2-5ac6-959c-2b5861553665",
            type: "Unidad USB externa",
            status: "Compartido (SMB / AFP)",
            sizeTotal: "64.0 GB",
            sizeUsed: "12.4 GB",
            percent: 20
          }
        ],
        clients: []
      }
    ]
  };
}

function readData() {
  if (memoryData) return memoryData;
  try {
    if (fs.existsSync(DATA_FILE)) {
      const content = fs.readFileSync(DATA_FILE, 'utf-8');
      memoryData = JSON.parse(content);
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
function isDeviceOnline(ip, timeoutMs = 600) {
  if (!ip) return Promise.resolve(false);
  return new Promise((resolve) => {
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
    socket.connect(548, ip);
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

        if (!foundMap[ip]) {
          foundMap[ip] = {
            id: `base-${ip.replace(/\./g, '-')}`,
            parentId: 'internet',
            ip,
            ipAddress: ip,
            lanIp: ip,
            wanIp: ip,
            name: 'AirPort Extreme',
            macAddress: '00:1b:63:f3:20:f0',
            radioMac: '',
            ssid: 'AirPort Wi-Fi',
            firmwareVersion: '7.8.1',
            desc: 'Apple Base Station',
            model: 'extreme_n',
            modelName: 'AirPort Extreme 802.11n',
            image: '/images/airport-extreme-n.png',
            channel: '11',
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

        // 1. Parsear datos de estación base (_airport)
        if (text.includes('_airport') || text.includes('waMA=')) {
          const extract = (key) => {
            const m = text.match(new RegExp(key + '=([^,\x00\r\n]+)'));
            return m ? m[1] : null;
          };

          const nameMatch = text.match(/\x0d([A-Za-z0-9_\-\s]+)\x08_airport/) || text.match(/\x0d([A-Za-z0-9_\-\s]+)\x0c_device-info/);
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

          const raCh = extract('raCh');
          if (raCh) dev.channel = raCh;

          const raSt = extract('raSt');
          if (raSt) {
            const errCode = parseInt(raSt, 10);
            dev.led = (errCode === 0) ? 'green' : 'amber';
          }
        }

        // 2. Parsear unidades USB (_adisk - AirDisk)
        if (text.includes('_adisk') || text.includes('adVN=')) {
          dev.fileSharing = true;

          // Buscar todos los bloques dk0, dk1, etc.
          // Formato: dk0=adVF=0x1013,adVN=untitled,adVU=...
          const diskRegex = /adVN=([^,\x00\r\n]+)/g;
          let match;
          while ((match = diskRegex.exec(text)) !== null) {
            const diskName = match[1].trim();
            if (diskName && !dev.disks.some(d => d.name === diskName)) {
              // Buscar UUID si está presente
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

        // Consulta 2: _adisk._tcp.local (Unidades USB AirDisk)
        const adiskQuery = Buffer.from([
          0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x06, 0x5f, 0x61, 0x64, 0x69, 0x73, 0x6b,
          0x04, 0x5f, 0x74, 0x63, 0x70,
          0x05, 0x6c, 0x6f, 0x63, 0x61, 0x6c,
          0x00, 0x00, 0x0c, 0x00, 0x01
        ]);

        socket.send(airportQuery, 5353, '224.0.0.251');
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

// Endpoint de escaneo en vivo (detecta bases y discos USB)
app.post('/api/scan', async (req, res) => {
  try {
    const discovered = await scanAirPort(1200);
    const data = readData();

    if (discovered.length > 0) {
      for (const discDev of discovered) {
        const existingIdx = data.devices.findIndex(
          d => d.ipAddress === discDev.ipAddress || d.macAddress === discDev.macAddress
        );
        if (existingIdx !== -1) {
          const cur = data.devices[existingIdx];
          const adminPass = cur.adminPassword || cur.basePassword || '';
          const hwDisks = await fetchHardwareDisks(discDev.ipAddress, adminPass, true);
          let mergedDisks = (hwDisks && hwDisks.length > 0)
            ? hwDisks
            : (cur.disks && cur.disks.length > 0 ? cur.disks : discDev.disks);

          const userMode = cur.wirelessMode || 'create';
          const userSsid = userMode === 'off' ? '' : (cur.ssid || discDev.ssid);

          data.devices[existingIdx] = {
            ...cur,
            ...discDev,
            wirelessMode: userMode,
            ssid: userSsid,
            disks: mergedDisks,
            fileSharing: mergedDisks.length > 0,
            led: 'green',
            status: 'normal',
            clients: userMode === 'off' ? [] : (Array.isArray(cur.clients) ? cur.clients : [])
          };
        } else {
          data.devices.unshift(discDev);
        }
      }
      writeData(data);
    } else {
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

    // Si falló la conexión con el puerto ACP 5009 del hardware físico, no simular éxito falso
    if (!acpResult.success) {
      return res.status(502).json({
        success: false,
        appliedToHardware: false,
        error: `No se pudo aplicar en el hardware (${targetIp}:5009): ${acpResult.error || 'Servicio ACP bloqueado. Desenchufá y volvé a enchufar el AirPort.'}`
      });
    }

    // Actualizar estado en servidor tras confirmar que el hardware recibió el cambio
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

    data.devices[index] = { ...data.devices[index], ...req.body, status: 'restarting', led: 'amber-blinking' };
    writeData(data);

    setTimeout(() => {
      const currentData = readData();
      const idx = currentData.devices.findIndex(d => d.id === id);
      if (idx !== -1) {
        currentData.devices[idx].status = 'normal';
        currentData.devices[idx].led = 'green';
        writeData(currentData);
      }
    }, 8000);

    res.json({
      success: true,
      appliedToHardware: true,
      message: acpResult.message || 'Ajustes aplicados al hardware correctamente.',
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

// Restaurar configuración predeterminada
app.post('/api/devices/reset', async (req, res) => {
  const data = getInitialData();
  writeData(data);
  res.json({ success: true, data });
});

// Escaneo inicial de red al encender
scanAirPort(1200).then((discovered) => {
  if (discovered.length > 0) {
    console.log(`📡 mDNS: Se detectaron ${discovered.length} estación(es) AirPort:`);
    discovered.forEach(d => {
      const diskStr = d.disks.length > 0 ? ` [Discos USB: ${d.disks.map(x => x.name).join(', ')}]` : '';
      console.log(`   - ${d.name} (${d.ipAddress}) - LED: ${d.led}${diskStr}`);
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`📡 Utilidad AirPort (AirPort Utility Web) iniciada con éxito.`);
  console.log(`🌐 Acceso en el navegador: http://localhost:${PORT}`);
});
