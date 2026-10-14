import math
from pyproj import Geod
from BearingCalculation import calculate_bearing
from DifferenceCalculation import calculate_difference

geod = Geod(ellps="WGS84")

# cp緯度 cp経度 ref緯度 ref経度
def tree_planting_coordinates(lot1, lot2, lot3, lot4, height, width, space_height, space_width):
    difference = []  # CPごとに作り直す（共有すると最初のCPの値が使われ続ける）
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

    coordinates = []

    for i in range(width):
        if i % 2 == 0:
            for j in range(height):
                x = i * space_width
                y = j * space_height
                if (x, y) != (0, 0):  # (0,0) を除外
                    coordinates.append((x, y))
        else:
            for j in reversed(range(height)):
                x = i * space_width
                y = j * space_height
                if (x, y) != (0, 0):  # 念のためこっちにも条件をつける
                    coordinates.append((x, y))

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

# ✅ 手入力方位角バージョン（新規追加）
def tree_planting_coordinates_with_azimuth(lat, lon, azimuth_deg, height, width, space_height, space_width):
    coordinates = []

    angle_rad = math.radians(360 - azimuth_deg)
    cos_a = math.cos(angle_rad)
    sin_a = math.sin(angle_rad)

    for i in range(width):
        row = range(height) if i % 2 == 0 else reversed(range(height))
        for j in row:
            x = i * space_width
            y = j * space_height

            # 回転
            dx = x * cos_a - y * sin_a
            dy = x * sin_a + y * cos_a

            azimuth_step = math.degrees(math.atan2(dx, dy)) % 360
            distance = math.hypot(dx, dy)

            lon2, lat2, _ = geod.fwd(lon, lat, azimuth_step, distance)
            coordinates.append((lon2, lat2))

    return coordinates