# 地图数据来源

读者：维护活动总览地图的开发者。

- `nl-outline.geojson`：先合并 PDOK / Kadaster BRK bestuurlijke gebieden 的 `provinciegebied`（12 个省），再与 Natural Earth 5.1.1 的 `ne_10m_admin_0_countries_lakes` 荷兰陆地区域相交，保留 IJsselmeer、Markermeer、Zeeland 水道与 Waddenzee 的水陆分界，最后用 mapshaper 的 `weighted 40% keep-shapes` 简化。WGS84 GeoJSON，缩放时由浏览器按矢量重绘。
- `nl-water.geojson`：Natural Earth 5.1.1 的 `ne_10m_lakes` 与 `ne_10m_lakes_europe` 中荷兰范围内的主要湖面，用于明确显示 IJsselmeer 等内陆水面。
- PDOK 原始数据于 2026-09-07 下载自 https://api.pdok.nl/kadaster/bestuurlijkegebieden/ogc/v1/collections/provinciegebied/items?f=json&limit=100 ，CC BY 4.0。Natural Earth 数据下载自 https://naturalearth.s3.amazonaws.com/10m_cultural/ne_10m_admin_0_countries_lakes.zip 、https://naturalearth.s3.amazonaws.com/10m_physical/ne_10m_lakes.zip 和 https://naturalearth.s3.amazonaws.com/10m_physical/ne_10m_lakes_europe.zip ，public domain。
- 城市位置：`city-catalog.js` 为城市选择器中的全部地点保存 2026-09-09 从 PDOK Locatieserver v3_1 核对的中心坐标。37 个城市使用 `type:woonplaats`，Zaanstad 使用 `type:gemeente`；页面加载时不请求定位服务。自填城市若尚未收录，不放置标记，下方城市按钮仍可筛选。
- 地图只绘制本地荷兰陆地轮廓、主要湖面、城市点和活动数量，不加载道路、河流、地形或在线底图。
