#!/bin/bash
# GNSS(Septentrio 152a:85c0) を、システムが落ち着いてから通電し、
# 認識(enumerate)できるまでリトライする起動時スクリプト。
#
# 背景: デバイスを挿したままPiをコールドブートすると、起動直後の多忙な
# タイミングで電源ONすると `error -71` で列挙に失敗する。一方、システムが
# アイドルになってからの「後刺し」相当（uhubctlのOFF→ON）なら認識する。
# → 十分待ってから、認識するまで電源サイクルを繰り返す。
#
# gnss-usb-on.service から Type=oneshot で呼ばれる（root実行）。
set -u

HUB="1-1"                          # 外付けUSB2ハブ(2109:3431)のlocation
PORT="2"                           # Septentrioが接続されているポート
VENDORPROD="152a:85c0"
UHUBCTL="/usr/sbin/uhubctl"

SETTLE_SECS="${SETTLE_SECS:-30}"   # 初回通電前に落ち着きを待つ秒数
OFF_SECS="${OFF_SECS:-6}"          # 電源オフ時間（後刺し相当のリセット）
WAIT_SECS="${WAIT_SECS:-8}"        # 電源ON後、列挙を待つ秒数
MAX_TRIES="${MAX_TRIES:-6}"        # 最大試行回数

log() { echo "[gnss-usb-bringup] $*"; }
present() { lsusb 2>/dev/null | grep -qi "$VENDORPROD"; }

log "settle ${SETTLE_SECS}s before bringing up GNSS port (hub ${HUB} port ${PORT})..."
sleep "$SETTLE_SECS"

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
