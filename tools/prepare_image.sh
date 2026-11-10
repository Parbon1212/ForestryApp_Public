#!/bin/bash
# 配布用イメージを作る直前に、マスター SD から個人情報・鍵・履歴を消してシャットダウンする。
#
#   cd ~/mysite && tools/prepare_image.sh
#
# 前提: setup.sh で構築し、動作確認まで済んだ「配布専用」の Pi で実行すること。
#       開発に使っている Pi では絶対に実行しない（ログイン情報や作業データが消える）。
#
# 実行後は電源が切れる。そのまま SD を PC に挿してイメージを吸い出す。
# 次にこの SD（またはコピー）を起動すると、firstboot が端末ごとの
# SSH 鍵・Wi-Fi パスワード・ホスト名を生成する。
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")/.."
APP_DIR=$(pwd)
APP_USER=$(id -un)
HOME_DIR=$(getent passwd "$APP_USER" | cut -d: -f6)
BOOT_DIR=/boot/firmware
[ -d "$BOOT_DIR" ] || BOOT_DIR=/boot

if [ "$(id -u)" -eq 0 ]; then
  echo "sudo を付けずに実行してください。" >&2
  exit 1
fi

# Git 管理外のファイルは後で git clean で消すので、残したい変更は先にコミットさせる
if [ -n "$(git status --porcelain)" ]; then
  echo "コミットされていない変更があります。必要なものはコミット・push してから実行してください:" >&2
  git status --short >&2
  exit 1
fi

cat <<EOF
=====================================================================
 配布用イメージの準備 — 次のものを削除します（元に戻せません）
=====================================================================
  - $HOME_DIR 内のログイン情報・履歴
      (.claude, .vscode*, .config/Code, .copilot, .gitconfig, .ssh,
       .bash_history, .cache, mkcert の CA 鍵 など)
  - $APP_DIR の Git 管理外ファイル (data/, ログ, 証明書, backup_settings など)
  - /root の履歴・SSH 鍵
  - SSH ホスト鍵、machine-id、システムログ
  - 保存済みの Wi-Fi 接続設定、Raspberry Pi Imager の初期設定ファイル
  - パスワード無しで sudo できる設定 (010_pi-nopasswd)
 さらに $APP_USER のパスワードを「次回ログイン時に変更必須」にして、電源を切ります。
=====================================================================
EOF
read -r -p "続けるには PREPARE と入力してください: " ans
[ "$ans" = "PREPARE" ] || { echo "中止しました。"; exit 1; }

log() { echo "[prepare] $*"; }

log "ユーザーのログイン情報・履歴を削除"
for p in .bash_history .lesshst .wget-hsts .python_history .viminfo .sudo_as_admin_successful \
         .cache .claude .claude.json .vscode .vscode-server .config/Code .copilot \
         .gitconfig .git-credentials .config/gh .ssh .local/share/mkcert .local/share/recently-used.xbel \
         .gunicorn .dotnet; do
  rm -rf "${HOME_DIR:?}/$p"
done

log "アプリの Git 管理外ファイルを削除"
git clean -xdfq
mkdir -p data

sudo bash -euo pipefail <<EOF
echo "[prepare] root の履歴・鍵を削除"
rm -rf /root/.bash_history /root/.ssh /root/.cache /root/.lesshst

echo "[prepare] SSH ホスト鍵・machine-id を削除（初回起動時に再生成）"
rm -f /etc/ssh/ssh_host_*
: > /etc/machine-id
rm -f /var/lib/dbus/machine-id

echo "[prepare] Wi-Fi 接続設定を削除"
for f in /etc/NetworkManager/system-connections/*.nmconnection; do
  [ -e "\$f" ] || continue
  if grep -q '^type=wifi' "\$f"; then rm -f "\$f"; fi
done
rm -f /etc/wpa_supplicant/wpa_supplicant.conf

echo "[prepare] Imager の初期設定（Wi-Fi パスワードやユーザー情報を含む）を削除し、cloud-init を無効化"
rm -f "$BOOT_DIR/user-data" "$BOOT_DIR/network-config" "$BOOT_DIR/firstrun.sh"
mkdir -p /etc/cloud && touch /etc/cloud/cloud-init.disabled

echo "[prepare] パスワード無し sudo を無効化（poweroff だけは /etc/sudoers.d/forestryapp で許可済み）"
rm -f /etc/sudoers.d/010_pi-nopasswd

echo "[prepare] $APP_USER のパスワードを次回ログイン時に変更必須にする"
passwd -e "$APP_USER" >/dev/null

echo "[prepare] Wi-Fi パスワードを破棄（初回起動時に端末ごとに生成）"
rm -f "$BOOT_DIR/forestryapp-wifi.txt" /etc/hostapd/hostapd.conf
touch /etc/forestryapp-firstboot

echo "[prepare] ログ・キャッシュを削除"
apt-get clean
journalctl --rotate >/dev/null 2>&1 || true
journalctl --vacuum-time=1s >/dev/null 2>&1 || true
find /var/log -type f \( -name '*.gz' -o -name '*.[0-9]' -o -name '*.old' \) -delete
find /var/log -type f -name '*.log' -exec truncate -s 0 {} +
rm -rf /tmp/* /var/tmp/*
EOF

log "完了。10 秒後に電源を切ります（Ctrl+C で中止）"
sleep 10
history -c 2>/dev/null || true
sudo poweroff
