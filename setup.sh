#!/bin/bash
# まっさらな Raspberry Pi OS に ForestryApp を構築するスクリプト。
#
#   git clone https://github.com/Parbon1212/ForestryApp_Public.git ~/mysite
#   cd ~/mysite && ./setup.sh
#   sudo reboot
#
# 何度実行しても同じ結果になる（2 回目以降は差分の反映だけ）。
# sudo を付けずに実行する（必要な所だけ内部で sudo を使う）。
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"
APP_DIR=$(pwd)
APP_USER=$(id -un)

log() { echo; echo "[setup] $*"; }
render() { sed -e "s|@APP_DIR@|$APP_DIR|g" -e "s|@APP_USER@|$APP_USER|g" "$1"; }
install_rendered() {  # install_rendered SRC DST
  local tmp; tmp=$(mktemp)
  render "$1" > "$tmp"
  sudo install -m 644 "$tmp" "$2"
  rm -f "$tmp"
}

if [ "$(id -u)" -eq 0 ]; then
  echo "sudo を付けずに ./setup.sh で実行してください。" >&2
  exit 1
fi

# --- 1. パッケージ ---
log "必要なパッケージをインストールします..."
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  git usbutils rfkill uhubctl \
  gpsd python3-gps \
  python3-flask python3-flask-cors python3-pyproj python3-openssl \
  hostapd dnsmasq

# --- 2. Wi-Fi アクセスポイント ---
log "Wi-Fi アクセスポイントを設定します..."
if command -v raspi-config >/dev/null; then
  sudo raspi-config nonint do_wifi_country JP
fi
sudo rfkill unblock wlan || true
sudo install -m 644 setup/nm-forestryapp.conf /etc/NetworkManager/conf.d/90-forestryapp.conf
sudo install -m 644 setup/dnsmasq-forestryapp.conf /etc/dnsmasq.d/forestryapp.conf
install_rendered setup/forestryapp-ap-ip.service /etc/systemd/system/forestryapp-ap-ip.service
chmod 755 setup/wifi_credentials.sh setup/firstboot.sh
if ! sudo grep -qs 'wifi_credentials.sh' /etc/hostapd/hostapd.conf; then
  sudo setup/wifi_credentials.sh
fi
sudo sed -i 's|^#\?DAEMON_CONF=.*|DAEMON_CONF="/etc/hostapd/hostapd.conf"|' /etc/default/hostapd 2>/dev/null || true
sudo systemctl unmask hostapd

# --- 3. gpsd ---
log "gpsd を設定します..."
sudo tee /etc/default/gpsd >/dev/null <<'EOF'
START_DAEMON="true"
USBAUTO="true"
DEVICES="/dev/gnss"
GPSD_OPTIONS="-n -b"
SOCKET="/var/run/gpsd.sock"
EOF

# --- 4. アプリ本体のサービス・udev ルール ---
log "サービスと udev ルールを登録します..."
for f in system/systemd/*.service; do
  install_rendered "$f" "/etc/systemd/system/$(basename "$f")"
done
for f in system/udev/*.rules; do
  install_rendered "$f" "/etc/udev/rules.d/$(basename "$f")"
done
install_rendered setup/forestryapp-firstboot.service /etc/systemd/system/forestryapp-firstboot.service

# 画面の「電源OFF」ボタン用に poweroff だけ sudo を許可
tmp=$(mktemp)
echo "$APP_USER ALL=(root) NOPASSWD: /usr/sbin/poweroff, /sbin/poweroff" > "$tmp"
sudo visudo -cf "$tmp" >/dev/null
sudo install -m 440 "$tmp" /etc/sudoers.d/forestryapp
rm -f "$tmp"

mkdir -p data
chmod 755 ./*.sh

sudo systemctl daemon-reload
sudo udevadm control --reload
for f in system/systemd/*.service; do
  sudo systemctl enable --quiet "$(basename "$f")"
done
sudo systemctl enable --quiet \
  forestryapp-ap-ip.service forestryapp-firstboot.service \
  hostapd.service dnsmasq.service gpsd.socket

# --- 完了 ---
log "完了しました。再起動すると AP とアプリが起動します: sudo reboot"
echo
sudo sed -n 's/^\(SSID\|PASSWORD\|URL\)=/  \1: /p' "$( [ -d /boot/firmware ] && echo /boot/firmware || echo /boot )/forestryapp-wifi.txt"
echo
echo "配布用イメージを作る場合は、再起動して動作を確認してから tools/prepare_image.sh を実行してください。"
