// ========================================================
// AirPort Utility Web - Frontend Application
// ========================================================

let state = {
  internet: null,
  devices: [],
  selectedDeviceId: null,
  activeEditingDevice: null,
  hostInfo: null
};

// Elementos DOM principales
const nodesLayer = document.getElementById('nodesLayer');
const topologySvg = document.getElementById('topologySvg');
const devicePopover = document.getElementById('devicePopover');
const popoverArrow = document.getElementById('popoverArrow');
const editModalBackdrop = document.getElementById('editModalBackdrop');
const addDeviceModalBackdrop = document.getElementById('addDeviceModalBackdrop');
const dropdownMenuStations = document.getElementById('dropdownMenuStations');
const btnOtherStations = document.getElementById('btnOtherStations');
const devicesCountBadge = document.getElementById('devicesCountBadge');
const topologyCount = document.getElementById('topologyCount');
const systemHostInfo = document.getElementById('systemHostInfo');
const btnRefresh = document.getElementById('btnRefresh');
const refreshSpinner = document.getElementById('refreshSpinner');
const btnResetAll = document.getElementById('btnResetAll');
const btnAddDevice = document.getElementById('btnAddDevice');
const macToast = document.getElementById('macToast');
const toastMessage = document.getElementById('toastMessage');
const emptyStateOverlay = document.getElementById('emptyStateOverlay');
const btnEmptyRetry = document.getElementById('btnEmptyRetry');
const emptyRetrySpinner = document.getElementById('emptyRetrySpinner');
const globalStatusPill = document.getElementById('globalStatusPill');
const globalStatusText = document.getElementById('globalStatusText');

// Elementos del Modal de Autenticación
const authModalBackdrop = document.getElementById('authModalBackdrop');
const authTitle = document.getElementById('authTitle');
const authPromptText = document.getElementById('authPromptText');
const inputAuthPassword = document.getElementById('inputAuthPassword');
const checkAuthRemember = document.getElementById('checkAuthRemember');
const authErrorMessage = document.getElementById('authErrorMessage');
const btnAuthCancel = document.getElementById('btnAuthCancel');
const btnAuthSubmit = document.getElementById('btnAuthSubmit');

// Almacén de contraseñas de sesión desbloqueadas
const sessionUnlockedPasswords = {};

// Elementos del Popover
const popoverThumb = document.getElementById('popoverThumb');
const popoverLed = document.getElementById('popoverLed');
const popoverTitle = document.getElementById('popoverTitle');
const popoverSubtitle = document.getElementById('popoverSubtitle');
const popoverStatusText = document.getElementById('popoverStatusText');
const popoverIp = document.getElementById('popoverIp');
const popoverWanIp = document.getElementById('popoverWanIp');
const popoverLanIp = document.getElementById('popoverLanIp');
const popoverFirmware = document.getElementById('popoverFirmware');
const popoverMac = document.getElementById('popoverMac');
const popoverClientsBadge = document.getElementById('popoverClientsBadge');
const popoverClientsList = document.getElementById('popoverClientsList');
const popoverClientsSection = document.getElementById('popoverClientsSection');
const btnPopoverRestart = document.getElementById('btnPopoverRestart');
const btnPopoverEdit = document.getElementById('btnPopoverEdit');
const btnUpdateFirmware = document.getElementById('btnUpdateFirmware');

// Inicialización
window.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  fetchNetworkInfo();
  loadTopologyData();
  startLivePolling();
  window.addEventListener('resize', () => renderTopology());
});

