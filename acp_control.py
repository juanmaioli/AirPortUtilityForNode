#!/usr/bin/env python3
import sys
import json
import argparse
import os
import time
import hashlib
from collections import OrderedDict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from acp.client import ACPClient
    from acp.property import ACPProperty
    from acp.cflbinary import CFLBinaryPListParser, CFLBinaryPListComposer
    from acp.exception import ACPClientError, ACPSessionError, ACPError
except ImportError as e:
    print(json.dumps({"success": False, "error": f"Falta dependencia ACP: {str(e)}"}))
    sys.exit(1)


def _connect_client(target, password, use_srp=False, timeout=5):
    client = ACPClient(target, password=password)
    client.connect()
    if client.session.sock:
        client.session.sock.settimeout(timeout)
    if use_srp:
        client.authenticate_srp()
    return client


def _is_auth_error(err_msg):
    msg = err_msg.lower()
    return (
        "-0x1a62" in msg
        or "-6754" in msg
        or "0xffffe59e" in msg
        or "password" in msg
        or "auth" in msg
        or "denied" in msg
    )


def _run_single_op(target, password, fn):
    """Ejecuta una operación ACP en una conexión limpia usando autenticación Legacy
    (estándar nativo de AirPort Utility para getprop/setprop) con respaldo SRP."""
    last_err = None
    for attempt in range(2):
        for use_srp in (False, True):
            client = None
            try:
                client = _connect_client(target, password, use_srp=use_srp)
                result = fn(client)
                try:
                    client.close()
                except Exception:
                    pass
                return result
            except Exception as e:
                last_err = e
                if client:
                    try:
                        client.close()
                    except Exception:
                        pass
                if isinstance(e, (ConnectionRefusedError, TimeoutError, OSError)) and not isinstance(e, ACPError):
                    break
        if attempt == 0 and not _is_auth_error(str(last_err)):
            time.sleep(1.5)
        else:
            break
    raise last_err


def do_verify(target, password):
    if not password:
        return {
            "success": False,
            "authorized": False,
            "errorType": "bad_password",
            "error": "Contraseña de administración requerida"
        }
    try:
        def _verify_op(client):
            props = client.get_properties(["syNm"])
            if not props:
                raise ACPClientError("bad password (-0x1a62)")
            return True

        _run_single_op(target, password, _verify_op)
        return {"success": True, "authorized": True}
    except Exception as e:
        err_msg = str(e)
        is_bad_pass = _is_auth_error(err_msg)
        return {
            "success": False,
            "authorized": False,
            "errorType": "bad_password" if is_bad_pass else "network",
            "error": "Contraseña de administración incorrecta" if is_bad_pass else err_msg
        }


def do_restart(target, password):
    try:
        def _restart_op(client):
            client.set_properties({"acRB": ACPProperty("acRB", 0)})
            return True

        _run_single_op(target, password, _restart_op)
        return {
            "success": True,
            "message": f"Orden de reinicio de hardware enviada con éxito a {target} (acRB)",
            "target": target
        }
    except Exception as e:
        err_msg = str(e)
        is_bad_pass = _is_auth_error(err_msg)
        return {
            "success": False,
            "errorType": "bad_password" if is_bad_pass else "network",
            "error": "Contraseña de administración incorrecta" if is_bad_pass else err_msg,
            "requiresPassword": is_bad_pass
        }


