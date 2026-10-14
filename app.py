from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from pyproj import Geod
import gps
import time
import subprocess
import threading
import os, csv
from datetime import datetime
from flask import send_file

# ==== あなたのフィールド計算用モジュール ====================
from TrackCalculation import track_coordinates, calculate_track_coordinates, calculate_track_coordinates_with_azimuth
from RectangleCalculation import calculate_rectangle_coordinates, calculate_rectangle_coordinates_with_azimuth
from TreePlanting import tree_planting_coordinates, tree_planting_coordinates_with_azimuth
from CustomRectangle import custom_rectangle_coordinates, custom_rectangle_coordinates_with_azimuth

# ==== GNSS セッション管理 ===================================
_gps_session = None
_last_known_position = None

_lock = threading.Lock()

def get_gps_session():
    """
    gpsd セッションを (必要なら) 作って返す
    """
    global _gps_session
    if _gps_session is None:
        try:
            _gps_session = gps.gps(
                mode=gps.WATCH_ENABLE | gps.WATCH_JSON,
                host="localhost", port="2947"
            )
        except Exception as e:
            print(f"GPSD接続エラー: {e}")
            _gps_session = None
    return _gps_session


def get_field(report, name):
    if isinstance(report, dict):
        return report.get(name)
    return getattr(report, name, None)


# ==== gpsd を常時購読して最後の値を更新するワーカー ==========
def gps_worker():
    global _gps_session, _last_known_position

    while True:
        try:
            s = get_gps_session()
            if s is None:
                time.sleep(1.0)
                continue

            # waiting がある環境ではなるべく使って無駄な next() を減らす
            if hasattr(s, "waiting"):
                if not s.waiting(timeout=1.0):
                    continue

            r = s.next()
            cls = get_field(r, 'class') or (r.get('class') if isinstance(r, dict) else None)
            if not cls:
                continue

            with _lock:
                base = _last_known_position or {}

                # ---- TPV: 位置・精度・Fix情報 ----
                if cls == 'TPV':
                    lat = get_field(r, 'lat')
                    lon = get_field(r, 'lon')

                    if lat is not None and lon is not None:
                        base['lat'] = lat
                        base['lon'] = lon
                        base['ts'] = time.time()  # ★サーバ側更新時刻

                        # statusなどはTPVレポートに含まれない回があるため、
                        # 値が取れた時だけ更新し、無ければ前回値を保持する
                        # (でないと位置は更新され続けるのに品質だけnullに戻ってしまう)
                        # gpsdのSTATUS enum(0=UNK,1=GPS,2=DGPS,3=RTK_FIX,4=RTK_FLT,...)
                        # ※NMEA $GxGGAのFix品質コードとは数値の意味が異なる
                        for key, val in (
                            ('mode', get_field(r, 'mode')),
                            ('status', get_field(r, 'status')),
                            ('alt', get_field(r, 'alt')),
                            ('speed', get_field(r, 'speed')),
                            ('epx', get_field(r, 'epx')),
                            ('epy', get_field(r, 'epy')),
                            ('epv', get_field(r, 'epv')),
                            ('gps_time', get_field(r, 'time')),
                            ('gga_fix_quality', get_field(r, 'status')),
                        ):
                            if val is not None:
                                base[key] = val

                # ---- SKY: 衛星情報 ----
                elif cls == 'SKY':
                    sats_used = get_field(r, 'uSat')
                    if sats_used is None:
                        sats_list = get_field(r, 'satellites') or []
                        if isinstance(sats_list, list):
                            sats_used = sum(
                                1 for s_ in sats_list
                                if isinstance(s_, dict) and s_.get('used')
                            )
                    if sats_used is not None:
                        base['sats'] = sats_used

                # ---- DOP: HDOPなど ----
                elif cls == 'DOP':
                    hdop = get_field(r, 'hdop')
                    if hdop is not None:
                        base['hdop'] = hdop

                _last_known_position = base

        except Exception:
            # 一時的な切断/例外はセッションを捨てて再試行
            _gps_session = None
            time.sleep(0.2)


# ==== Flask 設定 =============================================
app = Flask(__name__, static_url_path='', static_folder='static')
geod = Geod(ellps="WGS84")
CORS(app, resources={r"/*": {"origins": "*"}})

# ワーカー起動（Flask起動時にGPS購読を始める）
threading.Thread(target=gps_worker, daemon=True).start()

# ==== data download =============================================
ARRIVAL_CSV = "/home/ae24iwamoto/ae24iwamoto/mysite/data/arrivals.csv"

ARRIVAL_HEADER = [
    "timestamp_iso",
    "event",
    "point_index",
    "current_lat","current_lon","alt",
    "target_lat","target_lon",
    "mode","status",
]

def _write_arrival_header():
    with open(ARRIVAL_CSV, "w", newline="", encoding="utf-8") as f:
        csv.writer(f).writerow(ARRIVAL_HEADER)

