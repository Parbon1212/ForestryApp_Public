import math
from BearingCalculation import calculate_bearing
from DifferenceCalculation import calculate_difference
from pyproj import Geod

geod = Geod(ellps="WGS84")

difference = []
# cp緯度 cp経度 ref緯度 ref経度
def calculate_rectangle_coordinates(lot1, lot2, lot3, lot4, touchline_length, goalline_length):
    for kakudo in [0, 90]:
        difference.append(calculate_difference((lot1, lot2), kakudo, 1))

    bearing = calculate_bearing(lot1, lot2, lot3, lot4)
    print(f"CPと基準点の間の方位角: {bearing} 度")
    angle_n = 360 - bearing
    print(f"{angle_n}度反時計周りに回転します")

    # 回転角度をラジアンに変換
    angle_deg =  angle_n
    angle_rad = angle_deg * math.pi / 180

    # 回転行列を計算
    rotation_matrix = [
        [math.cos(angle_rad), -math.sin(angle_rad)],
        [math.sin(angle_rad), math.cos(angle_rad)]
    ]

    coordinates = [
        (0, (goalline_length/2)),
        ((touchline_length/4), (goalline_length/2)),
        ((touchline_length/2), (goalline_length/2)),
        ((touchline_length/2), 20.16),
        (((touchline_length/2) - 16.5), 20.16),
        (((touchline_length/2) - 5.5), 9.16),
        ((touchline_length/2), 9.16),
        ((touchline_length/2), 0),
        ((touchline_length/2), -9.16),
        (((touchline_length/2) - 5.5), -9.16),
        (((touchline_length/2) - 16.5), -20.16),
        ((touchline_length/2), -20.16),
        ((touchline_length/2),(goalline_length/2)*-1),
        ((touchline_length/4), (goalline_length/2)*-1),
        (0, (goalline_length/2)*-1),
        (((touchline_length/4)*-1), (goalline_length/2)*-1),
        (((touchline_length/2)*-1), ((goalline_length/2)*-1)),
        ((touchline_length/2)*-1, -20.16),
        ((touchline_length/2)*-1 + 16.5, -20.16),
        ((touchline_length/2)*-1 + 5.5, -9.16),
        ((touchline_length/2)*-1, -9.16),
        ((touchline_length/2)*-1, 0),
        ((touchline_length/2)*-1, 9.16),
        ((touchline_length/2)*-1 + 5.5, 9.16),
        ((touchline_length/2)*-1 + 16.5, 20.16),
        ((touchline_length/2)*-1, 20.16),
        (((touchline_length/2)*-1), (goalline_length/2)),
        ((touchline_length/4)*-1, (goalline_length/2))
    ]

    # 四角形の各点を回転させる
    rotated_coordinates = []
    zero_matrix = []
    ninety_matrix = []

    for x, y in coordinates:
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

    result = [(h[0] + lot2, h[1] + lot1) for h in hosei]

    return result

def calculate_rectangle_coordinates_with_azimuth(lat, lon, azimuth_deg, touchline_length, goalline_length):
    # 各点のローカルXY座標（同じものを使う）
    coordinates = [
        (0, (goalline_length/2)),
        ((touchline_length/4), (goalline_length/2)),
        ((touchline_length/2), (goalline_length/2)),
        ((touchline_length/2), 20.16),
        (((touchline_length/2) - 16.5), 20.16),
        (((touchline_length/2) - 5.5), 9.16),
        ((touchline_length/2), 9.16),
        ((touchline_length/2), 0),
        ((touchline_length/2), -9.16),
        (((touchline_length/2) - 5.5), -9.16),
        (((touchline_length/2) - 16.5), -20.16),
        ((touchline_length/2), -20.16),
        ((touchline_length/2), (goalline_length/2)*-1),
        ((touchline_length/4), (goalline_length/2)*-1),
        (0, (goalline_length/2)*-1),
        (((touchline_length/4)*-1), (goalline_length/2)*-1),
        (((touchline_length/2)*-1), ((goalline_length/2)*-1)),
        ((touchline_length/2)*-1, -20.16),
        ((touchline_length/2)*-1 + 16.5, -20.16),
        ((touchline_length/2)*-1 + 5.5, -9.16),
        ((touchline_length/2)*-1, -9.16),
        ((touchline_length/2)*-1, 0),
        ((touchline_length/2)*-1, 9.16),
        ((touchline_length/2)*-1 + 5.5, 9.16),
        ((touchline_length/2)*-1 + 16.5, 20.16),
        ((touchline_length/2)*-1, 20.16),
        (((touchline_length/2)*-1), (goalline_length/2)),
        ((touchline_length/4)*-1, (goalline_length/2))
    ]

    angle_rad = math.radians(360 - azimuth_deg)
    cos_a = math.cos(angle_rad)
    sin_a = math.sin(angle_rad)

    result = []

    for x, y in coordinates:
        # XY回転
        dx = x * cos_a - y * sin_a
        dy = x * sin_a + y * cos_a

        azimuth = math.degrees(math.atan2(dx, dy)) % 360
        distance = math.hypot(dx, dy)

        lon2, lat2, _ = geod.fwd(lon, lat, azimuth, distance)
        result.append((lon2, lat2))

    return result