def _configure_hardware_bridge(target, mode, password=None):
    """Configura el conmutador de red y el servicio DHCP directamente en NetBSD del AirPort vía SSH."""
    try:
        import subprocess
        if mode == "bridge":
            remote_cmds = (
                "/sbin/brconfig bridge0 add bcmeth1 2>/dev/null; "
                f"/sbin/ifconfig bcmeth1 delete {target} 2>/dev/null; "
                "/sbin/ifconfig bridge0 delete 10.0.1.1 2>/dev/null; "
                f"/sbin/ifconfig bridge0 {target} netmask 255.255.255.0 2>/dev/null; "
                "/sbin/route delete default 2>/dev/null; "
                "/sbin/route add default 172.21.5.1 2>/dev/null; "
                "/sbin/pfctl -d 2>/dev/null; "
                "/usr/bin/pkill -9 -f dhcpd 2>/dev/null; "
                "/usr/bin/pkill -9 -f natpmpd 2>/dev/null; "
                "cat /dev/null > /etc/dhcpd.conf 2>/dev/null; "
                "rm -f /usr/sbin/dhcpd 2>/dev/null; "
                'printf "#!/bin/sh\\nexit 0\\n" > /usr/sbin/dhcpd; '
                "chmod 755 /usr/sbin/dhcpd 2>/dev/null; "
                "rm -f /usr/sbin/natpmpd 2>/dev/null; "
                'printf "#!/bin/sh\\nexit 0\\n" > /usr/sbin/natpmpd; '
                "chmod 755 /usr/sbin/natpmpd 2>/dev/null; "
                "printf '#!/bin/sh\\nsleep 5\\n/sbin/brconfig bridge0 add bcmeth1 2>/dev/null\\n"
                f"/sbin/ifconfig bcmeth1 delete {target} 2>/dev/null\\n"
                "/sbin/ifconfig bridge0 delete 10.0.1.1 2>/dev/null\\n"
                f"/sbin/ifconfig bridge0 {target} netmask 255.255.255.0 2>/dev/null\\n"
                "/sbin/route delete default 2>/dev/null\\n"
                "/sbin/route add default 172.21.5.1 2>/dev/null\\n"
                "/sbin/pfctl -d 2>/dev/null\\n"
                "/usr/bin/pkill -9 -f dhcpd 2>/dev/null\\n"
                "/usr/bin/pkill -9 -f natpmpd 2>/dev/null\\n"
                "cat /dev/null > /etc/dhcpd.conf 2>/dev/null\\n"
                "rm -f /usr/sbin/dhcpd 2>/dev/null\\n"
                'printf \"#!/bin/sh\\\\nexit 0\\\\n\" > /usr/sbin/dhcpd\\n'
                "chmod 755 /usr/sbin/dhcpd 2>/dev/null\\n"
                "rm -f /usr/sbin/natpmpd 2>/dev/null\\n"
                'printf \"#!/bin/sh\\\\nexit 0\\\\n\" > /usr/sbin/natpmpd\\n'
                "chmod 755 /usr/sbin/natpmpd 2>/dev/null\\n' > /mnt/Flash/rc.local; "
                "chmod 755 /mnt/Flash/rc.local 2>/dev/null"
            )
        else:
            remote_cmds = (
                "rm -f /usr/sbin/dhcpd; "
                "ln /sbin/ACPd /usr/sbin/dhcpd 2>/dev/null || true; "
                "rm -f /usr/sbin/natpmpd; "
                "ln /sbin/ACPd /usr/sbin/natpmpd 2>/dev/null || true; "
                "/sbin/pfctl -e 2>/dev/null || true; "
                "/sbin/brconfig bridge0 delete bcmeth1 2>/dev/null || true; "
                "/sbin/ifconfig bridge0 10.0.1.1 netmask 255.255.255.0 2>/dev/null || true; "
                "echo '#!/bin/sh' > /mnt/Flash/rc.local; "
                "chmod 755 /mnt/Flash/rc.local"
            )

        ssh_opts = [
            "-o", "StrictHostKeyChecking=no",
            "-o", "ConnectTimeout=5",
            "-o", "HostKeyAlgorithms=+ssh-rsa",
            "-o", "PubkeyAcceptedAlgorithms=+ssh-rsa"
        ]

        # Intentar primero con clave pública
        res = subprocess.run(["ssh"] + ssh_opts + [f"root@{target}", remote_cmds], capture_output=True, timeout=8)
        if res.returncode != 0 and password:
            # Fallback usando sshpass si la clave pública falló o pidió contraseña
            subprocess.run(["sshpass", "-p", str(password), "ssh"] + ssh_opts + [f"root@{target}", remote_cmds], capture_output=True, timeout=8)
    except Exception:
        pass


