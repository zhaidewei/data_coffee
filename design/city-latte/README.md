# 城市咖啡拉花

面向 Data Coffee 页面设计与开发：每座城市一张独立插画，供活动卡片按城市选用。

覆盖荷兰 12 个省会及另外 10 个大学城市；重复城市只保留一款。大学城市是本套选取范围，不表示涵盖所有设有高等教育机构的城市。

打开 `index.html` 浏览全套；`manifest.json` 记录城市、图案主题、R2 图片链接和生成提示词。使用内置 imagegen，以已确认的拉花图为风格参考生成。建筑为风格化表达。

图片存储在 Cloudflare R2 的 `data-coffee-media` 桶，路径为 `city-latte/v1/<城市>.png`。仓库只保留链接与文字文件，本地 PNG 已加入 Git 忽略规则。更新图片时使用新的版本路径，避免长期缓存影响。

范围参考：[CBS 省会城市](https://www.cbs.nl/nl-nl/achtergrond/2003/28/provinciehoofdsteden-op-een-rij)、[Study in NL 研究型大学](https://www.studyinnl.org/dutch-education/research-universities)。

建议仅在日历旁有足够空间时展示。图片属于装饰内容，不承载日期、活动状态或报名信息。
