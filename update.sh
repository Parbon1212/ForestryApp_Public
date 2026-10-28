#!/bin/bash
# mysite を最新版に更新するスクリプト。
#   使い方: cd ~/mysite && ./update.sh
#
# 1. GitHub から最新のコードを取得（git pull）
# 2. system/ 内の設定ファイルのうち、変更があったものだけ /etc に反映
# 3. systemd / udev を再読み込みし、webapp を再起動
#
# sudo を付けずに実行する（/etc への反映時だけ内部で sudo を使う）。
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

log() { echo "[update] $*"; }

if [ "$(id -u)" -eq 0 ]; then
  echo "sudo を付けずに ./update.sh で実行してください。" >&2
  exit 1
fi

# --- 1. コード更新 ---
log "GitHub から最新版を取得します..."
before=$(git rev-parse HEAD)
if ! git pull --ff-only; then
  echo >&2
  echo "更新できませんでした。この Pi 上でファイルが直接変更されている可能性があります。" >&2
  echo "git status で変更内容を確認してください。" >&2
  exit 1
fi
after=$(git rev-parse HEAD)
if [ "$before" = "$after" ]; then
  log "コードはすでに最新です。"
else
  git log --oneline "$before..$after" | sed 's/^/  /'
fi

# --- 2. 設定ファイルの反映 ---
# 引数: コピー元ディレクトリ, 反映先ディレクトリ, パターン
# 変更があったファイル数を返す（標準出力）
sync_dir() {
  local src=$1 dst=$2 pattern=$3 n=0 f
  for f in "$src"/$pattern; do
    [ -e "$f" ] || continue
    if ! cmp -s "$f" "$dst/$(basename "$f")"; then
      log "反映: $dst/$(basename "$f")" >&2
      sudo install -m 644 "$f" "$dst/"
      n=$((n + 1))
    fi
  done
  echo "$n"
}

systemd_changed=$(sync_dir system/systemd /etc/systemd/system '*.service')
udev_changed=$(sync_dir system/udev /etc/udev/rules.d '*.rules')

if [ "$systemd_changed" -gt 0 ]; then
  log "systemd を再読み込みします..."
  sudo systemctl daemon-reload
  for f in system/systemd/*.service; do
    sudo systemctl enable --quiet "$(basename "$f")"
  done
fi

if [ "$udev_changed" -gt 0 ]; then
  log "udev ルールを再読み込みします..."
  sudo udevadm control --reload
fi

if [ "$before" != "$after" ] && git diff --quiet "$before" "$after" -- requirements.txt; then
  :
elif [ "$before" != "$after" ]; then
  log "注意: requirements.txt が変更されています。必要なパッケージを確認してください。"
fi

# --- 3. アプリ再起動 ---
log "webapp を再起動します..."
sudo systemctl restart webapp.service

if [ "$((systemd_changed + udev_changed))" -gt 0 ]; then
  log "GNSS 関連の設定が変わりました。確実に反映するため再起動をおすすめします: sudo reboot"
fi

log "完了しました。"
