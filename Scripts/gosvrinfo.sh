#!/bin/sh
# ==============================================================================
# gosvrinfo - Recolector de telemetría de sistema para Apple AirPort (NetBSD)
# Compatible con el esquema JSON de GoSvrInfo / GoManager (host.json).
# ==============================================================================

# 1. Metadatos de fecha y tiempo
NOW=$(date +%s 2>/dev/null || echo 0)
HOSTNAME=$(hostname 2>/dev/null || echo "AirPort")

# 2. Uptime en segundos
BOOT_TIME=$(/sbin/sysctl -n kern.boottime 2>/dev/null | sed 's/[^0-9]//g')
if [ -n "$BOOT_TIME" ] && [ "$BOOT_TIME" -gt 0 ] 2>/dev/null; then
    SYSTEM_UPTIME=$(( NOW - BOOT_TIME ))
else
    SYSTEM_UPTIME=0
fi

# 3. Detección de Modelo y Sistema Operativo
SYS_MODEL=$(/sbin/sysctl -n hw.model 2>/dev/null || echo "evbarm")
SYS_OS=$(uname -s 2>/dev/null || echo "NetBSD")
SYS_KERNEL=$(uname -r 2>/dev/null || echo "embedded")

case "$SYS_MODEL" in
    *Cortex*|*BCM*|*bcm*)
        CPU_NAME="Broadcom BCM53019 Cortex-A9"
        CPU_CORES=2
        CPU_SPEED="1.00 GHz"
        RAM_TOTAL_MB=256
        OS_VERSION="6.0 (Apple 7.9.1)"
        ;;
    *)
        CPU_NAME="Marvell 88F5281 ARM926EJ-S"
        CPU_CORES=1
        CPU_SPEED="0.50 GHz"
        RAM_TOTAL_MB=64
        OS_VERSION="4.0_STABLE (Apple 7.8.1)"
        ;;
esac

# 4. Uso de CPU y RAM activa
TOP_OUT=$(/usr/bin/top -b -d 2 -s 1 2>/dev/null || /usr/bin/top -d 1 2>/dev/null)

# CPU Usage
IDLE_CPU=$(echo "$TOP_OUT" | sed -n 's/.* \([0-9.]*\)% idle.*/\1/p' | tail -n 1)
if [ -n "$IDLE_CPU" ]; then
    IDLE_INT=${IDLE_CPU%%.*}
    CPU_USAGE="$(( 100 - IDLE_INT ))%"
else
    CPU_USAGE="0%"
fi

# RAM Usage (sin usar cut)
RAM_ACT_RAW=$(echo "$TOP_OUT" | sed -n 's/.*Memory: \([0-9]*\)\([KkMmGg]\) Act.*/\1 \2/p' | tail -n 1)
RAM_ACT_NUM="${RAM_ACT_RAW%% *}"
RAM_ACT_UNIT="${RAM_ACT_RAW##* }"

if [ "$RAM_ACT_UNIT" = "K" ] || [ "$RAM_ACT_UNIT" = "k" ]; then
    RAM_ACT_MB=$(( RAM_ACT_NUM / 1024 ))
elif [ "$RAM_ACT_UNIT" = "M" ] || [ "$RAM_ACT_UNIT" = "m" ]; then
    RAM_ACT_MB=$RAM_ACT_NUM
else
    RAM_ACT_MB=16
fi

RAM_USAGE="$(( (RAM_ACT_MB * 100) / RAM_TOTAL_MB ))%"