def do_apply(target, password, config):
    try:
        updated_keys = []

        # Paso 1: Leer diccionario 'WiFi' actual en su propia conexión limpia
        wifi_dict = None
        try:
            def _read_wifi(client):
                props = client.get_properties(["WiFi"])
                if props and props[0].value:
                    return CFLBinaryPListParser.parse(props[0].value)
                return None

            wifi_dict = _run_single_op(target, password, _read_wifi)
        except Exception as e:
            if _is_auth_error(str(e)):
                raise e

        # Paso 2: Determinar valor de raWM según APUtil.exe (0x461538):
        # 0 = Off (Desactivado)
        # 5 = Create 802.11n (Crear una red inalámbrica)
        # 4 = Extend (Ampliar una red inalámbrica)
        # 2 = Join (Conectarse a una red inalámbrica)
        mode = config.get("wirelessMode", "create")
        if mode == "off":
            rawm_val = 0
        elif mode == "join":
            rawm_val = 2
        elif mode == "extend":
            rawm_val = 4
        else:
            rawm_val = 5

        props_to_set = OrderedDict()

        if "name" in config and config["name"]:
            props_to_set["syNm"] = ACPProperty("syNm", str(config["name"]))

        if isinstance(wifi_dict, (dict, OrderedDict)):
            radios = wifi_dict.get("radios")
            if isinstance(radios, list):
                enable_5g = bool(config.get("enable5GHz", False))
                ssid_5g = str(config.get("ssid5GHz", "")).strip()
                for idx, radio in enumerate(radios):
                    if not isinstance(radio, (dict, OrderedDict)):
                        continue
                    radio["raWM"] = rawm_val
                    # Detección de banda según phymodes:
                    # Banda 5 GHz tiene phymodes 112 (11ac/a/n) o canal actual >= 36
                    # Banda 2.4 GHz tiene phymodes 14/62 (11b/g/n) o canal actual <= 14
                    curr_ch = radio.get("raCh", 0)
                    phymodes = radio.get("phymodes", 0)
                    is_5ghz_radio = (phymodes in (112, 114) or curr_ch >= 36)
                    if len(radios) == 1:
                        # Estación con radio única (ej. 2.4 GHz)
                        is_5ghz_radio = False

                    if mode == "off":
                        radio["raEA"] = False
                    else:
                        if is_5ghz_radio and enable_5g and ssid_5g:
                            radio["raNm"] = ssid_5g
                        elif "ssid" in config and config["ssid"]:
                            radio["raNm"] = str(config["ssid"])

                        if "closedNetwork" in config:
                            radio["raSk"] = bool(config["closedNetwork"])

                        if "wirelessPassword" in config and config["wirelessPassword"]:
                            wp = str(config["wirelessPassword"])
                            if isinstance(radio.get("raCr"), (bytes, bytearray)):
                                radio["raCr"] = wp.encode("utf-8")
                            else:
                                radio["raCr"] = wp

                        # Recalcular clave PMK IEEE 802.11i (PBKDF2-SHA1 de raCr + raNm)
                        raw_cr = radio.get("raCr", b"")
                        cr_bytes = bytes(raw_cr) if isinstance(raw_cr, (bytes, bytearray)) else str(raw_cr).encode("utf-8")
                        nm_bytes = str(radio.get("raNm", "")).encode("utf-8")
                        if cr_bytes and nm_bytes and isinstance(radio.get("raWE"), (bytes, bytearray)):
                            radio["raWE"] = hashlib.pbkdf2_hmac("sha1", cr_bytes, nm_bytes, 4096, 32)

                        if is_5ghz_radio:
                            if "channel5" in config and config["channel5"]:
                                ch5 = config["channel5"]
                                is_auto5 = (str(ch5) == "auto")
                                radio["raCA"] = is_auto5
                                radio["raCh"] = 0 if is_auto5 else int(ch5)
                        else:
                            if "channel24" in config and config["channel24"]:
                                ch24 = config["channel24"]
                                is_auto24 = (str(ch24) == "auto")
                                radio["raCA"] = is_auto24
                                radio["raCh"] = 0 if is_auto24 else int(ch24)
                            elif "channel" in config and config["channel"]:
                                ch = config["channel"]
                                is_auto = (str(ch) == "auto")
                                radio["raCA"] = is_auto
                                radio["raCh"] = 0 if is_auto else int(ch)
            composed_wifi = CFLBinaryPListComposer.compose(wifi_dict)
            props_to_set["WiFi"] = ACPProperty("WiFi", composed_wifi)
        else:
            props_to_set["raWM"] = ACPProperty("raWM", rawm_val)
            if mode != "off" and "ssid" in config and config["ssid"]:
                props_to_set["raNm"] = ACPProperty("raNm", str(config["ssid"]))

        if "basePassword" in config and config["basePassword"] and str(config["basePassword"]) != password:
            props_to_set["syPW"] = ACPProperty("syPW", str(config["basePassword"]))

        if "routerMode" in config and config["routerMode"]:
            rmode = str(config["routerMode"]).strip()
            props_to_set["naFl"] = ACPProperty("naFl", 0 if rmode == "bridge" else 1)

        active_password = password
        # Paso 3: Escribir cada propiedad en su propia conexión limpia
        for k, prop_obj in props_to_set.items():
            def _write_prop(client, key=k, pobj=prop_obj):
                client.set_properties({key: pobj})
                return True

            _run_single_op(target, active_password, _write_prop)
            updated_keys.append(k)
            if k == "syPW":
                active_password = str(config["basePassword"])

        # Paso 4: Recargar servicios en el router usando acRI: 0 en su propia conexión individual
        # (Probado en hardware real: apaga/actualiza la radio en 2 segundos manteniendo abierto el puerto 5009)
        try:
            def _reload_services(client):
                client.set_properties({"acRI": ACPProperty("acRI", 0)})
                return True

            _run_single_op(target, active_password, _reload_services)
            updated_keys.append("acRI")
        except Exception:
            pass

        if "routerMode" in config and config["routerMode"]:
            _configure_hardware_bridge(target, config["routerMode"], password=password)

        return {
            "success": True,
            "appliedToHardware": True,
            "message": f"Ajustes aplicados al hardware físico ({target}) exitosamente.",
            "updatedProperties": updated_keys
        }
    except Exception as e:
        err_msg = str(e)
        is_bad_pass = _is_auth_error(err_msg)
        return {
            "success": False,
            "appliedToHardware": False,
            "errorType": "bad_password" if is_bad_pass else "network",
            "error": "Contraseña de administración incorrecta" if is_bad_pass else err_msg,
            "requiresPassword": is_bad_pass
        }


