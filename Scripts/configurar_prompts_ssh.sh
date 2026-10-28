#!/usr/bin/env bash
# ==============================================================================
# configurar_prompts_ssh.sh - Instala un prompt colorido, panel de bienvenida
# con métricas de RAM/sensores/discos y persistencia en /mnt/Flash en ambos AirPort
# ==============================================================================

set -euo pipefail

PUBKEY=""
if [[ -f "$HOME/.ssh/id_rsa.pub" ]]; then
  PUBKEY="$(cat "$HOME/.ssh/id_rsa.pub")"
fi

python3 - "$PUBKEY" <<'PYEOF'
import sys, pty, os, time, select, base64

pubkey = sys.argv[1].strip()

PROFILE_114 = r'''# Apple AirPort Extreme 802.11ac (AramisAirPort5Gen) - Custom Profile
PATH=/sbin:/usr/sbin:/bin:/usr/bin
export PATH
HOSTNAME=`hostname`
export HOSTNAME

case "$TERM" in
	xterm*|rxvt*|screen*|tmux*|linux*) TERM=xterm ;;
	""|dumb|unknown) TERM=vt100 ;;
esac
export TERM

umask 022

ESC=`printf '\033'`
C_RESET="${ESC}[0m"
C_BOLD="${ESC}[1m"
C_DIM="${ESC}[2m"
C_CYAN="${ESC}[1;36m"
C_GREEN="${ESC}[1;32m"
C_YELLOW="${ESC}[1;33m"
C_BLUE="${ESC}[1;34m"
C_WHITE="${ESC}[1;37m"

alias l="ls -la"
alias ll="ls -la"
alias cls="printf '\033[2J\033[H'"
alias mem="/sbin/sysctl hw.model hw.physmem hw.usermem && /usr/bin/top -d 1 | sed -n '1,6p'"
alias sensores="/usr/sbin/envstat"
alias discos="df -h"
alias clientes="/usr/sbin/arp -a"
alias wifi="/sbin/ifconfig -a"
alias acplast="tail -n 40 /var/log/ACPd.log"
alias acplog="cat /var/log/ACPd.log"
alias acplogall="logall /var/log/ACPd.log"
alias 'acptail=tail -n 40 -F /var/log/ACPd.log'
alias wlan0log="cat /var/log/hostap_wlan0.log"
alias wlan1log="cat /var/log/hostap_wlan1.log"
alias showrpcs="acp rs acprpc"

logall() {
	for i in 3 2 1; do
		if [ -f "$1.$i" ]; then
			cat "$1.$i"
		fi
	done
	if [ -f "$1" ]; then
		cat "$1"
	fi
}

ayuda() {
	printf "\n${C_CYAN}=== Comandos Rápidos en AramisAirPort5Gen ===${C_RESET}\n"
	printf "  ${C_YELLOW}mem${C_RESET}       : Ver uso de memoria RAM y carga de CPU\n"
	printf "  ${C_YELLOW}sensores${C_RESET}  : Ver temperatura interna (°C) y RPM del cooler\n"
	printf "  ${C_YELLOW}discos${C_RESET}    : Ver espacio en ramdisk (/), Flash y USB\n"
	printf "  ${C_YELLOW}wifi${C_RESET}      : Ver interfaces de red e IP\n"
	printf "  ${C_YELLOW}clientes${C_RESET}  : Ver tabla ARP de equipos en red\n"
	printf "  ${C_YELLOW}acplast${C_RESET}   : Ver últimas 40 líneas del log ACPd\n"
	printf "  ${C_YELLOW}top${C_RESET}       : Monitor interactivo de procesos\n\n"
}

_update_ps1() {
	_PWD=`pwd`
	PS1="[Aramis5Gen ${_PWD}]# "
	export PS1
}

cd() {
	command cd "$@" && _update_ps1 && printf "${C_BLUE}┌─[${C_CYAN}🍎 root@AramisAirPort5Gen ${C_GREEN}${_PWD}${C_BLUE}]${C_RESET}\n"
}

case "$-" in *i*)
	set -o emacs
	set -o tabcomplete 2>/dev/null || true
	_MEM_LINE=`/usr/bin/top -d 1 2>/dev/null | sed -n '4p'`
	_UP_LINE=`/usr/bin/top -d 1 2>/dev/null | sed -n '1p'`
	_FAN=`/usr/sbin/envstat 2>/dev/null | sed -n 's/.*Fan_rpm:[ ]*\([0-9]*\).*/\1 RPM/p'`
	_TEMP=`/usr/sbin/envstat 2>/dev/null | sed -n 's/.*T_internal:[ ]*\([0-9.]*\).*/\1 °C/p'`
	printf "\n${C_CYAN}╔══════════════════════════════════════════════════════════════════════╗${C_RESET}\n"
	printf "${C_CYAN}║${C_RESET}  🍎 ${C_WHITE}Apple AirPort Extreme 802.11ac (6.ª Gen)${C_RESET} • ${C_YELLOW}AramisAirPort5Gen${C_RESET}     ${C_CYAN}║${C_RESET}\n"
	printf "${C_CYAN}╠══════════════════════════════════════════════════════════════════════╣${C_RESET}\n"
	printf "${C_CYAN}║${C_RESET}  ${C_GREEN}Sistema:${C_RESET}   NetBSD 6.0 (Broadcom Cortex-A9 • Firmware 7.9.1)         ${C_CYAN}║${C_RESET}\n"
	printf "${C_CYAN}║${C_RESET}  ${C_GREEN}Red LAN:${C_RESET}   172.21.5.114 • Modo Repetidor (AramisW6-2)               ${C_CYAN}║${C_RESET}\n"
	printf "${C_CYAN}║${C_RESET}  ${C_GREEN}RAM (256M):${C_RESET} ${_MEM_LINE#Memory: }\n"
	printf "${C_CYAN}║${C_RESET}  ${C_GREEN}Sensores:${C_RESET}  Temp CPU: ${C_YELLOW}${_TEMP:-40 °C}${C_RESET} • Cooler: ${C_YELLOW}${_FAN:-1800 RPM}${C_RESET}\n"
	printf "${C_CYAN}║${C_RESET}  ${C_GREEN}Atajos:${C_RESET}    Escribí ${C_YELLOW}mem${C_RESET}, ${C_YELLOW}sensores${C_RESET}, ${C_YELLOW}discos${C_RESET}, ${C_YELLOW}clientes${C_RESET} o ${C_YELLOW}ayuda${C_RESET}\n"
	printf "${C_CYAN}╚══════════════════════════════════════════════════════════════════════╝${C_RESET}\n"
	_update_ps1
	;;
esac
'''

