# 地图数据来源

读者：维护活动总览地图的开发者。

- `nl-provinces.geojson`：PDOK / Kadaster BRK bestuurlijke gebieden 的 `provinciegebied`，12 个省，2026-09-07 下载，保留原始 GeoJSON（WGS84 经度、纬度）。来源：https://api.pdok.nl/kadaster/bestuurlijkegebieden/ogc/v1/collections/provinciegebied/items?f=json&limit=100 。该端点重定向至 brk-bestuurlijke-gebieden。CC BY 4.0。
- 城市位置：浏览器查询 PDOK Locatieserver v3_1，限定 `type:woonplaats`，只接受唯一精确名称匹配；Den Haag 显式兼容官方名称 's-Gravenhage。匹配失败不放置标记，城市按钮仍可筛选。网络失败时四个常用城市可用预设市中心坐标。
- 底图：OpenStreetMap 标准瓦片，在线按当前视口请求，无批量预取、离线缓存或隐藏署名。使用受 OpenStreetMap 瓦片服务政策约束。
- `../vendor/leaflet`：Leaflet 1.9.4 的官方 npm 分发文件，BSD-2-Clause，详见随附 LICENSE。