def _ensure_arrival_csv():
    os.makedirs(os.path.dirname(ARRIVAL_CSV), exist_ok=True)
    if os.path.exists(ARRIVAL_CSV):
        with open(ARRIVAL_CSV, newline="", encoding="utf-8") as f:
            header = next(csv.reader(f), None)
        if header == ARRIVAL_HEADER:
            return
        # 列構成が古いファイルは列ずれを防ぐため退避して作り直す
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        os.rename(ARRIVAL_CSV, ARRIVAL_CSV.replace(".csv", f"_old_{stamp}.csv"))
    _write_arrival_header()

@app.route("/arrivals", methods=["POST"])
def add_arrival():
    global _last_known_position
    _ensure_arrival_csv()
    data = request.get_json(silent=True) or {}

    # フロント送信を優先。無ければ最後の受信値で補完
    src = {}
    if isinstance(_last_known_position, dict):
        src.update(_last_known_position)
    src.update(data)

    lat = src.get("current_lat", src.get("lat"))
    lon = src.get("current_lon", src.get("lon"))
    if lat is None or lon is None:
        return jsonify({"error": "no position"}), 400

    ts = datetime.now().isoformat(timespec="seconds")
    event = src.get("event", "arrived")
    with open(ARRIVAL_CSV, "a", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow([
            ts,
            event,
            src.get("point_index"),
            lat, lon, src.get("alt"),
            src.get("target_lat"), src.get("target_lon"),
            src.get("mode"), src.get("status"),
        ])
    return jsonify({"message": "saved", "timestamp": ts})

@app.route("/arrivals.csv", methods=["GET"])
def download_arrivals_csv():
    _ensure_arrival_csv()
    try:
        # Flask 2.x 系
        return send_file(
            ARRIVAL_CSV,
            mimetype="text/csv",
            as_attachment=True,
            download_name="arrivals.csv"
        )
    except TypeError:
        # Flask 1.x 系
        return send_file(
            ARRIVAL_CSV,
            mimetype="text/csv",
            as_attachment=True,
            attachment_filename="arrivals.csv"
        )


@app.route("/arrivals/clear", methods=["POST"])
def clear_arrivals():
    _ensure_arrival_csv()
    _write_arrival_header()
    return jsonify({"message": "cleared"})



# ==== ルーティング ===========================================

@app.route('/')
def serve_index():
    return render_template('SoccerCalculation.html')

# ---- システムシャットダウン API ----
@app.route('/shutdown', methods=['POST'])
def shutdown():
    try:
        subprocess.run(['sudo', 'poweroff'], check=True)
        return jsonify({'message': 'シャットダウンを開始します。緑のランプが消えたらケーブルを抜いてください。'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ---- GNSS 位置情報 API (/location) ----
@app.route('/location')
def location():
    global _last_known_position

    with _lock:
        if _last_known_position is None:
            return jsonify({'lat': None, 'lon': None})

        data = dict(_last_known_position)

    # 未取得項目は None を明示
    data.setdefault('mode', None)
    data.setdefault('status', None)
    data.setdefault('alt', None)
    data.setdefault('speed', None)
    data.setdefault('epx', None)
    data.setdefault('epy', None)
    data.setdefault('epv', None)
    data.setdefault('sats', None)
    data.setdefault('hdop', None)
    data.setdefault('gga_fix_quality', None)
    data.setdefault('ts', None)
    data.setdefault('gps_time', None)

    return jsonify(data)


# ---- 距離・方位角計算 API ----
@app.route('/calculate_distance_azimuth', methods=['POST'])
def calculate_distance_azimuth():
    data = request.get_json(silent=True) or {}

    try:
        current_lat = float(data.get('current_lat'))
        current_lon = float(data.get('current_lon'))
        target_lat  = float(data.get('target_lat'))
        target_lon  = float(data.get('target_lon'))
    except (TypeError, ValueError):
        return jsonify({'error': 'invalid coords'}), 400

    az12, _, dist = geod.inv(current_lon, current_lat, target_lon, target_lat)

    return jsonify({
        'distance': dist,
        'azimuth': az12
    })


# ---- あなたのフィールド計算 (/calculate) --------------------
@app.route('/calculate', methods=['POST'])
def calculate():
    data = request.get_json(silent=True) or {}

    try:
        shape = data.get('shape')
        cp_lat = float(data.get('cp_lat'))
        cp_lon = float(data.get('cp_lon'))
        azimuth_mode = data.get('azimuth_mode')

        # 方位角の計算
        if azimuth_mode == 'ref':
            ref_lat = float(data.get('ref_lat'))
            ref_lon = float(data.get('ref_lon'))
            azimuth, _, _ = geod.inv(cp_lon, cp_lat, ref_lon, ref_lat)
        elif azimuth_mode == 'manual':
            azimuth = float(data.get('manual_azimuth'))
            ref_lat, ref_lon = 0.0, 0.0
        else:
            return jsonify({'error': '無効な方位角指定方法'}), 400

        # ---- shape 別処理 ----
        if shape == 'track':
            straight_length = float(data.get('straight_length'))
            radius = float(data.get('radius'))
            coordinates = track_coordinates(straight_length, radius)
            result = (
                calculate_track_coordinates(cp_lat, cp_lon, coordinates, ref_lat, ref_lon)
                if azimuth_mode == 'ref'
                else calculate_track_coordinates_with_azimuth(cp_lat, cp_lon, coordinates, azimuth)
            )

        elif shape == 'rectangle':
            touchline = float(data.get('touchline'))
            goalline = float(data.get('goalline'))
            result = (
                calculate_rectangle_coordinates(cp_lat, cp_lon, ref_lat, ref_lon, touchline, goalline)
                if azimuth_mode == 'ref'
                else calculate_rectangle_coordinates_with_azimuth(cp_lat, cp_lon, azimuth, touchline, goalline)
            )

        elif shape == 'tree':
            tree_space_height = float(data.get('tree_space_height'))
            tree_space_width = float(data.get('tree_space_width'))
            tree_height = int(data.get('tree_height'))
            tree_width = int(data.get('tree_width'))
            result = (
                tree_planting_coordinates(cp_lat, cp_lon, ref_lat, ref_lon, tree_height, tree_width, tree_space_height, tree_space_width)
                if azimuth_mode == 'ref'
                else tree_planting_coordinates_with_azimuth(cp_lat, cp_lon, azimuth, tree_height, tree_width, tree_space_height, tree_space_width)
            )

        elif shape == 'custom_rect':
            vertical_length = float(data.get('vertical_length'))
            horizontal_length = float(data.get('horizontal_length'))
            result = (
                custom_rectangle_coordinates(cp_lat, cp_lon, ref_lat, ref_lon, vertical_length, horizontal_length)
                if azimuth_mode == 'ref'
                else custom_rectangle_coordinates_with_azimuth(cp_lat, cp_lon, azimuth, vertical_length, horizontal_length)
            )

        else:
            return jsonify({'error': '無効な形状選択です'}), 400

        return jsonify({'result': result})

    except Exception as e:
        print(f"Calculation Error: {e}")
        return jsonify({'error': f'入力に問題があります: {e}'}), 400


# ---- ラズパイ CPU 温度 API ----
@app.route('/gnss-status')
def gnss_status():
    global _gps_session, _last_known_position
    with _lock:
        session_alive = _gps_session is not None
        last_ts = (_last_known_position or {}).get('ts')
    data_age = (time.time() - last_ts) if last_ts else None
    device_present = os.path.exists('/dev/gnss')
    # データが5秒以上古い、またはデバイスが存在しない場合は切断とみなす
    connected = session_alive and device_present and (data_age is not None and data_age < 5)
    return jsonify({
        'connected': connected,
        'device_present': device_present,
        'data_age_s': round(data_age, 1) if data_age is not None else None,
    })


@app.route('/power-status')
def power_status():
    try:
        volt_out = subprocess.check_output(['vcgencmd', 'measure_volts'], text=True, timeout=1).strip()
        volt = float(volt_out.split('=')[1].replace('V','')) if '=' in volt_out else None
    except Exception:
        volt = None
    try:
        thr_out = subprocess.check_output(['vcgencmd', 'get_throttled'], text=True, timeout=1).strip()
        thr_hex = int(thr_out.split('=')[1], 16) if '=' in thr_out else 0
    except Exception:
        thr_hex = 0

    # ビット解析
    under_voltage_now  = bool(thr_hex & 0x1)
    throttled_now      = bool(thr_hex & 0x4)
    under_voltage_past = bool(thr_hex & 0x10000)
    throttled_past     = bool(thr_hex & 0x40000)

    device_present = os.path.exists('/dev/gnss')

    return jsonify({
        'voltage': volt,
        'throttled_hex': hex(thr_hex),
        'under_voltage_now': under_voltage_now,
        'throttled_now': throttled_now,
        'under_voltage_past': under_voltage_past,
        'throttled_past': throttled_past,
        'device_present': device_present,
    })


@app.route('/temperature')
def cpu_temperature():
    try:
        with open('/sys/class/thermal/thermal_zone0/temp') as f:
            temp_c = int(f.read().strip()) / 1000.0
        return jsonify({'temp_c': temp_c})
    except Exception as e:
        return jsonify({'temp_c': None, 'error': str(e)}), 500

# ============================================================

if __name__ == '__main__':
    app.run(
        host='0.0.0.0',
        port=5000,
        debug=False,
        use_reloader=False,
        threaded=True,
        ssl_context='adhoc'
    )
