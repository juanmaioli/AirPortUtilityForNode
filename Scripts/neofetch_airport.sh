#!/bin/sh
# ==============================================================================
# neofetch - Utilidad informativa estilo Neofetch para Apple AirPort (NetBSD)
# ==============================================================================

ESC=`printf '\033'`
C_RESET="${ESC}[0m"
C_BOLD="${ESC}[1m"
C_RED="${ESC}[1;31m"
C_GREEN="${ESC}[1;32m"
C_YELLOW="${ESC}[1;33m"
C_BLUE="${ESC}[1;34m"
C_MAGENTA="${ESC}[1;35m"
C_CYAN="${ESC}[1;36m"
C_WHITE="${ESC}[1;37m"

HOSTNAME=`hostname`
OS="NetBSD `uname -r` (`uname -m`)"
set -- `uname -v 2>/dev/null`
KERNEL="$1 $2 $3"

# Uptime y Memoria desde top -d 1
TOP_OUT=`top -d 1 2>/dev/null`
TOP_L1=`printf "%s\n" "$TOP_OUT" | sed -n '1p'`
UPTIME=`printf "%s\n" "$TOP_L1" | sed -e 's/.*up //' -e 's/[ ]*[0-9]*:[0-9]*:[0-9]*$//'`

SHELL_NAME="ash (NetBSD /bin/sh)"
CPU_NAME=`/sbin/sysctl -n hw.model 2>/dev/null | sed 's/ (.*//'`
RAM_TOTAL=`/sbin/sysctl -n hw.physmem 2>/dev/null`
RAM_MB=$(( RAM_TOTAL / 1048576 ))

RAM_ACT=`printf "%s\n" "$TOP_OUT" | sed -n 's/.*Memory: \([0-9]*[A-Z]*\) Act.*/\1/p'`
RAM_FREE=`printf "%s\n" "$TOP_OUT" | sed -n 's/.*, \([0-9]*[A-Z]*\) Free.*/\1/p'`
if [ -n "$RAM_ACT" ] && [ -n "$RAM_FREE" ]; then
	MEM_INFO="${RAM_ACT} activos / ${RAM_MB} MB (${RAM_FREE} libres)"
else
	MEM_INFO="${RAM_MB} MB"
fi

# Detección de AirDisk USB montado
set -- `df -h /Volumes/* 2>/dev/null | sed -n '2p'`
USB_DISK=""
if [ -n "$2" ]; then
	USB_VOL=`df -h /Volumes/* 2>/dev/null | sed -n '2p' | sed 's/.* \/Volumes\///'`
	USB_DISK="${USB_VOL:-USB} (${3} usados de ${2} - ${5})"
fi

SYAP=`/sbin/sysctl -n hw.model 2>/dev/null`
case "$SYAP" in
	*Cortex*)
		MODEL="Apple AirPort Extreme 802.11ac (6.ª Gen)"
		COLOR_LOGO="${C_CYAN}"
		TEMP=`/usr/sbin/envstat 2>/dev/null | sed -n 's/.*T_internal:[ ]*\([0-9.]*\).*/\1 °C/p'`
		FAN=`/usr/sbin/envstat 2>/dev/null | sed -n 's/.*Fan_rpm:[ ]*\([0-9]*\).*/\1 RPM/p'`
		EXTRA_LABEL="Sensores"
		EXTRA_VAL="CPU: ${TEMP:-39.8 °C} • Cooler: ${FAN:-1785 RPM}"
		NET_INFO="172.21.5.114 • Modo Repetidor (AramisW6-2)"
		;;
	*)
		MODEL="Apple AirPort Extreme 802.11n (2.ª Gen)"
		COLOR_LOGO="${C_GREEN}"
		EXTRA_LABEL="AirDisk USB"
		EXTRA_VAL="${USB_DISK:-SAMSUNG HM501II (466 GB)}"
		NET_INFO="172.21.5.133 • Wi-Fi: AramisWn (Canal 6)"
		;;
esac

set -- `df -h / 2>/dev/null | sed -n '2p'`
DF_ROOT="${3}/${2} (${5})"

set -- `df -h /mnt/Flash 2>/dev/null | sed -n '2p'`
DF_FLASH="${3}/${2} (${5})"

printf "\n"
printf "        ${C_GREEN}.:'${C_RESET}              ${C_BOLD}${C_RED}root${C_RESET}@${C_BOLD}${C_YELLOW}%s${C_RESET}\n" "${HOSTNAME%%.*}"
printf "      ${C_GREEN}__ :'__${C_RESET}            ---------------------------------------------\n"
printf "   ${COLOR_LOGO}.'\`__\`-'\`__\`\`.${C_RESET}       ${C_BOLD}${COLOR_LOGO}OS:${C_RESET}          %s\n" "${OS}"
printf "  ${COLOR_LOGO}:__________.-'${C_RESET}        ${C_BOLD}${COLOR_LOGO}Host:${C_RESET}        %s\n" "${MODEL}"
printf "  ${COLOR_LOGO}:_________:${C_RESET}           ${C_BOLD}${COLOR_LOGO}Kernel:${C_RESET}      %s\n" "${KERNEL}"
printf "   ${COLOR_LOGO}:_________\`-;${C_RESET}        ${C_BOLD}${COLOR_LOGO}Uptime:${C_RESET}      %s\n" "${UPTIME}"
printf "    ${COLOR_LOGO}\`.__.-.__.'${C_RESET}         ${C_BOLD}${COLOR_LOGO}Shell:${C_RESET}       %s\n" "${SHELL_NAME}"
printf "                        ${C_BOLD}${COLOR_LOGO}CPU:${C_RESET}         %s\n" "${CPU_NAME}"
printf "                        ${C_BOLD}${COLOR_LOGO}Memoria:${C_RESET}     %s\n" "${MEM_INFO}"
printf "                        ${C_BOLD}${COLOR_LOGO}%-12s${C_RESET} %s\n" "${EXTRA_LABEL}:" "${EXTRA_VAL}"
if [ -n "$USB_DISK" ] && [ "$EXTRA_LABEL" != "AirDisk USB" ]; then
printf "                        ${C_BOLD}${COLOR_LOGO}AirDisk USB:${C_RESET} %s\n" "${USB_DISK}"
fi
printf "                        ${C_BOLD}${COLOR_LOGO}Red:${C_RESET}         %s\n" "${NET_INFO}"
printf "                        ${C_BOLD}${COLOR_LOGO}Flash/RAM:${C_RESET}   / %s • /mnt/Flash %s\n\n" "${DF_ROOT}" "${DF_FLASH}"

# Paleta de bloques de color estilo Neofetch
printf "                        "
for col in 30 31 32 33 34 35 36 37; do
	printf "${ESC}[%sm███${C_RESET} " "${col}"
done
printf "\n                        "
for col in 90 91 92 93 94 95 96 97; do
	printf "${ESC}[%sm███${C_RESET} " "${col}"
done
printf "\n\n"
