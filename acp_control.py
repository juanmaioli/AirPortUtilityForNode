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


def do_disks(target, password):
    try:
        def _read_telemetry(client):
            props = client.get_properties(["MaSt", "WiFi", "syNm"])
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

        return {"success": True, "disks": disks_out, "wifi": wifi_out, "name": sy_nm}
    except Exception as e:
        return {"success": False, "error": str(e), "disks": [], "wifi": None}


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