// Registrar eventos
function initEventListeners() {
  // Botón Volver a explorar en pantalla vacía
  if (btnEmptyRetry) {
    btnEmptyRetry.addEventListener('click', () => {
      emptyRetrySpinner.classList.add('spinning');
      btnRefresh.click();
      setTimeout(() => {
        emptyRetrySpinner.classList.remove('spinning');
      }, 1500);
    });
  }

  // Menú desplegable Otras estaciones
  btnOtherStations.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdownMenuStations.classList.toggle('show');
    const isShown = dropdownMenuStations.classList.contains('show');
    btnOtherStations.setAttribute('aria-expanded', isShown ? 'true' : 'false');
  });

  document.addEventListener('click', (e) => {
    if (!dropdownMenuStations.contains(e.target) && e.target !== btnOtherStations) {
      dropdownMenuStations.classList.remove('show');
      btnOtherStations.setAttribute('aria-expanded', 'false');
    }
    // Cerrar popover si hace clic en el fondo del lienzo
    if (!devicePopover.contains(e.target) && !e.target.closest('.topo-node')) {
      closePopover();
    }
  });

  // Botón Explorar
  btnRefresh.addEventListener('click', async () => {
    refreshSpinner.classList.add('spinning');
    showToast('Explorando la red en busca de estaciones base AirPort...');
    try {
      const res = await fetch('/api/scan', { method: 'POST' });
      const scanResult = await res.json();
      await loadTopologyData();
      refreshSpinner.classList.remove('spinning');

      if (scanResult.foundCount > 0) {
        const found = scanResult.discovered[0];
        showToast(`Se encontró "${found.name}" (${found.ipAddress}) con luz verde`);
        // Seleccionar y enfocar automáticamente el AirPort detectado
        state.selectedDeviceId = found.id;
        renderTopology();
        const dev = getSelectedDevice();
        if (dev) openDevicePopover(dev);
      } else {
        showToast('Topología de red actualizada');
      }
    } catch (err) {
      console.error(err);
      refreshSpinner.classList.remove('spinning');
      await loadTopologyData();
      showToast('Escaneo completado');
    }
  });

  // Botón Restablecer
  btnResetAll.addEventListener('click', async () => {
    if (confirm('¿Restablecer la configuración predeterminada de las estaciones base AirPort?')) {
      const res = await fetch('/api/devices/reset', { method: 'POST' });
      if (res.ok) {
        showToast('Configuración restaurada con éxito');
        closePopover();
        await loadTopologyData();
      }
    }
  });

  // Popover: Editar con validación obligatoria de contraseña
  btnPopoverEdit.addEventListener('click', () => {
    const dev = getSelectedDevice();
    if (!dev) return;

    if (dev.id === 'internet') {
      openEditModal(dev);
      return;
    }

    // Verificar si ya fue desbloqueada en esta sesión o en llavero
    const rememberedPass = localStorage.getItem('airport_keychain_' + dev.id);
    if (rememberedPass) {
      sessionUnlockedPasswords[dev.id] = rememberedPass;
    }

    if (sessionUnlockedPasswords[dev.id]) {
      openEditModal(dev);
    } else {
      promptDevicePassword(dev, () => openEditModal(dev));
    }
  });

  // Popover: Reiniciar hardware
  btnPopoverRestart.addEventListener('click', async () => {
    const dev = getSelectedDevice();
    if (!dev || dev.id === 'internet') return;

    btnPopoverRestart.disabled = true;
    btnPopoverRestart.textContent = 'Enviando...';
    showToast(`Conectando con "${dev.name}" (puerto 5009)...`);

    async function sendRestart(password = '') {
      const res = await fetch(`/api/devices/${dev.id}/restart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      return { status: res.status, data };
    }

    try {
      let result = await sendRestart();

      // Si requiere contraseña de administración
      if (result.status === 401 && result.data.requiresPassword) {
        const pass = prompt(`Ingrese la contraseña de administración de "${dev.name}" para autorizar el reinicio del hardware físico:`);
        if (pass !== null) {
          result = await sendRestart(pass);
        } else {
          btnPopoverRestart.disabled = false;
          btnPopoverRestart.textContent = 'Reiniciar';
          return;
        }
      }

      if (result.status === 200 && result.data.success) {
        showToast(`⚡ ${result.data.message}`);
        await loadTopologyData();
        setTimeout(async () => {
          await loadTopologyData();
          if (state.selectedDeviceId === dev.id) {
            openDevicePopover(getSelectedDevice());
          }
          btnPopoverRestart.disabled = false;
          btnPopoverRestart.textContent = 'Reiniciar';
        }, 10000);
      } else {
        showToast(`⚠️ ${result.data.error || 'No se pudo reiniciar la estación base'}`);
        btnPopoverRestart.disabled = false;
        btnPopoverRestart.textContent = 'Reiniciar';
      }
    } catch (err) {
      console.error(err);
      showToast('⚠️ Error al comunicarse con el servidor de reinicio');
      btnPopoverRestart.disabled = false;
      btnPopoverRestart.textContent = 'Reiniciar';
    }
  });

  // Modal: Pestañas de configuración
  document.querySelectorAll('.sheet-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sheet-tabs .tab-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      const targetPane = document.getElementById(btn.dataset.tab);
      if (targetPane) targetPane.classList.add('active');
    });
  });

  // Modal: Cancelar / Guardar
  document.getElementById('btnCancelEdit').addEventListener('click', () => {
    editModalBackdrop.style.display = 'none';
  });

  document.getElementById('btnSaveEdit').addEventListener('click', saveDeviceEdit);

  // Modal: Añadir estación base
  btnAddDevice.addEventListener('click', openAddDeviceModal);
  document.getElementById('btnAddCancel').addEventListener('click', () => {
    addDeviceModalBackdrop.style.display = 'none';
  });
  document.getElementById('btnAddConfirm').addEventListener('click', submitAddDevice);

  // Eventos de la pestaña Inalámbrica
  const selectWirelessMode = document.getElementById('selectWirelessMode');
  selectWirelessMode.addEventListener('change', () => {
    updateWirelessModeUI();
  });

  const selectDiscoveredSsids = document.getElementById('selectDiscoveredSsids');
  selectDiscoveredSsids.addEventListener('change', () => {
    const boxOtherSsid = document.getElementById('boxOtherSsid');
    const inputOtherSsid = document.getElementById('inputOtherSsid');
    if (selectDiscoveredSsids.value === '__other__') {
      boxOtherSsid.style.display = 'block';
      inputOtherSsid.focus();
    } else {
      boxOtherSsid.style.display = 'none';
      if (selectDiscoveredSsids.value) {
        const selectedOpt = selectDiscoveredSsids.selectedOptions[0];
        if (selectedOpt && selectedOpt.dataset.security) {
          const sec = selectedOpt.dataset.security;
          const selectSecurity = document.getElementById('selectSecurity');
          if (sec.includes('WPA2') || sec.includes('WPA3')) {
            selectSecurity.value = 'WPA2 Personal';
          } else if (sec.includes('WEP')) {
            selectSecurity.value = 'WEP';
          } else if (sec.includes('Abierta') || sec === '--') {
            selectSecurity.value = 'Ninguna';
          }
          selectSecurity.dispatchEvent(new Event('change'));
        }
      }
    }
  });

  // Red de 5 GHz toggle
  const check5GHz = document.getElementById('check5GHz');
  const box5GHzSsid = document.getElementById('box5GHzSsid');
  check5GHz.addEventListener('change', () => {
    box5GHzSsid.style.display = check5GHz.checked ? 'block' : 'none';
  });

  // Seguridad Wi-Fi toggle
  const selectSecurity = document.getElementById('selectSecurity');
  const groupWifiPassword = document.getElementById('groupWifiPassword');
  const groupWifiPasswordConfirm = document.getElementById('groupWifiPasswordConfirm');
  selectSecurity.addEventListener('change', () => {
    const isNone = selectSecurity.value === 'Ninguna';
    groupWifiPassword.style.display = isNone ? 'none' : 'block';
    groupWifiPasswordConfirm.style.display = isNone ? 'none' : 'block';
  });

  // Red de invitados toggle
  const checkGuest = document.getElementById('checkGuestNetwork');
  checkGuest.addEventListener('change', () => {
    document.getElementById('guestSettingsBox').style.display = checkGuest.checked ? 'block' : 'none';
  });
}

// Cargar redes inalámbricas descubiertas para los modos Ampliar y Conectarse
async function populateDiscoveredSsids(currentSsid = '') {
  const select = document.getElementById('selectDiscoveredSsids');
  const boxOther = document.getElementById('boxOtherSsid');
  const inputOther = document.getElementById('inputOtherSsid');
  if (!select) return;

  try {
    const res = await fetch('/api/scan-wifi');
    if (res.ok) {
      const data = await res.json();
      const networks = data.networks || [];

      select.innerHTML = '<option value="">-- Seleccionar red inalámbrica al alcance --</option>';

      let found = false;
      networks.forEach(net => {
        const opt = document.createElement('option');
        opt.value = net.ssid;
        opt.dataset.security = net.security;
        opt.textContent = `${net.ssid} (${net.signal}% • ${net.security})`;
        if (currentSsid && net.ssid === currentSsid) {
          opt.selected = true;
          found = true;
        }
        select.appendChild(opt);
      });

      const sep = document.createElement('option');
      sep.disabled = true;
      sep.textContent = '──────────────────────────';
      select.appendChild(sep);

      const otherOpt = document.createElement('option');
      otherOpt.value = '__other__';
      otherOpt.textContent = 'Otra red...';
      select.appendChild(otherOpt);

      if (currentSsid && !found) {
        otherOpt.selected = true;
        if (boxOther) boxOther.style.display = 'block';
        if (inputOther) inputOther.value = currentSsid;
      } else {
        if (boxOther) boxOther.style.display = 'none';
      }
    }
  } catch (err) {
    console.error('Error al escanear redes Wi-Fi:', err);
  }
}

// Actualizar la interfaz de la pestaña Inalámbrica según el modo seleccionado
function updateWirelessModeUI(currentSsid = null) {
  const selectMode = document.getElementById('selectWirelessMode');
  const mode = selectMode ? selectMode.value : 'create';

  const wirelessDisabledNotice = document.getElementById('wirelessDisabledNotice');
  const wirelessExtendNotice = document.getElementById('wirelessExtendNotice');
  const wirelessJoinNotice = document.getElementById('wirelessJoinNotice');
  const wirelessActiveSettings = document.getElementById('wirelessActiveSettings');

  const groupSsidInput = document.getElementById('groupSsidInput');
  const groupDiscoveredSsids = document.getElementById('groupDiscoveredSsids');
  const labelSsid = document.getElementById('labelSsid');
  const labelDiscoveredSsids = document.getElementById('labelDiscoveredSsids');
  const labelWifiPassword = document.getElementById('labelWifiPassword');

  const boxAllowEthernetClients = document.getElementById('boxAllowEthernetClients');
  const wirelessOptionsDetails = document.getElementById('wirelessOptionsDetails');
  const guestNetworkOuterBox = document.getElementById('guestNetworkOuterBox');

  // Reset avisos
  if (wirelessDisabledNotice) wirelessDisabledNotice.style.display = 'none';
  if (wirelessExtendNotice) wirelessExtendNotice.style.display = 'none';
  if (wirelessJoinNotice) wirelessJoinNotice.style.display = 'none';

  if (mode === 'off') {
    if (wirelessDisabledNotice) wirelessDisabledNotice.style.display = 'flex';
    if (wirelessActiveSettings) wirelessActiveSettings.style.display = 'none';
    return;
  }

  if (wirelessActiveSettings) wirelessActiveSettings.style.display = 'block';

  if (mode === 'extend') {
    // Modo: Ampliar una red inalámbrica (repetidor WDS/roaming de estación principal)
    if (wirelessExtendNotice) wirelessExtendNotice.style.display = 'flex';
    if (groupSsidInput) groupSsidInput.style.display = 'none';
    if (groupDiscoveredSsids) groupDiscoveredSsids.style.display = 'block';
    if (labelDiscoveredSsids) labelDiscoveredSsids.textContent = 'Nombre de la red que se va a ampliar:';
    if (labelWifiPassword) labelWifiPassword.textContent = 'Contraseña de la red que se va a ampliar:';

    // Opciones no aplicables al extender (heredadas de la base principal)
    if (boxAllowEthernetClients) boxAllowEthernetClients.style.display = 'none';
    if (wirelessOptionsDetails) wirelessOptionsDetails.style.display = 'none';
    if (guestNetworkOuterBox) guestNetworkOuterBox.style.display = 'none';

    populateDiscoveredSsids(currentSsid);
  } else if (mode === 'join') {
    // Modo: Conectarse a una red inalámbrica (cliente Wi-Fi para AirPlay / discos / impresoras)
    if (wirelessJoinNotice) wirelessJoinNotice.style.display = 'flex';
    if (groupSsidInput) groupSsidInput.style.display = 'none';
    if (groupDiscoveredSsids) groupDiscoveredSsids.style.display = 'block';
    if (labelDiscoveredSsids) labelDiscoveredSsids.textContent = 'Nombre de la red a la que conectarse:';
    if (labelWifiPassword) labelWifiPassword.textContent = 'Contraseña de la red Wi-Fi:';

    // Opción exclusiva: Permitir clientes Ethernet
    if (boxAllowEthernetClients) boxAllowEthernetClients.style.display = 'block';

    // Opciones no aplicables (la estación no emite radio Wi-Fi propia)
    if (wirelessOptionsDetails) wirelessOptionsDetails.style.display = 'none';
    if (guestNetworkOuterBox) guestNetworkOuterBox.style.display = 'none';

    populateDiscoveredSsids(currentSsid);
  } else {
    // Modo: Crear una red inalámbrica (estación base autónoma)
    if (groupSsidInput) groupSsidInput.style.display = 'block';
    if (groupDiscoveredSsids) groupDiscoveredSsids.style.display = 'none';
    if (labelSsid) labelSsid.textContent = 'Nombre de la red inalámbrica:';
    if (labelWifiPassword) labelWifiPassword.textContent = 'Contraseña de la red inalámbrica:';

    if (boxAllowEthernetClients) boxAllowEthernetClients.style.display = 'none';
    if (wirelessOptionsDetails) wirelessOptionsDetails.style.display = 'block';
    if (guestNetworkOuterBox) guestNetworkOuterBox.style.display = 'block';
  }
}

// Renderizar clientes inalámbricos sin parpadeos
function renderClientsList(clients = []) {
  if (!popoverClientsBadge || !popoverClientsList) return;
  popoverClientsBadge.textContent = clients.length;

  const currentKey = clients.map(c => `${c.ip}-${c.mac}`).join('|');
  if (popoverClientsList.dataset.lastKey === currentKey) {
    return;
  }
  popoverClientsList.dataset.lastKey = currentKey;
  popoverClientsList.innerHTML = '';

  if (clients.length === 0) {
    popoverClientsList.innerHTML = `<li class="client-item" style="justify-content: center; color: #888;">Sin clientes conectados</li>`;
  } else {
    clients.forEach(c => {
      const li = document.createElement('li');
      li.className = 'client-item';
      li.innerHTML = `
        <span class="client-name">${escapeHtml(c.name)}</span>
        <span class="client-stats">${escapeHtml(c.ip)} • ${escapeHtml(c.signal)}</span>
      `;
      popoverClientsList.appendChild(li);
    });
  }
}

// Sondeo continuo en vivo cada 2.5 segundos
function startLivePolling() {
  setInterval(async () => {
    // Si hay un modal de edición abierto, pausar para no pisar campos de texto
    if (editModalBackdrop.style.display === 'flex' || addDeviceModalBackdrop.style.display === 'flex') {
      return;
    }

    try {
      const res = await fetch('/api/devices');
      if (res.ok) {
        const data = await res.json();
        state.internet = data.internet;
        state.devices = data.devices;

        if (devicesCountBadge) devicesCountBadge.textContent = state.devices.length;
        if (topologyCount) {
          topologyCount.textContent = `${state.devices.length} dispositivo${state.devices.length === 1 ? '' : 's'} AirPort`;
        }

        // Si el popover de la estación base está abierto, actualizar clientes en tiempo real
        if (state.selectedDeviceId && devicePopover.style.display === 'block') {
          const currentDev = getSelectedDevice();
          if (currentDev && currentDev.clients) {
            renderClientsList(currentDev.clients);
          }
        }
      }
    } catch (_) {}
  }, 2500);
}

// Cargar información del sistema host
async function fetchNetworkInfo() {
  try {
    const res = await fetch('/api/network-info');
    if (res.ok) {
      state.hostInfo = await res.json();
      const iface = state.hostInfo.interfaces[0];
      const hostText = iface ? `Host: ${state.hostInfo.hostname} (${iface.address})` : `Host: ${state.hostInfo.hostname}`;
      systemHostInfo.textContent = hostText;
    }
  } catch (err) {
    console.error('Error fetching host info:', err);
  }
}

// Cargar topología desde la API
async function loadTopologyData() {
  try {
    const res = await fetch('/api/devices');
    const data = await res.json();
    state.internet = data.internet;
    state.devices = data.devices;

    devicesCountBadge.textContent = state.devices.length;
    topologyCount.textContent = `${state.devices.length} dispositivo${state.devices.length === 1 ? '' : 's'} AirPort`;

    updateDropdownMenu();
    renderTopology();

    // Si hay dispositivos y no hay seleccionado, seleccionar automáticamente el primero
    if (!state.selectedDeviceId && state.devices.length > 0) {
      state.selectedDeviceId = state.devices[0].id;
    }

    // Si había un dispositivo seleccionado, refrescar su popover
    if (state.selectedDeviceId) {
      const dev = getSelectedDevice();
      if (dev) {
        setTimeout(() => openDevicePopover(dev), 100);
      } else {
        closePopover();
      }
    }
  } catch (err) {
    console.error('Error al cargar topología:', err);
  }
}

// Actualizar lista en el menú desplegable
function updateDropdownMenu() {
  dropdownMenuStations.innerHTML = '';
  state.devices.forEach(dev => {
    const item = document.createElement('div');
    item.className = 'dropdown-item';
    item.innerHTML = `
      <img src="${dev.image}" alt="">
      <div>
        <div style="font-weight: 600;">${escapeHtml(dev.name)}</div>
        <div style="font-size: 15px; opacity: 0.85;">${escapeHtml(dev.ipAddress)} • ${escapeHtml(dev.modelName)}</div>
      </div>
    `;
    item.addEventListener('click', () => {
      dropdownMenuStations.classList.remove('show');
      state.selectedDeviceId = dev.id;
      renderTopology();
      openDevicePopover(dev);
    });
    dropdownMenuStations.appendChild(item);
  });
}

// Renderizar la topología visual
function renderTopology() {
  nodesLayer.innerHTML = '';
  topologySvg.innerHTML = '';

  const hasDevices = state.devices && state.devices.length > 0;

  // Estado vacío oficial de Apple si no hay estaciones base
  if (!hasDevices) {
    if (emptyStateOverlay) emptyStateOverlay.style.display = 'block';
    if (globalStatusPill) {
      globalStatusPill.innerHTML = `<span class="status-dot amber"></span><span>Sin estaciones</span>`;
    }
    closePopover();
  } else {
    if (emptyStateOverlay) emptyStateOverlay.style.display = 'none';
    if (globalStatusPill) {
      const anyOffline = state.devices.some(d => d.status === 'offline');
      if (anyOffline) {
        globalStatusPill.innerHTML = `<span class="status-dot amber"></span><span>Atención requerida</span>`;
      } else {
        globalStatusPill.innerHTML = `<span class="status-dot green"></span><span>En línea</span>`;
      }
    }
  }

  const canvasWidth = nodesLayer.clientWidth || 900;
  const positions = {};

  // Posición de Internet (arriba centrado)
  positions['internet'] = {
    x: canvasWidth / 2,
    y: 110
  };

  // Posición de la estación base principal
  const primaryDevice = state.devices[0];
  if (primaryDevice) {
    positions[primaryDevice.id] = {
      x: canvasWidth / 2,
      y: 320
    };
  }

  // Posiciones de estaciones secundarias (distribuidas abajo)
  const secondaryDevices = state.devices.slice(1);
  const count = secondaryDevices.length;
  if (count > 0) {
    const spacing = Math.min(260, (canvasWidth - 100) / count);
    const startX = (canvasWidth / 2) - ((count - 1) * spacing) / 2;

    secondaryDevices.forEach((dev, idx) => {
      positions[dev.id] = {
        x: startX + idx * spacing,
        y: 530
      };
    });
  }

  // 1. Dibujar líneas SVG de conexión
  if (primaryDevice) {
    drawLine(positions['internet'], positions[primaryDevice.id]);
  }

  secondaryDevices.forEach(dev => {
    const parentPos = positions[dev.parentId] || positions[primaryDevice ? primaryDevice.id : 'internet'];
    const myPos = positions[dev.id];
    if (parentPos && myPos) {
      drawLine(parentPos, myPos);
    }
  });

  // 2. Renderizar nodo de Internet
  createNodeElement({
    id: 'internet',
    name: state.internet?.name || 'Internet',
    modelName: 'Conexión WAN',
    image: '/images/internet.png',
    led: state.internet?.led || 'green',
    status: state.internet?.status || 'connected',
    isInternet: true,
    pos: positions['internet']
  });

  // 3. Renderizar nodos de estaciones base
  state.devices.forEach(dev => {
    const pos = positions[dev.id];
    if (pos) {
      createNodeElement({
        ...dev,
        isInternet: false,
        pos
      });
    }
  });
}

// Dibujar línea SVG entre dos nodos
function drawLine(p1, p2) {
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', p1.x);
  line.setAttribute('y1', p1.y + 85);
  line.setAttribute('x2', p2.x);
  line.setAttribute('y2', p2.y - 68);
  line.setAttribute('class', 'topo-link-line solid');
  topologySvg.appendChild(line);
}

// Crear elemento visual de un nodo
function createNodeElement(item) {
  const isOffline = item.status === 'offline';
  const node = document.createElement('div');
  node.className = `topo-node ${state.selectedDeviceId === item.id ? 'active' : ''} ${isOffline ? 'offline' : ''}`;
  node.style.left = `${item.pos.x}px`;
  node.style.top = `${item.pos.y}px`;
  node.dataset.id = item.id;

  // LED de estado
  let ledSrc = '/images/led-green.png';
  let isBlinking = false;

  if (isOffline || item.led === 'amber' || item.led === 'amber-blinking' || item.status === 'restarting') {
    ledSrc = '/images/led-amber.png';
    isBlinking = true;
  } else if (item.led === 'off') {
    ledSrc = '/images/led-off.png';
  }

  const hasDisks = item.disks && item.disks.length > 0;
  const diskBadgeHtml = hasDisks ? `<img src="/images/airdisk.png" class="node-usb-badge" title="Unidad USB conectada: ${escapeHtml(item.disks.map(d => d.name).join(', '))}" alt="USB">` : '';
  const warningBadgeHtml = isOffline ? `<img src="/images/warning.png" class="node-warning-badge" title="Dispositivo desconectado o fuera de alcance" alt="Alerta">` : '';

  node.innerHTML = `
    <div class="node-graphic-wrap">
      <img src="${item.image}" alt="${escapeHtml(item.name)}" class="node-device-img ${item.isInternet ? 'internet-globe' : ''}">
      <img src="${ledSrc}" alt="LED" class="node-led ${isBlinking ? 'led-amber blinking' : ''}">
      ${diskBadgeHtml}
      ${warningBadgeHtml}
    </div>
    <div class="node-label-box">
      <div class="node-title">${escapeHtml(item.name)}</div>
      <div class="node-subtitle">${escapeHtml(item.isInternet ? 'Conexión a Internet' : (isOffline ? 'No disponible' : (item.wirelessMode === 'off' ? `${item.modelName} (Wi-Fi off)` : item.modelName)))}</div>
    </div>
  `;

  node.addEventListener('click', (e) => {
    e.stopPropagation();
    state.selectedDeviceId = item.id;
    document.querySelectorAll('.topo-node').forEach(n => n.classList.remove('active'));
    node.classList.add('active');
    openDevicePopover(item);
  });

  nodesLayer.appendChild(node);
}

// Abrir popover para el dispositivo seleccionado
function openDevicePopover(item) {
  state.selectedDeviceId = item.id;
  const isInternet = item.id === 'internet';

  popoverThumb.src = item.image;
  popoverTitle.textContent = item.name;
  popoverSubtitle.textContent = isInternet ? 'Conexión a Internet' : item.modelName;

  // LED y estado
  if (item.status === 'offline') {
    popoverLed.src = '/images/led-amber.png';
    popoverStatusText.innerHTML = `<span class="dot-indicator amber"></span> No disponible en la red`;
  } else if (item.status === 'restarting') {
    popoverLed.src = '/images/led-amber.png';
    popoverStatusText.innerHTML = `<span class="dot-indicator amber"></span> Reiniciando estación base...`;
  } else if (item.led === 'amber') {
    popoverLed.src = '/images/led-amber.png';
    popoverStatusText.innerHTML = `<span class="dot-indicator amber"></span> Requiere atención`;
  } else {
    popoverLed.src = '/images/led-green.png';
    popoverStatusText.innerHTML = `<span class="dot-indicator green"></span> Conexión excelente`;
  }

  if (isInternet) {
    document.getElementById('rowIpAddress').style.display = 'none';
    document.getElementById('rowLanIp').style.display = 'none';
    document.getElementById('rowFirmware').style.display = 'none';
    document.getElementById('rowMac').style.display = 'none';
    popoverClientsSection.style.display = 'none';
    document.getElementById('rowWanIp').style.display = 'flex';
    popoverWanIp.textContent = item.ipAddress || '172.21.5.1';

    btnPopoverRestart.style.display = 'none';
    btnPopoverEdit.textContent = 'Ajustes WAN';
  } else {
    document.getElementById('rowIpAddress').style.display = 'flex';
    document.getElementById('rowLanIp').style.display = 'flex';
    document.getElementById('rowWanIp').style.display = 'flex';
    document.getElementById('rowFirmware').style.display = 'flex';
    document.getElementById('rowMac').style.display = 'flex';
    popoverClientsSection.style.display = 'block';

    popoverIp.textContent = item.ipAddress || '10.0.1.1';
    popoverLanIp.textContent = item.lanIp || item.ipAddress || '10.0.1.1';
    popoverWanIp.textContent = item.wanIp || '172.21.5.1';
    popoverFirmware.textContent = item.firmwareVersion || '7.9.1';
    popoverMac.textContent = item.macAddress || '00:00:00:00:00:00';

    // Mostrar estado de red Wi-Fi
    const rowWifi = document.getElementById('rowWifiStatus');
    const popoverWifiStatus = document.getElementById('popoverWifiStatus');
    const isWirelessOff = item.wirelessMode === 'off';
    const isOffline = item.status === 'offline';

    if (rowWifi && popoverWifiStatus) {
      rowWifi.style.display = 'flex';
      if (isOffline) {
        popoverWifiStatus.innerHTML = '<span style="color: #888;">No disponible (estación apagada)</span>';
      } else if (isWirelessOff && item.physicalRadioActive) {
        popoverWifiStatus.innerHTML = '<span style="color: #d70015; font-weight: 600;">🚫 Desactivada en software</span><br><small style="color: #c97000; font-size: 15px;">⚠️ Radio física activa en el aire (' + (item.physicalBssid || '00:1C:B3:AE:3A:4E') + ')</small>';
      } else if (isWirelessOff) {
        popoverWifiStatus.innerHTML = '<span style="color: #d70015; font-weight: 600;">🚫 Desactivada</span>';
      } else {
        popoverWifiStatus.textContent = `${item.ssid || 'Wi-Fi'} (${item.security || 'WPA2'})`;
      }
    }

    // Mostrar discos USB conectados
    const rowDisks = document.getElementById('rowDisks');
    if (!isOffline && item.disks && item.disks.length > 0) {
      rowDisks.style.display = 'flex';
      document.getElementById('popoverDiskName').textContent = item.disks.map(d => {
        const pct = typeof d.percent === 'number' ? `${String(d.percent).replace('.', ',')}% ocupado` : '';
        const usedTotal = (d.sizeUsed && d.sizeTotal && d.sizeTotal !== 'Almacenamiento USB') ? ` (${d.sizeUsed} / ${d.sizeTotal})` : '';
        return `${d.name}${pct ? ' • ' + pct : ''}${usedTotal}`;
      }).join(', ');
    } else {
      rowDisks.style.display = 'none';
    }

    btnPopoverRestart.style.display = 'inline-flex';
    btnPopoverRestart.disabled = isOffline || item.status === 'restarting';
    btnPopoverRestart.textContent = item.status === 'restarting' ? 'Reiniciando...' : 'Reiniciar';
    btnPopoverEdit.textContent = 'Editar';

    // Renderizar clientes inalámbricos con diffing para evitar parpadeos
    if (isOffline) {
      renderClientsList([]);
      popoverClientsList.innerHTML = `<li class="client-item" style="justify-content: center; color: #d70015; font-weight: 500;">Dispositivo apagado o fuera de línea</li>`;
    } else if (isWirelessOff) {
      renderClientsList([]);
      popoverClientsList.innerHTML = `<li class="client-item" style="justify-content: center; color: #888;">Radio inalámbrica desactivada</li>`;
    } else {
      renderClientsList(item.clients || []);
    }
  }

  // Calcular posición del popover respecto al nodo en el viewport
  devicePopover.style.display = 'block';
  const nodeEl = document.querySelector(`.topo-node[data-id="${item.id}"]`);
  if (nodeEl) {
    const nodeRect = nodeEl.getBoundingClientRect();
    const canvasRect = document.getElementById('topologyCanvas').getBoundingClientRect();

    const popoverWidth = 380;
    const targetLeft = nodeRect.left - canvasRect.left + (nodeRect.width / 2) - (popoverWidth / 2);
    const targetTop = nodeRect.top - canvasRect.top + nodeRect.height + 14;

    // Evitar que se desborde a la izquierda o derecha
    const clampedLeft = Math.max(16, Math.min(targetLeft, canvasRect.width - popoverWidth - 16));
    devicePopover.style.left = `${clampedLeft}px`;
    devicePopover.style.top = `${targetTop}px`;

    // Alinear flecha al centro del nodo
    const arrowOffset = (nodeRect.left - canvasRect.left + nodeRect.width / 2) - clampedLeft;
    popoverArrow.style.left = `${arrowOffset}px`;
  }
}

function closePopover() {
  devicePopover.style.display = 'none';
  state.selectedDeviceId = null;
  document.querySelectorAll('.topo-node').forEach(n => n.classList.remove('active'));
}

// Obtener dispositivo seleccionado
function getSelectedDevice() {
  if (state.selectedDeviceId === 'internet') {
    return state.internet;
  }
  return state.devices.find(d => d.id === state.selectedDeviceId);
}

// Diálogo modal de solicitud de contraseña de administración
function promptDevicePassword(dev, onSuccess) {
  authTitle.textContent = `Introduzca la contraseña para «${dev.name}»`;
  authPromptText.textContent = `Se requiere la contraseña de administración para acceder a la configuración de «${dev.name}».`;
  inputAuthPassword.value = '';
  authErrorMessage.style.display = 'none';
  authModalBackdrop.style.display = 'flex';

  setTimeout(() => inputAuthPassword.focus(), 150);

  const cleanup = () => {
    btnAuthCancel.removeEventListener('click', onCancel);
    btnAuthSubmit.removeEventListener('click', onSubmit);
    inputAuthPassword.removeEventListener('keydown', onKey);
  };

  const onCancel = () => {
    cleanup();
    authModalBackdrop.style.display = 'none';
  };

  const onSubmit = async () => {
    const entered = inputAuthPassword.value;
    try {
      const res = await fetch(`/api/devices/${dev.id}/verify-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: entered })
      });

      if (res.ok) {
        cleanup();
        sessionUnlockedPasswords[dev.id] = entered;
        if (checkAuthRemember.checked) {
          localStorage.setItem('airport_keychain_' + dev.id, entered);
        }
        authModalBackdrop.style.display = 'none';
        onSuccess();
      } else {
        const errData = await res.json().catch(() => ({}));
        authErrorMessage.textContent = `⚠️ ${errData.error || 'La contraseña de administración ingresada es incorrecta.'}`;
        authErrorMessage.style.display = 'block';
        inputAuthPassword.select();
        inputAuthPassword.focus();
      }
    } catch (e) {
      console.error(e);
      authErrorMessage.textContent = '⚠️ Error al verificar la contraseña.';
      authErrorMessage.style.display = 'block';
    }
  };

  const onKey = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  btnAuthCancel.addEventListener('click', onCancel);
  btnAuthSubmit.addEventListener('click', onSubmit);
  inputAuthPassword.addEventListener('keydown', onKey);
}

