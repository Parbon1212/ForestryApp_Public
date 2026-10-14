# CustomRectangle.py
import math
from pyproj import Geod
from BearingCalculation import calculate_bearing
from DifferenceCalculation import calculate_difference

geod = Geod(ellps="WGS84")

# cp緯度 cp経度 ref緯度 ref経度
def custom_rectangle_coordinates(lot1, lot2, lot3, lot4, vertical_length, horizontal_length):
    """
    参照点を使って方位を決める長方形。
    縦＝CP→参照点の方位方向に vertical_length、
    横＝その右手90度方向に horizontal_length。
    返り値は (lon, lat) の配列で、CPを起点に時計回りに 4 点。
    """
    # ★ 0°/90° 方向の「1m あたりの差分」を取得（tree_planting_* と同じ使い方）
    difference = []
    for kakudo in [0, 90]:
        difference.append(calculate_difference((lot1, lot2), kakudo, 1))
        # difference[n] は (lat_per_m, lon_per_m) を想定

    # 方位（CP→参照点）
    bearing = calculate_bearing(lot1, lot2, lot3, lot4)
    angle_n = 360 - bearing  # 反時計回り回転
    angle_rad = math.radians(angle_n)

    # 回転行列
    cos_a = math.cos(angle_rad)
    sin_a = math.sin(angle_rad)

    # ローカル座標（m）: CP を (0,0)、+Y が「縦」、+X が「横」
    # 時計回りに (0,0)→(0,V)→(H,V)→(H,0)
    local_points = [
        (0.0, 0.0),
        (0.0, vertical_length),
        (horizontal_length, vertical_length),
        (horizontal_length, 0.0),
    ]

    result = []

    # それぞれ回転→緯度経度差分に変換→CPへ加算
    for x, y in local_points:
        # 回転（tree_planting_* と同じ式）
        new_x = x * cos_a - y * sin_a
        new_y = x * sin_a + y * cos_a

        # 0° 成分（new_y）と 90° 成分（new_x）に分解して差分へ
        # ※ tree_planting_* の流儀に合わせ、0°の経度寄与は 0 として扱います
        zero_x = 0.0
        zero_y = new_y * difference[0][0]      # lat への寄与

        ninety_x = new_x * difference[1][1]    # lon への寄与
        ninety_y = new_x * difference[1][0]    # lat への寄与

        dlon = zero_x + ninety_x
        dlat = zero_y + ninety_y

        # CP に差分を足して最終座標へ
        lon = lot2 + dlon
        lat = lot1 + dlat
        result.append((lon, lat))

    return result


# ✅ 手入力方位角バージョン（tree_planting_coordinates_with_azimuth と同じ構成）
def custom_rectangle_coordinates_with_azimuth(lat, lon, azimuth_deg, vertical_length, horizontal_length):
    """
    手入力した方位角で縦方向を決める長方形。
    縦＝azimuth_deg 方向に vertical_length、
    横＝その右手90度方向に horizontal_length。
    返り値は (lon, lat) の配列で、CPを起点に時計回りに 4 点。
    """
    az_v = (azimuth_deg + 360.0) % 360.0        # 縦
    az_h = (az_v + 90.0) % 360.0                # 横

    # CP
    lon0, lat0 = lon, lat
    # 縦側
    lon1, lat1, _ = geod.fwd(lon0, lat0, az_v, vertical_length)
    # 対角（縦→横）
    lon2, lat2, _ = geod.fwd(lon1, lat1, az_h, horizontal_length)
    # 横側（CP→横）
    lon3, lat3, _ = geod.fwd(lon0, lat0, az_h, horizontal_length)

    return [(lon0, lat0), (lon1, lat1), (lon2, lat2), (lon3, lat3)]
