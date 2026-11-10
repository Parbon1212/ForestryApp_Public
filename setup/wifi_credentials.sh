#!/bin/bash
# Wi-Fi アクセスポイント (hostapd) の SSID / パスワードを決めて /etc/hostapd/hostapd.conf を書き出す。
#
#   sudo ./wifi_credentials.sh        # 既存の設定ファイルがあればそれを使い、無ければ新規生成
#   sudo ./wifi_credentials.sh --new  # 必ず新しいパスワードを生成
#
# 決まった値は boot パーティションの forestryapp-wifi.txt に書き出す。
# (SD カードを PC に挿せば読めるので、配布前にラベルに書き写せる。
#  配布前にこのファイルを自分で書いておけば、その値が使われる)
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "root で実行してください (sudo)" >&2; exit 1; }

BOOT_DIR=/boot/firmware
[ -d "$BOOT_DIR" ] || BOOT_DIR=/boot
CRED="$BOOT_DIR/forestryapp-wifi.txt"
HOSTAPD_CONF=/etc/hostapd/hostapd.conf

default_ssid() {
  local serial
  serial=$(awk '/^Serial/{print $3}' /proc/cpuinfo 2>/dev/null)
  [ -n "$serial" ] || serial=$(cat /etc/machine-id 2>/dev/null)
  echo "ForestryApp-$(echo "${serial:-0000}" | tail -c 5 | tr '[:lower:]' '[:upper:]')"
}

# 紛らわしい文字 (0/O, 1/l/I) を除いた 12 文字
gen_password() {
  local p
  p=$(LC_ALL=C tr -dc 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789' </dev/urandom | head -c 12) || true
  echo "$p"
}

read_value() {  # read_value KEY  (CRED から KEY=値 を読む。CRLF も許容)
  [ -f "$CRED" ] || return 0
  sed -n "s/^$1=//p" "$CRED" | tr -d '\r' | head -n 1
}

SSID="" PASSWORD=""
if [ "${1:-}" != "--new" ]; then
  SSID=$(read_value SSID)
  PASSWORD=$(read_value PASSWORD)
fi
[ -n "$SSID" ] || SSID=$(default_ssid)
if [ ${#PASSWORD} -lt 8 ] || [ ${#PASSWORD} -gt 63 ]; then
  [ -z "$PASSWORD" ] || echo "PASSWORD は 8〜63 文字にしてください。新しく生成します。" >&2
  PASSWORD=$(gen_password)
fi

umask 077
mkdir -p "$(dirname "$HOSTAPD_CONF")"
cat > "$HOSTAPD_CONF" <<EOF
# forestryapp setup/wifi_credentials.sh が生成。直接編集せず $CRED を書き換えて
# sudo $(readlink -f "$0") を実行してください。
country_code=JP
interface=wlan0
driver=nl80211
ssid=$SSID
hw_mode=g
channel=7
wmm_enabled=0
macaddr_acl=0
auth_algs=1
ignore_broadcast_ssid=0
wpa=2
wpa_passphrase=$PASSWORD
wpa_key_mgmt=WPA-PSK
rsn_pairwise=CCMP
EOF

cat > "$CRED" <<EOF
# ForestryApp Wi-Fi 接続情報（この端末専用）
SSID=$SSID
PASSWORD=$PASSWORD
URL=https://10.42.0.1:5000
EOF

echo "SSID=$SSID"
echo "PASSWORD=$PASSWORD"