// Abrir modal de edición Sheet
function openEditModal(dev) {
  state.activeEditingDevice = dev;
  const isInternet = dev.id === 'internet';

  document.getElementById('sheetDeviceImg').src = dev.image || '/images/airport-extreme-ac.png';
  document.getElementById('sheetDeviceName').textContent = dev.name;
  document.getElementById('sheetDeviceModel').textContent = isInternet ? 'Configuración de Internet (WAN)' : dev.modelName;

  // Mostrar u ocultar pestañas según el modelo
  const hasDisks = dev.model === 'extreme_ac' || dev.model === 'timecapsule' || (dev.disks && dev.disks.length > 0);
  const hasAirplay = dev.airplay || dev.model === 'express' || dev.model === 'express_legacy';

  document.getElementById('tabBtnDisks').style.display = hasDisks ? 'flex' : 'none';
  document.getElementById('tabBtnAirplay').style.display = hasAirplay ? 'flex' : 'none';

  // Llenar campos de formulario
  document.getElementById('inputBaseName').value = dev.name || '';
  document.getElementById('inputBasePassword').value = dev.wirelessPassword || '';
  document.getElementById('inputBasePasswordConfirm').value = dev.wirelessPassword || '';
  document.getElementById('inputBackToMyMac').value = dev.backToMyMac || '';

  document.getElementById('selectConnectVia').value = dev.connectionType || 'DHCP';
  document.getElementById('inputWanIp').value = dev.wanIp || dev.ipAddress || '172.21.5.133';

  // Configuración inalámbrica
  const selectMode = document.getElementById('selectWirelessMode');
  selectMode.value = dev.wirelessMode || 'create';
  document.getElementById('inputSsid').value = dev.ssid || '';
  document.getElementById('selectSecurity').value = dev.security || 'WPA2 Personal';
  document.getElementById('inputWifiPassword').value = dev.wirelessPassword || '';
  document.getElementById('inputWifiPasswordConfirm').value = dev.wirelessPassword || '';

  // Canales y 5GHz
  const check5G = document.getElementById('check5GHz');
  const box5G = document.getElementById('box5GHzSsid');
  check5G.checked = !!dev.enable5GHz;
  box5G.style.display = dev.enable5GHz ? 'block' : 'none';
  document.getElementById('input5GHzSsid').value = dev.ssid5GHz || (dev.ssid ? `${dev.ssid} 5GHz` : '');
  document.getElementById('selectChannel24').value = dev.channel24 || dev.channel || 'auto';
  document.getElementById('selectChannel5').value = dev.channel5 || 'auto';
  document.getElementById('checkHiddenNetwork').checked = !!dev.hiddenNetwork;

  // Red de invitados
  const checkGuest = document.getElementById('checkGuestNetwork');
  checkGuest.checked = !!dev.guestNetwork;
  document.getElementById('guestSettingsBox').style.display = dev.guestNetwork ? 'block' : 'none';
  document.getElementById('inputGuestSsid').value = dev.guestSsid || `${dev.ssid || 'Red'} Invitados`;
  document.getElementById('inputGuestPassword').value = dev.guestPassword || '';

  // Configuración de clientes Ethernet (modo Conectarse)
  const checkAllowEthernet = document.getElementById('checkAllowEthernetClients');
  if (checkAllowEthernet) {
    checkAllowEthernet.checked = dev.allowEthernetClients !== false;
  }

  // Actualizar visibilidad y campos según el modo inalámbrico (off / create / extend / join)
  updateWirelessModeUI(dev.ssid);

  document.getElementById('selectRouterMode').value = dev.routerMode || 'nat_dhcp';
  document.getElementById('inputDhcpRange').value = dev.dhcpRange || '10.0.1.2 a 10.0.1.200';

  // Llenar Discos
  const disksContainer = document.getElementById('disksListContainer');
  disksContainer.innerHTML = '';
  const disks = dev.disks || [];

  const smbPathHint = document.getElementById('smbPathHint');
  if (smbPathHint) {
    const firstDisk = disks[0] ? disks[0].name : 'disco';
    smbPathHint.textContent = `smb://${dev.ipAddress}/${firstDisk}`;
  }

  if (disks.length === 0) {
    disksContainer.innerHTML = `
      <div style="padding: 14px; text-align: center; color: #777; background: white; border: 1px dashed #ccc; border-radius: 6px;">
        No hay unidades de almacenamiento USB conectadas a esta estación base.
      </div>
    `;
  } else {
    disks.forEach(d => {
      const pctNum = typeof d.percent === 'number' ? Math.max(0, Math.min(100, d.percent)) : 0;
      const pctLabel = `${String(pctNum).replace('.', ',')}% ocupado`;
      const fillColor = pctNum > 90 ? '#d70015' : (pctNum > 75 ? '#f5a623' : '#007aff');
      const card = document.createElement('div');
      card.className = 'disk-card';
      card.innerHTML = `
        <img src="/images/airdisk.png" alt="AirDisk">
        <div class="disk-info">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div class="disk-name">${escapeHtml(d.name)} <span style="font-weight: 700; color: #005bb5; margin-left: 6px;">(${pctLabel})</span></div>
            <button class="btn-eject-disk" data-disk="${escapeHtml(d.name)}" title="Expulsar unidad de forma segura">⏏ Expulsar</button>
          </div>
          <div class="disk-capacity">${escapeHtml(d.type || 'Unidad USB')} • ${escapeHtml(d.status || 'Compartido')}</div>
          <div class="disk-progress-bar" title="${pctLabel}">
            <div class="disk-progress-fill" style="width: ${pctNum}%; background: ${fillColor}; ${pctNum > 0 ? 'min-width: 6px;' : ''}"></div>
          </div>
        </div>
      `;

      card.querySelector('.btn-eject-disk').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`¿Expulsar la unidad USB "${d.name}" con seguridad?`)) {
          try {
            const res = await fetch(`/api/devices/${dev.id}/eject-disk`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ diskName: d.name })
            });
            if (res.ok) {
              showToast(`Unidad "${d.name}" expulsada`);
              card.remove();
              await loadTopologyData();
            }
          } catch (err) {
            console.error(err);
          }
        }
      });

      disksContainer.appendChild(card);
    });
  }

  // Llenar AirPlay
  document.getElementById('checkAirplayEnabled').checked = dev.airplay !== false;
  document.getElementById('inputSpeakerName').value = dev.airplaySpeakerName || `${dev.name} Parlante`;
  document.getElementById('inputSpeakerPassword').value = dev.airplayPassword || '';

  // Activar primera pestaña
  document.querySelector('.sheet-tabs .tab-btn').click();

  editModalBackdrop.style.display = 'flex';
}

