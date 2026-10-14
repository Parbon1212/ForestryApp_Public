#!/bin/bash
# Septentrio の USB 給電を切って再投入する（本体のUSBコントローラをリセット）
# uhubctl でポート単位の電源制御を行う

HUB="1-1"

# Septentrio が刺さっているポートを自動検出（接続されていれば idVendor で判別）
detect_port() {
    for port in 1 2 3 4; do
        dev=$(find /sys/bus/usb/devices -maxdepth 1 -name "${HUB}.${port}" 2>/dev/null)
        if [ -n "$dev" ] && grep -q "152a" "$dev/idVendor" 2>/dev/null; then
            echo "$port"
            return
        fi
    done
    echo ""
}

# 今の状態を表示
echo "[$(date '+%H:%M:%S')] uhubctl 現在状態:"
sudo uhubctl -l "$HUB" 2>/dev/null

PORT=$(detect_port)

if [ -z "$PORT" ]; then
    # 列挙失敗で idVendor が読めない場合は connect フラグのあるポートを探す
    echo "[$(date '+%H:%M:%S')] Septentrio 自動検出できず。connect 状態のポートを探します..."
    PORT=$(sudo uhubctl -l "$HUB" 2>/dev/null | grep "connect" | grep -v "Hub" | head -1 | grep -oP 'Port \K[0-9]+')
fi

if [ -z "$PORT" ]; then
    echo "エラー: Septentrio のポートが特定できません。ポート番号を引数で指定してください。"
    echo "使い方: $0 <port番号>"
    exit 1
fi

echo "[$(date '+%H:%M:%S')] ポート ${PORT} の電源をOFF（Septentrio 本体をリセット）..."
sudo uhubctl -l "$HUB" -p "$PORT" -a off
sleep 3

echo "[$(date '+%H:%M:%S')] ポート ${PORT} の電源をON..."
sudo uhubctl -l "$HUB" -p "$PORT" -a on
sleep 4

# 列挙完了を待つ
for i in $(seq 1 15); do
    if [ -e /dev/ttyACM0 ]; then
        echo "[$(date '+%H:%M:%S')] /dev/ttyACM0 検出"
        break
    fi
    echo "[$(date '+%H:%M:%S')] ttyACM0 待機中... ($i/15)"
    sleep 1
done

if [ ! -e /dev/ttyACM0 ]; then
    echo "[$(date '+%H:%M:%S')] ttyACM0 未検出。デバイスを確認してください。"
    exit 1
fi

echo "[$(date '+%H:%M:%S')] gpsd 再起動..."
sudo systemctl restart gpsd
sleep 2

echo "[$(date '+%H:%M:%S')] 完了"
sudo uhubctl -l "$HUB" 2>/dev/null
systemctl is-active --quiet gpsd && echo "gpsd: 動作中" || echo "gpsd: 起動失敗"
