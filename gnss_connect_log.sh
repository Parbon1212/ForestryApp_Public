#!/bin/bash

LOG_DIR="/home/ae24iwamoto/mysite/data/gnss_disconnect_logs"
mkdir -p "$LOG_DIR"

EVENT_LOG="$LOG_DIR/usb_events.log"
STATE_FILE="$LOG_DIR/.last_connect_epoch"

TIMESTAMP=$(date '+%Y-%m-%d_%H-%M-%S')
LOG_FILE="$LOG_DIR/connect_${TIMESTAMP}.log"

date +%s > "$STATE_FILE"

{
    echo "===== GNSS接続ログ ====="
    echo "日時: $(date '+%Y-%m-%d %H:%M:%S')"
    echo ""

    echo "--- CPU温度 ---"
    vcgencmd measure_temp 2>/dev/null || echo "取得失敗"

    echo ""
    echo "--- 電圧・サーマルスロットリング ---"
    VOLTAGE=$(vcgencmd measure_volts 2>/dev/null)
    echo "供給電圧: $VOLTAGE"
    THROTTLED=$(vcgencmd get_throttled 2>/dev/null)
    echo "$THROTTLED"
    THR_HEX=$(echo "$THROTTLED" | grep -oP '0x[0-9a-fA-F]+')
    THR_DEC=$(printf '%d' "$THR_HEX" 2>/dev/null || echo 0)
    [ $((THR_DEC & 0x1)) -ne 0 ]      && echo "  ⚡ 電圧不足（接続時点）"
    [ $((THR_DEC & 0x4)) -ne 0 ]      && echo "  🌡 サーマルスロットリング（接続時点）"
    [ $((THR_DEC & 0x10000)) -ne 0 ]  && echo "  ⚡ 電圧不足（過去あり）"
    [ $((THR_DEC & 0x40000)) -ne 0 ]  && echo "  🌡 サーマルスロットリング（過去あり）"
    [ "$THR_HEX" = "0x0" ]            && echo "  → 正常（電圧・温度問題なし）"

    echo ""
    echo "--- USBデバイス一覧 ---"
    lsusb 2>/dev/null

    echo ""
    echo "--- 直前のカーネルログ（USB関連）---"
    dmesg | grep -i -E "usb|ttyACM|septentrio" | tail -20

} > "$LOG_FILE" 2>&1

echo "$(date '+%Y-%m-%d %H:%M:%S') CONNECT    -> $(basename "$LOG_FILE")" >> "$EVENT_LOG"

# 古いログを30件に制限
ls -t "$LOG_DIR"/connect_*.log 2>/dev/null | tail -n +31 | xargs rm -f

echo "GNSS接続ログ保存: $LOG_FILE"
