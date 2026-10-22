const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const dgram = require('dgram');

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
        clients: [
          {
            name: "Equipo Local (Juan)",
            ip: "172.21.5.5",
            mac: "b4:2e:99:f4:15:f3",
            signal: "-42 dBm",
            rate: "450 Mbps"
          }
        ]
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
            clients: [
              {
                name: "Equipo Local (Juan)",
                ip: getLocalNetworkInfo()[0]?.address || "172.21.5.5",
                mac: getLocalNetworkInfo()[0]?.mac || "enp3s0",
                signal: "-42 dBm",
                rate: "450 Mbps"
              }
            ]
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

// Rutas de API
app.get('/api/devices', (req, res) => {
  const data = readData();
  res.json(data);
});

// Endpoint de escaneo en vivo (detecta bases y discos USB)
app.post('/api/scan', async (req, res) => {
  try {
    const discovered = await scanAirPort(1200);
    const data = readData();

    if (discovered.length > 0) {
      discovered.forEach(discDev => {
        const existingIdx = data.devices.findIndex(
          d => d.ipAddress === discDev.ipAddress || d.macAddress === discDev.macAddress
        );
        if (existingIdx !== -1) {
          // Conservar discos detectados si vienen en el escaneo
          const mergedDisks = discDev.disks.length > 0 ? discDev.disks : data.devices[existingIdx].disks;
          data.devices[existingIdx] = {
            ...data.devices[existingIdx],
            ...discDev,
            disks: mergedDisks,
            fileSharing: mergedDisks.length > 0,
            led: 'green',
            status: 'normal'
          };
        } else {
          data.devices.unshift(discDev);
        }
      });
      memoryData = data;
    } else {
      // Si no se descubrió ningún dispositivo en la red física, marcar las estaciones como offline
      data.devices.forEach(d => {
        d.status = 'offline';
        d.led = 'amber-blinking';
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

  data.devices[index] = { ...data.devices[index], ...req.body };
  writeData(data);
  res.json({ success: true, device: data.devices[index] });
});

// Reiniciar estación base (simulación)
app.post('/api/devices/:id/restart', (req, res) => {
  const { id } = req.params;
  const data = readData();
  const dev = data.devices.find(d => d.id === id);

  if (!dev) {
    return res.status(404).json({ error: 'Dispositivo no encontrado' });
  }

  dev.status = 'restarting';
  dev.led = 'amber-blinking';

  setTimeout(() => {
    dev.status = 'normal';
    dev.led = 'green';
  }, 4000);

  res.json({ success: true, message: 'Reinicio iniciado', device: dev });
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
