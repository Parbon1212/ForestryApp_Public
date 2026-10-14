from pyproj import Geod

def calculate_difference(base_point, bearing, distance):
    # 方位と距離を考慮して新しい座標を計算
    geod = Geod(ellps='WGS84')
    new_longitude, new_latitude, _ = geod.fwd(base_point[1], base_point[0], bearing, distance)

    # 現在地から新しい座標までの差を計算
    difference = (new_latitude - base_point[0], new_longitude - base_point[1])

    return difference