// Guardar cambios del modal
async function saveDeviceEdit() {
  if (!state.activeEditingDevice) return;
  const dev = state.activeEditingDevice;

  const wirelessModeVal = document.getElementById('selectWirelessMode').value;
  const isWirelessOff = wirelessModeVal === 'off';

  let selectedSsid = '';
  if (isWirelessOff) {
    selectedSsid = '';
  } else if (wirelessModeVal === 'create') {
    selectedSsid = document.getElementById('inputSsid').value.trim() || dev.ssid;
  } else {
    // Modo extend o join
    const selDiscovered = document.getElementById('selectDiscoveredSsids');
    if (selDiscovered && selDiscovered.value === '__other__') {
      selectedSsid = document.getElementById('inputOtherSsid').value.trim() || dev.ssid;
    } else if (selDiscovered && selDiscovered.value) {
      selectedSsid = selDiscovered.value;
    } else {
      selectedSsid = dev.ssid || '';
    }
  }

  const checkAllowEthernet = document.getElementById('checkAllowEthernetClients');

  const updated = {
    name: document.getElementById('inputBaseName').value.trim() || dev.name,
    wirelessPassword: document.getElementById('inputBasePassword').value,
    backToMyMac: document.getElementById('inputBackToMyMac').value.trim(),
    connectionType: document.getElementById('selectConnectVia').value,
    wanIp: document.getElementById('inputWanIp').value.trim(),
    wirelessMode: wirelessModeVal,
    ssid: selectedSsid,
    security: document.getElementById('selectSecurity').value,
    allowEthernetClients: checkAllowEthernet ? checkAllowEthernet.checked : true,
    enable5GHz: document.getElementById('check5GHz').checked,
    ssid5GHz: document.getElementById('input5GHzSsid').value.trim(),
    channel24: document.getElementById('selectChannel24').value,
    channel5: document.getElementById('selectChannel5').value,
    hiddenNetwork: document.getElementById('checkHiddenNetwork').checked,
    guestNetwork: (isWirelessOff || wirelessModeVal === 'extend' || wirelessModeVal === 'join') ? false : document.getElementById('checkGuestNetwork').checked,
    guestSsid: document.getElementById('inputGuestSsid').value.trim(),
    guestPassword: document.getElementById('inputGuestPassword').value,
    routerMode: document.getElementById('selectRouterMode').value,
    dhcpRange: document.getElementById('inputDhcpRange').value.trim(),
    airplay: document.getElementById('checkAirplayEnabled').checked,
    airplaySpeakerName: document.getElementById('inputSpeakerName').value.trim(),
    airplayPassword: document.getElementById('inputSpeakerPassword').value
  };

  try {
    const adminPass = sessionUnlockedPasswords[dev.id] || localStorage.getItem('airport_keychain_' + dev.id) || '';
    const res = await fetch(`/api/devices/${dev.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-password': adminPass
      },
      body: JSON.stringify(updated)
    });

    if (res.status === 401 || res.status === 403) {
      delete sessionUnlockedPasswords[dev.id];
      showToast('⚠️ Acceso denegado: Se requiere la contraseña de administración correcta');
      promptDevicePassword(dev, () => saveDeviceEdit());
      return;
    }

    if (res.ok) {
      const basePass = document.getElementById('inputBasePassword').value;
      if (basePass) {
        sessionUnlockedPasswords[dev.id] = basePass;
      }
      editModalBackdrop.style.display = 'none';
      showToast('Ajustes enviados al hardware. Reiniciando servicios del AirPort...');

      await loadTopologyData();

      setTimeout(async () => {
        await loadTopologyData();
        showToast('Estación base actualizada y en línea');
      }, 8500);
    } else {
      const errData = await res.json().catch(() => ({}));
      showToast(`⚠️ ${errData.error || 'Error al aplicar los ajustes en el hardware'}`);
    }
  } catch (err) {
    console.error('Error al guardar ajustes:', err);
    showToast('Error al actualizar los ajustes');
  }
}

// Modal: Añadir estación base
function openAddDeviceModal() {
  const selectParent = document.getElementById('addSelectParent');
  selectParent.innerHTML = '';

  state.devices.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = `${d.name} (${d.ipAddress})`;
    selectParent.appendChild(opt);
  });

  addDeviceModalBackdrop.style.display = 'flex';
}

async function submitAddDevice() {
  const modelSelect = document.getElementById('addSelectModel');
  const selectedOption = modelSelect.options[modelSelect.selectedIndex];

  const payload = {
    model: modelSelect.value,
    modelName: selectedOption.textContent.split('(')[0].trim(),
    image: selectedOption.dataset.img,
    name: document.getElementById('addInputName').value.trim() || 'Nueva Estación AirPort',
    parentId: document.getElementById('addSelectParent').value,
    ipAddress: document.getElementById('addInputIp').value.trim() || '10.0.1.50'
  };

  try {
    const res = await fetch('/api/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      addDeviceModalBackdrop.style.display = 'none';
      showToast(`Estación "${payload.name}" agregada con éxito`);
      await loadTopologyData();
    }
  } catch (err) {
    console.error('Error al agregar estación:', err);
  }
}

// Mostrar Toast (30 segundos si es error, o duración personalizada)
function showToast(msg, durationMs) {
  const isError = /error|⚠️|❌|denegado|bloqueado|rechazó|no se pudo/i.test(msg);
  const timeout = durationMs || (isError ? 30000 : 4500);

  toastMessage.textContent = msg;
  if (isError) {
    macToast.classList.add('toast-error');
  } else {
    macToast.classList.remove('toast-error');
  }
  macToast.style.display = 'flex';

  const closeBtn = document.getElementById('toastCloseBtn');
  if (closeBtn && !closeBtn.dataset.bound) {
    closeBtn.dataset.bound = '1';
    closeBtn.addEventListener('click', () => {
      clearTimeout(showToast.timer);
      macToast.style.display = 'none';
    });
  }

  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    macToast.style.display = 'none';
  }, timeout);
}

// Utilidad para escapar texto HTML
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
