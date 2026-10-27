# 📡 Utilidad AirPort (Web Edition)

[Documentación oficial de Apple AirPort](https://support.apple.com/es-es/HT208084)

Recreación web fiel de la clásica aplicación **Utilidad AirPort** (AirPort Utility de Apple OS X) desarrollada en **Node.js** y **Python** para ejecutarse en el navegador en `http://localhost:3000`. Incluye escaneo mDNS/Bonjour en vivo de estaciones base físicas, control y gestión de hardware real mediante el protocolo nativo **ACP** (puerto `5009`), telemetría exacta de almacenamiento USB (**AirDisk**), apagado físico de radio Wi-Fi y visualización diagnóstica oficial de Apple.

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
| **Control de hardware físico (ACP)** | Comunicación nativa por socket TCP en el puerto `5009` para leer y aplicar configuraciones directamente en el router Apple AirPort, con mapeo dinámico de canales 2.4 GHz y 5 GHz según `phymodes`. |
| **Apagado real de radio Wi-Fi** | Desactivación física de la emisión de radio modificando el diccionario binario `WiFi.radios[0]` (`raWM = 0`) y recarga inmediata con `acRI`. |
| **Telemetría exacta de AirDisk (MaSt)** | Lectura en vivo de particiones HFS+, gigabytes usados, gigabytes libres y barra de porcentaje real de ocupación de discos USB conectados. |
| **Telemetría WAN de Internet** | Pop-up informativo con IP pública real, puerta de enlace, DNS primario/secundario, ubicación geográfica (ciudad/país) y nombre de ISP. |
| **Lápiz de edición directa** | Acceso rápido a configuración mediante botón vectorial en cada estación base y ventana de edición ampliada (780px). |
| **Barra unificada OS X y ventana panorámica** | Fusión de barra de título y herramientas en un solo bloque con ancho ampliado a 1320px y botón de reinicio en cabecera de pop-up. |
| **Pestaña de clientes conectados** | Nueva sección en la ventana de configuración con tabla detallada de dispositivos (Host, IP, MAC y calidad de señal). |
| **Reconocimiento inteligente de modelos e imágenes** | Catálogo canónico de Apple (`syAP` 3 a 120 y `_device-info`) con asignación dinámica de imágenes (Torre AC, Plana N, Time Capsule, Express y UFO) y selector manual. |
| **Topología interactiva** | Visualización fiel con líneas blancas estilo Apple conectando Internet con estaciones base principales y secundarias en paralelo. |
| **Escaneo en vivo (mDNS/Bonjour)** | Descubrimiento multicast en tiempo real (`224.0.0.251:5353`) y actualización periódica automática de nombres, SSIDs y estados de red. |
| **Gestión y desvinculación** | Capacidad de olvidar estaciones base offline directamente desde la interfaz y asignación dinámica de jerarquías de red. |
| **Seguridad y autenticación** | Validación de clave de administración con soporte para autenticación Legacy y SRP. |
| **Avisos y accesibilidad (30s)** | Notificaciones de error de alto contraste visibles durante 30 segundos con botón de cierre manual y tipografía optimizada (≥15px). |
| **Gráficos originales de Apple** | Iconos y modelos 3D auténticos de estaciones AirPort Extreme, Time Capsule y Express extraídos de las imágenes oficiales. |

---

## 3. 📂 Estructura del proyecto

```text
AirPortUtility/
├── acp/                      # Biblioteca del protocolo de control ACP de Apple
├── acp_control.py            # Controlador CLI para verificar, aplicar cambios y leer discos
├── data/
│   └── devices.json          # Almacén de configuración y estado persistente
├── public/
│   ├── css/
│   │   └── style.css         # Estilos visuales exactos estilo OS X Aqua/Dark (≥15px)
│   ├── images/               # Assets extraídos y convertidos del .dmg oficial
│   ├── js/
│   │   └── app.js            # Lógica reactiva de interfaz, popovers, discos y modales
│   └── index.html            # Interfaz gráfica principal
├── reboot.py                 # Script de reinicio físico de hardware vía ACP (acRB)
├── package.json              # Configuración y dependencias (v1.4.1)
├── server.js                 # Servidor Express, escáner mDNS y puente con hardware ACP
└── README.md                 # Documentación del proyecto
```

---

## 4. ⚙️ Comandos disponibles

```bash
# Iniciar el servidor web
npm start

# Iniciar directamente con Node.js
node server.js

# Consultar telemetría de disco USB físico vía ACP
python3 acp_control.py -a disks -t 172.21.5.133 -p juanmaioli506

# Reiniciar la estación base físicamente
python3 reboot.py -t 172.21.5.133 -p juanmaioli506
```
