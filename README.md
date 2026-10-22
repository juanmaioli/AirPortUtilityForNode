# 📡 Utilidad AirPort (Web Edition)

[Documentación oficial de Apple AirPort](https://support.apple.com/es-es/HT208084)

Recreación web fiel de la clásica aplicación **Utilidad AirPort** (AirPort Utility 6.3 de Apple OS X) desarrollada en **Node.js** para ejecutarse en el navegador en `http://localhost:3000`. Incluye escaneo mDNS/Bonjour en vivo de estaciones base físicas y lectura de unidades USB compartidas (AirDisk).

---

## 1. 🚀 Inicio rápido

Instalá las dependencias y ejecutá el servidor:

```bash
npm install
npm start
```

Abrí tu navegador web e ingresá a:
```text
http://localhost:3000
```

---

## 2. 🌟 Características principales

| Módulo | Descripción |
| :--- | :--- |
| **Topología interactiva** | Visualización en árbol (Internet 🌐, AirPort Extreme y clientes) con curvas dinámicas SVG. |
| **Escaneo en vivo (mDNS)** | Descubrimiento real mediante Bonjour (`224.0.0.251:5353`) de estaciones Apple en la red física. |
| **Soporte AirDisk USB** | Lectura automática de discos y pendrives compartidos por USB (`_adisk._tcp.local`). |
| **Gráficos originales de Apple** | Recursos visuales extraídos del archivo DMG oficial (modelos 3D y LEDs de estado). |
| **Popover contextual nativo** | Detalle en tiempo real de dirección IP, MAC, versión de firmware, canales y clientes. |
| **Panel de configuración (Sheet)** | Pestañas de Estación Base, Internet, Inalámbrica (Wi-Fi), Red, Discos y AirPlay. |
| **Accesibilidad visual** | Tipografía adaptada con un tamaño mínimo base de **15px** para facilitar la lectura. |
| **Simulación de ciclo de reinicio** | Animación con transición a LED ámbar intermitente y reconexión a verde. |

---

## 3. 📂 Estructura del proyecto

```text
AirPortUtility/
├── data/
│   └── devices.json          # Almacén de configuración persistente
├── public/
│   ├── css/
│   │   └── style.css         # Estilos visuales exactos estilo OS X Aqua/Dark (≥15px)
│   ├── images/               # Assets extraídos y convertidos del .dmg oficial
│   ├── js/
│   │   └── app.js            # Lógica reactiva de la interfaz web y popovers
│   └── index.html            # Interfaz principal
├── package.json              # Configuración y dependencias (v1.1.0)
├── server.js                 # Servidor HTTP Express y escáner mDNS/Bonjour
└── README.md                 # Documentación del proyecto
```

---

## 4. ⚙️ Comandos disponibles

```bash
# Iniciar el servidor en producción
npm start

# Iniciar directamente con Node
node server.js
```