PROFILE_133 = r'''# Apple AirPort Extreme 802.11n (AramisAirPort2Gen) - Custom Profile
PATH=/sbin:/usr/sbin:/bin:/usr/bin
export PATH
HOSTNAME=`hostname`
export HOSTNAME

case "$TERM" in
	xterm*|rxvt*|screen*|tmux*|linux*) TERM=xterm ;;
	""|dumb|unknown) TERM=vt100 ;;
esac
export TERM

umask 022

ESC=`printf '\033'`
C_RESET="${ESC}[0m"
C_BOLD="${ESC}[1m"
C_DIM="${ESC}[2m"
C_CYAN="${ESC}[1;36m"
C_GREEN="${ESC}[1;32m"
C_YELLOW="${ESC}[1;33m"
C_BLUE="${ESC}[1;34m"
C_WHITE="${ESC}[1;37m"

alias l="ls -la"
alias ll="ls -la"
alias cls="printf '\033[2J\033[H'"
alias mem="/sbin/sysctl hw.model hw.physmem hw.usermem && /usr/bin/top -d 1 | sed -n '1,6p'"
alias discos="df -h && ls -la /Volumes"
alias clientes="/usr/sbin/arp -a"
alias wifi="/sbin/ifconfig -a"
alias acplast="tail -n 40 /var/log/ACPd.log"
alias acplog="cat /var/log/ACPd.log"
alias acplogall="logall /var/log/ACPd.log"
alias 'acptail=tail -n 40 -F /var/log/ACPd.log'
alias wlan0log="cat /var/log/hostap_wlan0.log"
alias showrpcs="acp rs acprpc"

logall() {
	for i in 3 2 1; do
		if [ -f "$1.$i" ]; then
			cat "$1.$i"
		fi
	done
	if [ -f "$1" ]; then
		cat "$1"
	fi
}

ayuda() {
	printf "\n${C_GREEN}=== Comandos Rápidos en AramisAirPort2Gen ===${C_RESET}\n"
	printf "  ${C_YELLOW}mem${C_RESET}       : Ver uso de memoria RAM (64 MB) y carga de CPU\n"
	printf "  ${C_YELLOW}discos${C_RESET}    : Ver espacio en ramdisk (/), Flash y disco USB (/Volumes)\n"
	printf "  ${C_YELLOW}wifi${C_RESET}      : Ver interfaces de red e IP\n"
	printf "  ${C_YELLOW}clientes${C_RESET}  : Ver tabla ARP de equipos en red\n"
	printf "  ${C_YELLOW}acplast${C_RESET}   : Ver últimas 40 líneas del log ACPd\n"
	printf "  ${C_YELLOW}top${C_RESET}       : Monitor interactivo de procesos\n\n"
}

_update_ps1() {
	_PWD=`pwd`
	PS1="[Aramis2Gen ${_PWD}]# "
	export PS1
}

cd() {
	command cd "$@" && _update_ps1 && printf "${C_GREEN}┌─[${C_YELLOW}🍏 root@AramisAirPort2Gen ${C_WHITE}${_PWD}${C_GREEN}]${C_RESET}\n"
}

case "$-" in *i*)
	set -o emacs
	set -o tabcomplete 2>/dev/null || true
	_MEM_LINE=`/usr/bin/top -d 1 2>/dev/null | sed -n '4p'`
	printf "\n${C_GREEN}╔══════════════════════════════════════════════════════════════════════╗${C_RESET}\n"
	printf "${C_GREEN}║${C_RESET}  🍏 ${C_WHITE}Apple AirPort Extreme 802.11n (2.ª Gen)${C_RESET} • ${C_YELLOW}AramisAirPort2Gen${C_RESET}      ${C_GREEN}║${C_RESET}\n"
	printf "${C_GREEN}╠══════════════════════════════════════════════════════════════════════╣${C_RESET}\n"
	printf "${C_GREEN}║${C_RESET}  ${C_CYAN}Sistema:${C_RESET}   NetBSD 4.0_STABLE (Marvell 88F5281 • Firmware 7.8.1)     ${C_GREEN}║${C_RESET}\n"
	printf "${C_GREEN}║${C_RESET}  ${C_CYAN}Red LAN:${C_RESET}   172.21.5.133 • Wi-Fi: AramisWn (Canal 6)                 ${C_GREEN}║${C_RESET}\n"
	printf "${C_GREEN}║${C_RESET}  ${C_CYAN}RAM (64M):${C_RESET}  ${_MEM_LINE#Memory: }\n"
	printf "${C_GREEN}║${C_RESET}  ${C_CYAN}AirDisk:${C_RESET}   SAMSUNG HM501II (465,76 GB en /Volumes)                  ${C_GREEN}║${C_RESET}\n"
	printf "${C_GREEN}║${C_RESET}  ${C_CYAN}Atajos:${C_RESET}    Escribí ${C_YELLOW}mem${C_RESET}, ${C_YELLOW}discos${C_RESET}, ${C_YELLOW}wifi${C_RESET}, ${C_YELLOW}clientes${C_RESET} o ${C_YELLOW}ayuda${C_RESET}\n"
	printf "${C_GREEN}╚══════════════════════════════════════════════════════════════════════╝${C_RESET}\n"
	_update_ps1
	;;
esac
'''