def _format_mib(mib_val):
    gib = float(mib_val) / 1024.0
    if gib >= 1.0:
        return f"{gib:,.2f} GB".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{int(mib_val)} MB"


def _to_signed_64(val):
    if val is None:
        return 0
    try:
        n = int(val)
        if n >= (1 << 63):
            return n - (1 << 64)
        return n
    except Exception:
        return 0


def do_disks(target, password):
    try:
        def _read_telemetry(client):
            props = client.get_properties(["MaSt", "WiFi", "syNm", "raSL", "dhSL", "naFl"])
            res = {}
            for p in (props or []):
                res[p.name] = p.value
            return res

        raw = _run_single_op(target, password, _read_telemetry)
        mast_list = CFLBinaryPListParser.parse(raw["MaSt"]) if raw.get("MaSt") else []
        wifi_dict = CFLBinaryPListParser.parse(raw["WiFi"]) if raw.get("WiFi") else None
        sy_nm = str(raw["syNm"]) if raw.get("syNm") else None

        disks_out = []
        if isinstance(mast_list, list):
            for hw in mast_list:
                if not isinstance(hw, (dict, OrderedDict)):
                    continue
                if hw.get("softDisconnected"):
                    continue
                vendor = str(hw.get("vendor", "")).strip()
                product = str(hw.get("product", "")).strip()
                hw_label = f"{vendor} {product}".strip() or "Unidad USB externa"
                partitions = hw.get("partitions", [])
                if isinstance(partitions, list):
                    for part in partitions:
                        if not isinstance(part, (dict, OrderedDict)):
                            continue
                        total_mib = int(part.get("size", 0) or 0)
                        used_mib = int(part.get("sizeUsed", 0) or 0)
                        free_mib = int(part.get("sizeFree", max(0, total_mib - used_mib)) or 0)
                        pct = round((used_mib / total_mib) * 100.0, 1) if total_mib > 0 else 0.0
                        fmt = str(part.get("format", "HFS+")).upper()
                        raw_uuid = part.get("uuid", b"")
                        if isinstance(raw_uuid, (bytes, bytearray)) and len(raw_uuid) == 16:
                            h = raw_uuid.hex()
                            uuid_str = f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"
                        else:
                            uuid_str = str(raw_uuid)

                        total_str = _format_mib(total_mib)
                        used_str = _format_mib(used_mib)
                        free_str = _format_mib(free_mib)
                        pct_str = str(pct).replace(".", ",")

                        disks_out.append({
                            "name": str(part.get("name", "untitled")),
                            "uuid": uuid_str,
                            "type": f"{hw_label} ({fmt})",
                            "status": f"{used_str} ocupados de {total_str} ({free_str} libres) • {pct_str}% ocupado",
                            "sizeTotal": total_str,
                            "sizeUsed": used_str,
                            "sizeFree": free_str,
                            "sizeTotalMiB": total_mib,
                            "sizeUsedMiB": used_mib,
                            "sizeFreeMiB": free_mib,
                            "percent": pct
                        })

        wifi_out = None
        if isinstance(wifi_dict, (dict, OrderedDict)):
            radios = wifi_dict.get("radios", [])
            if isinstance(radios, list) and len(radios) > 0:
                r24 = None
                r5 = None
                for r in radios:
                    if not isinstance(r, (dict, OrderedDict)):
                        continue
                    curr_ch = r.get("raCh", 0)
                    phymodes = r.get("phymodes", 0)
                    is_5g = (phymodes in (112, 114) or curr_ch >= 36) and len(radios) > 1
                    if is_5g:
                        r5 = r
                    else:
                        r24 = r
                if r24 is None:
                    r24 = radios[0]

                rawm = r24.get("raWM", 5)
                if rawm == 0:
                    wmode = "off"
                elif rawm == 2:
                    wmode = "join"
                elif rawm == 4:
                    wmode = "extend"
                else:
                    wmode = "create"

                ssid24 = str(r24.get("raNm", ""))
                ssid5 = str(r5.get("raNm", "")) if r5 else ""
                enable5g = bool(r5 and ssid5 and ssid5 != ssid24)
                ch24_num = int(r24.get("raCh", 0) or 0)
                ch5_num = int(r5.get("raCh", 0) or 0) if r5 else 0
                raw_cr = r24.get("raCr", "")
                if isinstance(raw_cr, (bytes, bytearray)):
                    wpass = raw_cr.decode("utf-8", errors="ignore")
                else:
                    wpass = str(raw_cr)

                wifi_out = {
                    "name": sy_nm,
                    "wirelessMode": wmode,
                    "ssid": ssid24,
                    "ssid5GHz": ssid5 if ssid5 else (f"{ssid24} 5GHz" if ssid24 else ""),
                    "enable5GHz": enable5g,
                    "channel24": "auto" if ch24_num == 0 else str(ch24_num),
                    "channel5": "auto" if ch5_num == 0 else str(ch5_num),
                    "hiddenNetwork": bool(r24.get("raSk", False)),
                    "wirelessPassword": wpass
                }

        # Extraer clientes inalámbricos (raSL) y clientes DHCP (dhSL)
        clients_out = []
        seen_macs = set()

        if raw.get("raSL"):
            try:
                rasl_dict = CFLBinaryPListParser.parse(raw["raSL"])
                if isinstance(rasl_dict, (dict, OrderedDict)):
                    for iface, stations in rasl_dict.items():
                        if not isinstance(stations, list):
                            continue
                        for st in stations:
                            if not isinstance(st, (dict, OrderedDict)):
                                continue
                            mac = str(st.get("macAddress", "")).strip().lower()
                            if not mac:
                                continue
                            seen_macs.add(mac)
                            rssi = _to_signed_64(st.get("rssi", 0))
                            rate = int(st.get("txrate", 0) or 0)
                            phy = str(st.get("phy_mode", ""))

                            if rssi >= -55:
                                sig_text = f"Excelente ({rssi} dBm)"
                            elif rssi >= -67:
                                sig_text = f"Muy buena ({rssi} dBm)"
                            elif rssi >= -75:
                                sig_text = f"Buena ({rssi} dBm)"
                            elif rssi >= -85:
                                sig_text = f"Regular ({rssi} dBm)"
                            elif rssi < 0:
                                sig_text = f"Débil ({rssi} dBm)"
                            else:
                                sig_text = "Excelente"

                            band_str = "5 GHz" if ("wlan0" in str(iface).lower() or "ac" in phy.lower() or rate > 300) else "2.4 GHz"

                            clients_out.append({
                                "mac": mac,
                                "rssi": rssi,
                                "signal": sig_text,
                                "rate": f"{rate} Mbps" if rate > 0 else "",
                                "phy": phy,
                                "band": band_str,
                                "interface": str(iface),
                                "type": "wireless"
                            })
            except Exception:
                pass

        if raw.get("dhSL"):
            try:
                dhsl_data = CFLBinaryPListParser.parse(raw["dhSL"])
                leases = []
                if isinstance(dhsl_data, dict):
                    leases = dhsl_data.get("leases", []) if "leases" in dhsl_data else list(dhsl_data.values())
                elif isinstance(dhsl_data, list):
                    leases = dhsl_data

                for l in leases:
                    if not isinstance(l, (dict, OrderedDict)):
                        continue
                    lmac = str(l.get("macAddress") or l.get("hwAddress") or l.get("mac") or "").strip().lower()
                    lip = str(l.get("ipAddress") or l.get("ip") or "").strip()
                    lname = str(l.get("clientName") or l.get("name") or l.get("hostname") or "").strip()
                    if not lmac:
                        continue
                    if lmac in seen_macs:
                        for c in clients_out:
                            if c["mac"] == lmac:
                                if lip:
                                    c["ip"] = lip
                                if lname:
                                    c["name"] = lname
                    else:
                        seen_macs.add(lmac)
                        clients_out.append({
                            "mac": lmac,
                            "ip": lip,
                            "name": lname or "Cliente Ethernet",
                            "rssi": 0,
                            "signal": "Cableado (Ethernet)",
                            "rate": "1 Gbps",
                            "phy": "Ethernet",
                            "band": "LAN",
                            "interface": "eth0",
                            "type": "wired"
                        })
            except Exception:
                pass

        router_mode = "bridge"
        if "naFl" in raw and raw["naFl"] is not None:
            router_mode = "nat_dhcp" if int(raw["naFl"]) == 1 else "bridge"

        return {"success": True, "disks": disks_out, "wifi": wifi_out, "name": sy_nm, "clients": clients_out, "routerMode": router_mode}
    except Exception as e:
        return {"success": False, "error": str(e), "disks": [], "wifi": None, "clients": [], "routerMode": "bridge"}


def main():
    parser = argparse.ArgumentParser(description="Control de hardware Apple AirPort vía ACP")
    parser.add_argument("-a", "--action", required=True, choices=["verify", "restart", "apply", "disks"], help="Acción a realizar")
    parser.add_argument("-t", "--target", required=True, help="IP del dispositivo AirPort")
    parser.add_argument("-p", "--password", default="", help="Contraseña de administración")
    parser.add_argument("--config", default="{}", help="JSON con ajustes a aplicar")
    args = parser.parse_args()

    if args.action == "verify":
        res = do_verify(args.target, args.password)
    elif args.action == "restart":
        res = do_restart(args.target, args.password)
    elif args.action == "disks":
        res = do_disks(args.target, args.password)
    elif args.action == "apply":
        try:
            cfg = json.loads(args.config)
        except Exception:
            cfg = {}
        res = do_apply(args.target, args.password, cfg)
    else:
        res = {"success": False, "error": "Acción desconocida"}

    print(json.dumps(res))
    if not res.get("success", False):
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