# 5. Geolocalización e IP Pública (vía ip-api.com)
GEO_JSON=$(/usr/bin/curl -s --max-time 3 http://ip-api.com/json/ 2>/dev/null || echo "{}")

get_json_val() {
    echo "$GEO_JSON" | sed -n "s/.*\"$1\":[ ]*\"\([^\"]*\)\".*/\1/p"
}
get_json_num() {
    echo "$GEO_JSON" | sed -n "s/.*\"$1\":[ ]*\([0-9.-]*\).*/\1/p"
}

IP_PUBLIC=$(get_json_val "query")
[ -z "$IP_PUBLIC" ] && IP_PUBLIC="N/A"
CITY=$(get_json_val "city")
[ -z "$CITY" ] && CITY="N/A"
COUNTRY=$(get_json_val "country")
[ -z "$COUNTRY" ] && COUNTRY="N/A"
LATITUDE=$(get_json_num "lat")
[ -z "$LATITUDE" ] && LATITUDE=0.0
LONGITUDE=$(get_json_num "lon")
[ -z "$LONGITUDE" ] && LONGITUDE=0.0
TIMEZONE=$(get_json_val "timezone")
[ -z "$TIMEZONE" ] && TIMEZONE="N/A"
ISP=$(get_json_val "isp")
[ -z "$ISP" ] && ISP="N/A"

# 6. Espacio en disco (JSON array)
DISKS_JSON=""
FIRST_DISK=1
/bin/df -k 2>/dev/null | while read -r dev total used avail cap mnt; do
    case "$dev" in
        /dev/dk*|/dev/flash*|/dev/md*|/dev/wd*)
            if [ "$total" -gt 0 ] 2>/dev/null; then
                if [ "$total" -gt 1048576 ]; then
                    SZ_GB=$(( total / 1048576 ))
                    U_GB=$(( used / 1048576 ))
                    SZ_STR="${SZ_GB} GB"
                    U_STR="${U_GB} GB"
                else
                    SZ_MB=$(( total / 1024 ))
                    U_MB=$(( used / 1024 ))
                    SZ_STR="${SZ_MB} MB"
                    U_STR="${U_MB} MB"
                fi
                U_PCT="${cap}"

                [ $FIRST_DISK -eq 0 ] && printf ",\n"
                printf "    {\n"
                printf "      \"filesystem\": \"%s\",\n" "$dev"
                printf "      \"total_space\": \"%s\",\n" "$SZ_STR"
                printf "      \"used_space\": \"%s\",\n" "$U_STR"
                printf "      \"usage_percentage\": \"%s\",\n" "$U_PCT"
                printf "      \"mounted_on\": \"%s\"\n" "$mnt"
                printf "    }"
                FIRST_DISK=0
            fi
            ;;
    esac
done > /tmp/.gosvrinfo_disks.tmp

# 7. Interfaces de red (JSON array)
CUR_IF=""
CUR_MAC=""
CUR_IP=""
FIRST_IF=1

/sbin/ifconfig -a 2>/dev/null | while IFS= read -r line; do
    case "$line" in
        [a-zA-Z0-9]*:*)
            if [ -n "$CUR_IF" ]; then
                [ $FIRST_IF -eq 0 ] && printf ",\n"
                printf "    {\n"
                printf "      \"interface\": \"%s\",\n" "$CUR_IF"
                printf "      \"ip_address\": \"%s\",\n" "${CUR_IP:-N/A}"
                printf "      \"mac_address\": \"%s\"\n" "${CUR_MAC:-N/A}"
                printf "    }"
                FIRST_IF=0
            fi
            CUR_IF="${line%%:*}"
            CUR_MAC=""
            CUR_IP=""
            ;;
        *ether\ *)
            mac_part="${line#*ether }"
            CUR_MAC="${mac_part%% *}"
            ;;
        *inet\ *)
            case "$line" in
                *127.0.0.1*|*169.254.*) ;;
                *)
                    if [ -z "$CUR_IP" ]; then
                        ip_part="${line#*inet }"
                        CUR_IP="${ip_part%% *}"
                    fi
                    ;;
            esac
            ;;
    esac
done > /tmp/.gosvrinfo_ifaces.tmp

# Procesar última interfaz si quedó pendiente
if [ -n "$CUR_IF" ]; then
    printf ",\n    {\n      \"interface\": \"%s\",\n      \"ip_address\": \"%s\",\n      \"mac_address\": \"%s\"\n    }" "$CUR_IF" "${CUR_IP:-N/A}" "${CUR_MAC:-N/A}" >> /tmp/.gosvrinfo_ifaces.tmp
fi

# 8. Emisión del JSON final
cat << JSONEOF
{
  "time": $NOW,
  "system_uptime": $SYSTEM_UPTIME,
  "hostname": "$HOSTNAME",
  "operating_system": {
    "name": "$SYS_OS",
    "version": "$OS_VERSION",
    "kernel_version": "$SYS_KERNEL"
  },
  "ip_public_address": "$IP_PUBLIC",
  "city": "$CITY",
  "country": "$COUNTRY",
  "latitude": $LATITUDE,
  "longitude": $LONGITUDE,
  "timezone": "$TIMEZONE",
  "isp": "$ISP",
  "CPU": "$CPU_NAME",
  "cores": $CPU_CORES,
  "cpu_speed": "$CPU_SPEED",
  "cpu_usage": "$CPU_USAGE",
  "RAM": "${RAM_TOTAL_MB} MB",
  "ram_usage": "$RAM_USAGE",
  "GPU": {
    "name": "N/A",
    "driver_version": "N/A",
    "memory": "N/A"
  },
  "disk_space": [
$(cat /tmp/.gosvrinfo_disks.tmp 2>/dev/null)
  ],
  "network_interfaces": [
$(cat /tmp/.gosvrinfo_ifaces.tmp 2>/dev/null)
  ]
}
JSONEOF

rm -f /tmp/.gosvrinfo_disks.tmp /tmp/.gosvrinfo_ifaces.tmp 2>/dev/null
