#!/bin/bash

LOG_DIR="/home/ae24iwamoto/mysite/data/gnss_disconnect_logs"
mkdir -p "$LOG_DIR"

EVENT_LOG="$LOG_DIR/usb_events.log"
STATE_FILE="$LOG_DIR/.last_connect_epoch"

# 1回の物理切断でも device 本体＋各interfaceのremoveイベントが複数発火するため、
# 直近2秒以内に既に記録済みなら何もしない（複数発火時は最初の1回だけ記録する）
DEBOUNCE_FILE="$LOG_DIR/.last_disconnect_epoch_ns"
LOCK_FILE="$LOG_DIR/.disconnect.lock"
exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

NOW_NS=$(date +%s%N)
if [ -f "$DEBOUNCE_FILE" ]; then
    LAST_NS=$(cat "$DEBOUNCE_FILE")
    if [ -n "$LAST_NS" ] && [ $((NOW_NS - LAST_NS)) -lt 2000000000 ]; then
        exit 0
    fi
fi
echo "$NOW_NS" > "$DEBOUNCE_FILE"

TIMESTAMP=$(date '+%Y-%m-%d_%H-%M-%S')
LOG_FILE="$LOG_DIR/disconnect_${TIMESTAMP}.log"

{
    echo "===== GNSS切断ログ ====="
    echo "日時: $(date '+%Y-%m-%d %H:%M:%S')"
    echo ""

    echo "--- CPU温度 ---"
    vcgencmd measure_temp 2>/dev/null || echo "取得失敗"

    echo ""
    echo "--- 電圧・電力・サーマルスロットリング ---"
    VOLTAGE=$(vcgencmd measure_volts 2>/dev/null)
    echo "供給電圧: $VOLTAGE"
    # 電力推定（Septentrio USB最大900mA）
    VOLT_VAL=$(echo "$VOLTAGE" | grep -oP '\d+\.\d+')
    if [ -n "$VOLT_VAL" ]; then
        POWER=$(echo "$VOLT_VAL * 0.9" | bc -l 2>/dev/null)
        printf "推定電力: %.3f W\n" "$POWER"
    fi

    THROTTLED=$(vcgencmd get_throttled 2>/dev/null)
    echo "$THROTTLED"
    THR_HEX=$(echo "$THROTTLED" | grep -oP '0x[0-9a-fA-F]+')
    THR_DEC=$(printf '%d' "$THR_HEX" 2>/dev/null || echo 0)
    [ $((THR_DEC & 0x1)) -ne 0 ]      && echo "  ⚡ 電圧不足（切断時点）"
    [ $((THR_DEC & 0x4)) -ne 0 ]      && echo "  🌡 サーマルスロットリング（切断時点）"
    [ $((THR_DEC & 0x10000)) -ne 0 ]  && echo "  ⚡ 電圧不足（過去あり）"
    [ $((THR_DEC & 0x40000)) -ne 0 ]  && echo "  🌡 サーマルスロットリング（過去あり）"
    [ "$THR_HEX" = "0x0" ]            && echo "  → 正常（電圧・温度問題なし）"

    echo ""
    echo "--- USBデバイス一覧 ---"
    lsusb 2>/dev/null

    echo ""
    echo "--- 直前のカーネルログ（USB関連）---"
    dmesg | grep -i -E "usb|ttyACM|septentrio|error -71|disconnect|cannot reset|power cycle" | tail -20

    echo ""
    echo "--- 直前のsystemdログ（30秒分）---"
    journalctl --no-pager -n 50 --since "30 seconds ago" 2>/dev/null | grep -v "python3\|avahi\|mDNS\|multicast"

} > "$LOG_FILE" 2>&1

if [ -f "$STATE_FILE" ]; then
    LAST_EPOCH=$(cat "$STATE_FILE")
    NOW_EPOCH=$(date +%s)
    DURATION=$((NOW_EPOCH - LAST_EPOCH))
    DURATION_STR=$(printf '%dh%02dm%02ds' $((DURATION/3600)) $((DURATION%3600/60)) $((DURATION%60)))
else
    DURATION_STR="不明"
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') DISCONNECT (接続時間: ${DURATION_STR}) -> $(basename "$LOG_FILE")" >> "$EVENT_LOG"

# 古いログを30件に制限
ls -t "$LOG_DIR"/disconnect_*.log 2>/dev/null | tail -n +31 | xargs rm -f

echo "GNSS切断ログ保存: $LOG_FILE"
