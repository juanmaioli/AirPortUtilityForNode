# 🧠 Especificaciones Técnicas y Procesadores de los Apple AirPort

[PROCESADORES_AIRPORT.md](file:///home/juan/Documentos/Dev/Apps/AirPortUtility/PROCESADORES_AIRPORT.md)

Documento de referencia con el análisis técnico de los procesadores, arquitectura de CPU, registros de coma flotante y soporte de binarios de los dos routers Apple AirPort Extreme de la red.

---

### 1. 📊 Resumen Comparativo de Hardware

| Característica | AramisAirPort5Gen (6.ª Gen ac) | AramisAirPort2Gen (2.ª Gen n) |
| :--- | :--- | :--- |
| **Modelo Físico** | AirPort Extreme A1521 (Torre) | AirPort Extreme A1143 / A1264 (Plano) |
| **SoC (Chipset)** | Broadcom BCM53019 | Marvell 88F5281 Orion |
| **Núcleo de CPU** | ARM Cortex-A9 r4p0 (Doble Núcleo) | ARM926EJ-S (Mononúcleo) |
| **Frecuencia de Reloj** | 1.000 MHz (1.0 GHz) | 500 MHz |
| **Arquitectura ARM** | **ARMv7-A** (32 bits) | **ARMv5TE** (32 bits) |
| **Endianness** | Little-Endian (`arm`) | Big-Endian (`armeb`) |
| **Punto Flotante (FPU)** | **Soft-Float (`softfp`)** — Sin `hf` | **Soft-Float** — Sin FPU de hardware |
| **Plataforma NetBSD** | `evbarm` (EABI v4/v5 - `earm`) | `evbarm` (OABI/EABI - `armeb`) |
| **Kernel / SO** | NetBSD 6.0 (Firmware Apple 7.9.1) | NetBSD 4.0_STABLE (Firmware Apple 7.8.1) |
| **Memoria RAM** | 256 MB DDR3 | 64 MB DDR2 |
| **Memoria Flash SPI** | 32 MB (Partición `/mnt/Flash` de 1 MB) | 16 MB (Partición `/mnt/Flash` de 1.1 MB) |
| **Sensor Térmico / Fan** | Sí (`CLTM` • Temp CPU y RPM cooler) | No (Disipación pasiva de fábrica) |

---

### 2. 🚀 AramisAirPort5Gen (AirPort Extreme 6.ª Gen)

* **Dirección IP:** `172.21.5.114`
* **Conexión SSH:** `ssh AramisAirPort5Gen` o `ssh 172.21.5.114`
* **CPU:** Broadcom BCM53019 Cortex-A9 (ARMv7-A de 32 bits, little-endian).
* **Modo de Flotante:** Aunque el núcleo físico Cortex-A9 cuenta con extensiones NEON/VFPv3, el kernel de Apple fue compilado con **`soft-float` ABI (`earm`)**. Las llamadas de función pasan valores flotantes a través de registros enteros estándar, evitando la incompatibilidad con `armv7hf`.
* **Binarios:** Requiere ejecutables compilados de forma **100% estática** para NetBSD ARM EABI v4/v5 (`Flags: 0x04000002` o `0x05000002`).

---

### 3. 🐢 AramisAirPort2Gen (AirPort Extreme 2.ª Gen)

* **Dirección IP:** `172.21.5.133`
* **Conexión SSH:** `ssh AramisAirPort2Gen` o `ssh 172.21.5.133`
* **CPU:** Marvell 88F5281 (arquitectura clásica ARMv5TE de 32 bits).
* **Modo Endian:** Opera en modo **Big-Endian** (`armeb`). Esto significa que el byte más significativo se almacena primero en memoria, por lo que binarios compilados para ARM estándar de Raspberry Pi o Linux (little-endian) son incompatibles a nivel de instrucción.
* **Generación:** Es anterior a ARMv6 y ARMv7, carece por completo de FPU (`hf`) y funciona estrictamente en coma flotante por emulación de software.

---

### 4. 🧩 Glosario de Conceptos Técnicos

#### A. ¿Qué significa `evbarm`?
Sigla de **"Evaluation Board ARM"**. Es la denominación oficial de NetBSD para todas las placas embebidas y plataformas SoC que utilizan procesadores ARM de 32 bits.

#### B. ¿Por qué no son `hf` (Hard Float)?
* **`hf` (Hard-Float):** La convención de llamadas ABI pasa argumentos de coma flotante directamente por registros hardware `d0-d15` o `s0-s31`.
* **`soft-float` (o `softfp`):** Pasa argumentos de coma flotante por registros generales de propósito entero (`r0-r3`). Apple seleccionó esta opción en ambos firmwares para simplificar el cambio de contexto del planificador y ahorrar consumo térmico.

#### C. ¿Qué significa `armeb`?
Sigla de **ARM Extended Big-Endian**. En procesadores antiguos como el Marvell Orion de la 2.ª Gen, el hardware fue configurado por los ingenieros de Apple para operar invirtiendo el orden de bytes en memoria respecto al ARM común.

---

### 5. 🔍 Comandos de Verificación en la Terminal

Para consultar estas propiedades en vivo desde la terminal de cada AirPort:

```bash
# Ver arquitectura de la máquina (evbarm)
arch

# Ver arquitectura del procesador (arm o armeb)
arch -p

# Ver modelo exacto del procesador y memoria física
sysctl hw.model hw.physmem

# Ver detalles del kernel
uname -a
```
