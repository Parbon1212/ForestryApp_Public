#!/bin/bash
# GNSS(Septentrio 152a:85c0) を、システムが落ち着いてから通電し、
# 認識(enumerate)できるまでリトライする起動時スクリプト。
#
# 背景: デバイスを挿したままPiをコールドブートすると、起動直後の多忙な
# タイミングで電源ONすると `error -71` で列挙に失敗する。一方、システムが
# アイドルになってからの「後刺し」相当（uhubctlのOFF→ON）なら認識する。
# → 起動から BOOT_HOLD_SECS(既定120秒) 経つまでは電源OFF＆認識禁止のまま待ち、
#   その後に許可フラグを立てて、認識するまで電源サイクルを繰り返す。
#
# 認識禁止: /etc/udev/rules.d/99-gnss-usb.rules が、許可フラグ
# ($ALLOW_FLAG, /run なので再起動で消える) が無い間は 152a:85c0 を
# authorized=0 にしてドライバを結合させない（早期列挙・途中の抜き差し対策）。
#
# gnss-usb-on.service から Type=oneshot で呼ばれる（root実行）。
set -u

HUB="1-1"                          # 外付けUSB2ハブ(2109:3431)のlocation
PORT="2"                           # Septentrioが接続されているポート
VENDORPROD="152a:85c0"
UHUBCTL="/usr/sbin/uhubctl"

ALLOW_FLAG="/run/gnss-usb-allowed"  # udevの認識禁止を解除するフラグ

BOOT_HOLD_SECS="${BOOT_HOLD_SECS:-120}"  # 起動(uptime)からこの秒数までは認識させない
OFF_SECS="${OFF_SECS:-6}"          # 電源オフ時間（後刺し相当のリセット）
WAIT_SECS="${WAIT_SECS:-8}"        # 電源ON後、列挙を待つ秒数
MAX_TRIES="${MAX_TRIES:-6}"        # 最大試行回数

log() { echo "[gnss-usb-bringup] $*"; }
present() { lsusb 2>/dev/null | grep -qi "$VENDORPROD"; }

uptime_secs() { cut -d. -f1 /proc/uptime; }

# 起動から BOOT_HOLD_SECS 経つまで待つ（RTC無しで時計が飛ぶため uptime 基準）
up=$(uptime_secs)
if [ "$up" -lt "$BOOT_HOLD_SECS" ]; then
  log "uptime ${up}s: holding GNSS port OFF until uptime ${BOOT_HOLD_SECS}s ($((BOOT_HOLD_SECS - up))s)..."
  sleep $((BOOT_HOLD_SECS - up))
fi

# 認識禁止を解除してから電源サイクル（再列挙時に udev が authorized=0 にしない）
touch "$ALLOW_FLAG"
log "uptime $(uptime_secs)s: GNSS allowed. bringing up port (hub ${HUB} port ${PORT})..."

for t in $(seq 1 "$MAX_TRIES"); do
  log "attempt ${t}/${MAX_TRIES}: uhubctl cycle -d ${OFF_SECS}"
  "$UHUBCTL" -e -l "$HUB" -p "$PORT" -a cycle -d "$OFF_SECS" >/dev/null 2>&1
  sleep "$WAIT_SECS"
  if present; then
    log "GNSS enumerated on attempt ${t}. /dev/gnss -> $(readlink -f /dev/gnss 2>/dev/null || echo '(まだ)')"
    exit 0
  fi
  log "not enumerated yet (likely -71), retrying..."
done

# 最終的に認識できなくても、ポートは通電状態にして終える
# （webapp等は動かす。ブートを失敗扱いにしない）
log "GNSS not enumerated after ${MAX_TRIES} attempts; leaving port powered ON."
"$UHUBCTL" -e -l "$HUB" -p "$PORT" -a on >/dev/null 2>&1
exit 0
