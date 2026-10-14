import math

def calculate_bearing(lat1, lon1, lat2, lon2):
    # 緯度経度をラジアンに変換
    lat1 = math.radians(lat1)
    lon1 = math.radians(lon1)
    lat2 = math.radians(lat2)
    lon2 = math.radians(lon2)
    
    # 経度の差を求める
    delta_lon = lon2 - lon1
    
    # 方位角の計算
    y = math.sin(delta_lon) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(delta_lon)
    initial_bearing = math.atan2(y, x)
    
    # 角度を度に変換して0から360度の範囲にする
    initial_bearing = math.degrees(initial_bearing)
    compass_bearing = (initial_bearing + 360) % 360
    
    return compass_bearing