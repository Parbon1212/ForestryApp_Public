# Geo Field Studio

植林作業の現場で、GNSS（RTK）を使って植林ポイントへ誘導する Web アプリです。
Raspberry Pi 4 + GNSS 受信機で動作し、スマートフォンのブラウザから操作します。

## デモ

**https://parbon1212.github.io/ForestryApp_Public/**

受信機がなくても、ブラウザ内の擬似 GNSS で一連の操作を試せます。

- 右下の「DEMO 擬似GPS」から、自動歩行の ON/OFF・速度・手動移動を操作できます
- 誘導画面（STEP 7）では、次の植林ポイントへ自動で歩いて到着判定が進みます
- 植林ポイントの計算は実機（`TreePlanting.py`）と同じ手順をブラウザで行います
- 電源 OFF などのハードウェア操作は動作しません

## 構成

| パス | 内容 |
|---|---|
| `app.py` | Flask サーバー（gpsd から位置を取得、ポイント計算 API） |
| `templates/`, `static/` | 画面 |
| `*Calculation.py`, `TreePlanting.py` | 座標計算 |
| `gnss_*.sh` | GNSS 受信機の USB 接続管理 |
| `system/` | systemd サービス・udev ルール（`update.sh` が `/etc` に反映） |
| `update.sh` | 実機の更新スクリプト |
| `docs/` | GitHub Pages 用デモ（`python3 tools/build_demo.py` で生成） |

## 実機の更新

Raspberry Pi 上で次を実行します（GitHub アカウント不要）。

```bash
cd ~/mysite && ./update.sh
```

最新のコードを取得し、`system/` の設定に変更があれば `/etc` に反映して、webapp を再起動します。
`/etc/systemd/system` や `/etc/udev/rules.d` の設定を変えたときは、`system/` 側も同じ内容に更新してコミットしてください。

画面を変更したら `python3 tools/build_demo.py` を実行して `docs/` を更新してください。
