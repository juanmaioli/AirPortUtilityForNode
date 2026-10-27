#!/usr/bin/env bash
# ==============================================================================
# activar_ssh.sh - Habilita (o deshabilita) acceso root por SSH (puerto 22)
# en ambas estaciones base Apple AirPort mediante la propiedad ACP 'dbug'.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

MODO="${1:-on}"
if [[ "$MODO" == "--off" || "$MODO" == "off" ]]; then
  DBUG_VAL="0x0"
  ACCION_TXT="Desactivando SSH (dbug=0x0)"
else
  DBUG_VAL="0x3000"
  ACCION_TXT="Activando SSH root (dbug=0x3000)"
fi

configurar_ssh_airport() {
  local nombre="$1"
  local ip="$2"
  local pass="$3"

  echo "------------------------------------------------------------"
  echo "📡 ${ACCION_TXT} en ${nombre} (${ip})..."
  python3 - "$ip" "$pass" "$DBUG_VAL" <<'PYEOF'
import sys
import time
from acp_control import _run_single_op
from acp.property import ACPProperty

ip = sys.argv[1]
pw = sys.argv[2]
val = int(sys.argv[3], 16)

def _set_dbug(client):
    client.set_properties({"dbug": ACPProperty("dbug", val)})
    return True

def _get_dbug(client):
    props = client.get_properties(["dbug"])
    return props[0].value if props else None

def _reboot(client):
    client.set_properties({"acRB": ACPProperty("acRB", 0)})
    return True

_run_single_op(ip, pw, _set_dbug)
leido = _run_single_op(ip, pw, _get_dbug)
print(f"   ✔ Propiedad dbug verificada en hardware: {hex(leido) if leido is not None else 'N/A'}")
_run_single_op(ip, pw, _reboot)
print(f"   🔄 Orden de reinicio (acRB) enviada a {ip}. El puerto 22 estará activo en ~35 segundos.")
PYEOF
}

configurar_ssh_airport "AramisAirPort5Gen (802.11ac)" "172.21.5.114" "Lasflores506"
configurar_ssh_airport "AramisAirPort2Gen (802.11n)"  "172.21.5.133" "juanmaioli506"

echo "------------------------------------------------------------"
if [[ "$DBUG_VAL" == "0x3000" ]]; then
  echo "✅ Proceso finalizado. Cuando terminen de reiniciar (~35 s), conectate con:"
  echo ""
  echo "   # AirPort 5ta Gen (172.21.5.114) - Clave: Lasflores506"
  echo "   ssh -o HostKeyAlgorithms=+ssh-rsa -o PubkeyAcceptedAlgorithms=+ssh-rsa root@172.21.5.114"
  echo ""
  echo "   # AirPort 2da Gen (172.21.5.133) - Clave: juanmaioli506"
  echo "   ssh -o HostKeyAlgorithms=+ssh-rsa -o PubkeyAcceptedAlgorithms=+ssh-rsa root@172.21.5.133"
else
  echo "✅ SSH desactivado en ambos equipos."
fi