def run_ssh(ip, pw, cmd):
    pid, fd = pty.fork()
    if pid == 0:
        os.execvp("ssh", [
            "ssh", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
            "-o", "PubkeyAuthentication=no",
            "-o", "HostKeyAlgorithms=+ssh-rsa", "-o", "PubkeyAcceptedAlgorithms=+ssh-rsa",
            "-o", "KexAlgorithms=+diffie-hellman-group14-sha1,diffie-hellman-group1-sha1",
            "-o", "Ciphers=+aes128-cbc,3des-cbc,aes128-ctr,aes256-ctr",
            f"root@{ip}", cmd
        ])
    out = b""
    sent_pw = False
    deadline = time.time() + 12
    while time.time() < deadline:
        r, _, _ = select.select([fd], [], [], 0.2)
        if fd in r:
            try:
                chunk = os.read(fd, 4096)
                if not chunk: break
                out += chunk
                if not sent_pw and (b"assword:" in out or b"Password:" in out):
                    os.write(fd, (pw + "\n").encode())
                    sent_pw = True
            except OSError: break
    os.close(fd)
    os.waitpid(pid, 0)
    return out.decode("utf-8", errors="ignore")

for ip, pw, prof_content in [
    ("172.21.5.114", "Lasflores506", PROFILE_114),
    ("172.21.5.133", "juanmaioli506", PROFILE_133),
]:
    # Escapar comillas simples para escribir archivo de forma limpia en NetBSD sh
    escaped = prof_content.replace("'", "'\\''")
    auth_cmd = ""
    if pubkey:
        auth_line = f'command="[ -f /mnt/Flash/profile.custom ] && chmod u+w /.profile 2>/dev/null && cp /mnt/Flash/profile.custom /.profile; if [ -n \\"$SSH_ORIGINAL_COMMAND\\" ]; then eval \\"$SSH_ORIGINAL_COMMAND\\"; else ENV=/.profile exec /bin/sh -i; fi" {pubkey}'
        escaped_auth = auth_line.replace("'", "'\\''")
        auth_cmd = f"printf '%s\\n' '{escaped_auth}' > /mnt/Flash/ssh_authorized_keys && chmod 600 /mnt/Flash/ssh_authorized_keys && "

    remote_cmd = (
        f"chmod u+w /.profile 2>/dev/null || true; "
        f"printf '%s\\n' '{escaped}' > /mnt/Flash/profile.custom && "
        f"cp /mnt/Flash/profile.custom /.profile && "
        f"{auth_cmd}"
        f"sync && echo INSTALADO_OK_{ip}"
    )
    res = run_ssh(ip, pw, remote_cmd)
    print(ip, "->", "OK" if f"INSTALADO_OK_{ip}" in res else res)
PYEOF
