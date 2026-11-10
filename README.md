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
| `system/` | systemd サービス・udev ルール（`update.sh` が `/etc` に反映。`@APP_DIR@` / `@APP_USER@` は設置先に置換される） |
| `setup.sh`, `setup/` | まっさらな OS への構築（Wi-Fi AP・gpsd・初回起動処理） |
| `update.sh` | 実機の更新スクリプト |
| `tools/prepare_image.sh` | 配布用イメージを作る前の掃除 |

## 新しい Pi の構築

Raspberry Pi Imager で **Raspberry Pi OS Lite (64-bit)** を書き込み、ユーザー名は任意（例: `forestry`）、SSH を有効にして起動します。

```bash
sudo apt install -y git
git clone https://github.com/Parbon1212/ForestryApp_Public.git ~/mysite
cd ~/mysite && ./setup.sh
sudo reboot
```

起動後、Wi-Fi `ForestryApp-XXXX` に接続して `https://10.42.0.1:5000` を開きます。
SSID とパスワードは `setup.sh` の最後に表示され、boot パーティションの `forestryapp-wifi.txt` にも保存されます。

## 配布用イメージの作成

1. 上の手順で構築し、GNSS・画面・電源 OFF まで動作確認する
2. `cd ~/mysite && tools/prepare_image.sh` を実行する（ログイン情報・履歴・鍵・Wi-Fi 設定を消して電源が切れる）
3. SD を PC に挿してイメージを吸い出し、[PiShrink](https://github.com/Drewsif/PiShrink) などで縮小する
4. 書き込んだ SD を初めて起動すると、端末ごとに SSH 鍵・Wi-Fi パスワード・ホスト名が作られる。
   SD を PC に挿して `forestryapp-wifi.txt` を読み、本体にラベルを貼って配布する

`forestryapp-wifi.txt` を初回起動の前に自分で書いておく（`SSID=...` / `PASSWORD=...`）と、その値が使われます。
ログインパスワードは初回 SSH ログイン時に変更を求められます。

> 開発に使っている Pi で `prepare_image.sh` を実行しないでください。
| `docs/` | GitHub Pages 用デモ（`python3 tools/build_demo.py` で生成） |

## 実機の更新

Raspberry Pi 上で次を実行します（GitHub アカウント不要）。

```bash
cd ~/mysite && ./update.sh
```

最新のコードを取得し、`system/` の設定に変更があれば `/etc` に反映して、webapp を再起動します。
`/etc/systemd/system` や `/etc/udev/rules.d` の設定を変えたときは、`system/` 側も同じ内容に更新してコミットしてください。

画面を変更したら `python3 tools/build_demo.py` を実行して `docs/` を更新してください。
