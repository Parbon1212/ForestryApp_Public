import math
from BearingCalculation import calculate_bearing
from DifferenceCalculation import calculate_difference
from pyproj import Geod

geod = Geod(ellps="WGS84")

def track_coordinates(straight_length, radius):
    coordinates = []

    # ハーフラインの座標
    coordinates.append((0, radius)) #ハーフライン上

    # 直線部分の座標
    coordinates.append((straight_length/2, radius)) #A

    # 右曲走路の座標 (角度80から-80まで10度ずつ減少)
    for theta in range(80, -81, -10):
        x = radius * (math.cos(math.radians(theta))) + straight_length/2
        # print(theta)
        y = radius * (math.sin(math.radians(theta)))
        coordinates.append((x, y))

    coordinates.append((straight_length/2, -radius)) #B
    coordinates.append((0, -radius)) #ハーフライン下
    coordinates.append((-straight_length/2, -radius)) #C

    # 左曲走路の座標 (角度80から-80まで10度ずつ減少)
    for theta in range(80, -81, -10):
        x = radius * (-math.cos(math.radians(theta))) - straight_length/2
        # print(theta)
        y = radius * (-math.sin(math.radians(theta)))
        coordinates.append((x, y))

    coordinates.append((-straight_length/2, radius)) #D

    return coordinates

def calculate_track_coordinates(cp_lat, cp_lon, track_coordinates, reference_lat, reference_lon):
    difference = []  # CPごとに作り直す（共有すると最初のCPの値が使われ続ける）
    for kakudo in [0, 90]:
        difference.append(calculate_difference((cp_lat, cp_lon), kakudo, 1))

    bearing = calculate_bearing(cp_lat, cp_lon, reference_lat, reference_lon)
    print(f"CPと基準点の間の方位角: {bearing} 度")
    angle_n = 360 - bearing
    print(f"{angle_n}度反時計周りに回転します")

    # 回転角度をラジアンに変換
    angle_deg = angle_n
    angle_rad = angle_deg * math.pi / 180

    # 回転行列の定義
    rotation_matrix = [
        [math.cos(angle_rad), -math.sin(angle_rad)],
        [math.sin(angle_rad), math.cos(angle_rad)]
    ]

    # 四角形の各点を回転させる
    rotated_coordinates = []
    zero_matrix = []
    ninety_matrix = []

    for x, y in track_coordinates:
        # 中心を原点に移動
        x -= 0
        y -= 0

        new_x = x * rotation_matrix[0][0] + y * rotation_matrix[0][1]
        new_y = x * rotation_matrix[1][0] + y * rotation_matrix[1][1]


        zero_x = new_x * 0
        zero_y = new_y * difference[0][0]

        ninety_x = new_x * difference[1][1]
        ninety_y = new_x * difference[1][0]  #new_y or new_x

        # 再び中心を戻す
        new_x += 0
        new_y += 0

        zero_x += 0
        zero_y += 0

        ninety_x += 0
        ninety_y += 0


        rotated_coordinates.append((new_x, new_y))
        zero_matrix.append((zero_x, zero_y))
        ninety_matrix.append((ninety_x, ninety_y))



    hosei = [(zero[0] + ninety[0], zero[1] + ninety[1]) for zero, ninety in zip(zero_matrix, ninety_matrix)]

    #print("4点の座標")
    result = [(h[0] + cp_lon, h[1] + cp_lat) for h in hosei]

    return result

def calculate_track_coordinates_with_azimuth(cp_lat, cp_lon, track_coordinates, azimuth_deg):
    # 回転角度をラジアンに変換
    angle_rad = math.radians(360 - azimuth_deg)
    cos_a = math.cos(angle_rad)
    sin_a = math.sin(angle_rad)

    result = []

    for x, y in track_coordinates:
        # 方位角に基づいてローカルXYを回転
        dx = x * cos_a - y * sin_a
        dy = x * sin_a + y * cos_a

        # dx, dy を距離＋方位に変換して前進
        azimuth = math.degrees(math.atan2(dx, dy)) % 360
        distance = math.hypot(dx, dy)

        lon2, lat2, _ = geod.fwd(cp_lon, cp_lat, azimuth, distance)
        result.append((lon2, lat2))

    return result