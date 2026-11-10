#!/bin/bash
# 配布イメージから起動した最初の 1 回だけ実行される（forestryapp-firstboot.service）。
# 全台で同じになってはいけないものを、この端末専用に作り直す。
#
# 実行条件: /etc/forestryapp-firstboot がある（tools/prepare_image.sh が作成）
set -u
FLAG=/etc/forestryapp-firstboot
APP_DIR=$(dirname "$(dirname "$(readlink -f "$0")")")

log() { echo "[forestryapp-firstboot] $*"; }

# 1. SSH ホスト鍵
log "SSH ホスト鍵を生成します"
rm -f /etc/ssh/ssh_host_*
ssh-keygen -A

# 2. machine-id（prepare_image.sh で空にしてあれば systemd が起動時に生成済み）
if [ ! -s /etc/machine-id ]; then
  systemd-machine-id-setup
fi
if [ -d /var/lib/dbus ]; then
  ln -sf /etc/machine-id /var/lib/dbus/machine-id
fi

# 3. Wi-Fi の SSID / パスワード（端末ごとに別）
log "Wi-Fi 設定を生成します"
"$APP_DIR/setup/wifi_credentials.sh"

# 4. ホスト名を SSID と揃える（同じ現場に複数台あっても区別できるように）
SSID=$(sed -n 's/^ssid=//p' /etc/hostapd/hostapd.conf)
NEW_HOST=$(echo "$SSID" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9-\n' '-')
if [ -n "$NEW_HOST" ]; then
  OLD_HOST=$(cat /etc/hostname)
  echo "$NEW_HOST" > /etc/hostname
  if grep -q '^127\.0\.1\.1' /etc/hosts; then
    sed -i "s/^127\.0\.1\.1.*/127.0.1.1\t$NEW_HOST/" /etc/hosts
  else
    printf '127.0.1.1\t%s\n' "$NEW_HOST" >> /etc/hosts
  fi
  hostname "$NEW_HOST"
  log "ホスト名: $OLD_HOST -> $NEW_HOST"
fi

rm -f "$FLAG"
log "完了しました"
