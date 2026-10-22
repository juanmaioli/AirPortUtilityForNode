#!/usr/bin/env python3
import sys
import json
import argparse
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from acp_control import do_restart

def main():
    parser = argparse.ArgumentParser(description="Reiniciar estación base Apple AirPort mediante protocolo ACP")
    parser.add_argument("-t", "--target", required=True, help="Dirección IP de la estación base AirPort")
    parser.add_argument("-p", "--password", default="", help="Contraseña de administración de la estación base")
    parser.add_argument("--auth-mode", default="legacy", choices=["srp", "legacy"], help="Modo de autenticación")
    args = parser.parse_args()

    res = do_restart(args.target, args.password)
    print(json.dumps(res))
    if not res.get("success", False):
        sys.exit(2 if res.get("errorType") == "network" else 1)
    sys.exit(0)

if __name__ == "__main__":
    main()
