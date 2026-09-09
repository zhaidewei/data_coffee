// 创建表单与地图共用的城市目录；坐标于 2026-09-09 从 PDOK Locatieserver 核对。
const rows=[
 ['Amsterdam','priority',[52.373443,4.904544],['阿姆斯特丹','阿姆']],
 ['Rotterdam','priority',[51.922488,4.486536],['鹿特丹']],
 ['Den Haag','priority',[52.072073,4.293001],['海牙','The Hague',"'s-Gravenhage",'s gravenhage']],
 ['Utrecht','priority',[52.088692,5.095204],['乌特勒支']],
 ['Amstelveen','priority',[52.289266,4.851487],['阿姆斯特尔芬','阿姆斯特芬']],
 ['Delft','second',[51.998457,4.363106],['代尔夫特']],
 ['Eindhoven','second',[51.450162,5.458535],['埃因霍温']],
 ['Enschede','second',[52.220807,6.877788],['恩斯赫德']],
 ['Groningen','second',[53.222229,6.563343],['格罗宁根']],
 ['Heerlen','second',[50.888009,5.978595],[]],
 ['Hoofddorp','second',[52.305304,4.68482],['霍夫多普']],
 ['Leiden','second',[52.154982,4.485116],['莱顿']],
 ['Maastricht','second',[50.852967,5.69953],['马斯特里赫特']],
 ['Nijmegen','second',[51.83482,5.833205],['奈梅亨']],
 ['Tilburg','second',[51.572749,5.045297],['蒂尔堡']],
 ['Wageningen','second',[51.973476,5.66351],['瓦赫宁根']],
 ['Zaandam','second',[52.445412,4.825202],['赞丹','扎安丹','zandam']],
 ['Alkmaar','other',[52.635817,4.751178],[]],
 ['Almere','other',[52.402471,5.205651],[]],
 ['Amersfoort','other',[52.168157,5.389413],[]],
 ['Apeldoorn','other',[52.210836,5.973735],[]],
 ['Arnhem','other',[52.001137,5.892592],[]],
 ['Assen','other',[52.987863,6.549362],[]],
 ['Breda','other',[51.580358,4.755573],[]],
 ['Deventer','other',[52.250107,6.192716],[]],
 ['Dordrecht','other',[51.781507,4.708874],[]],
 ['Gouda','other',[52.015302,4.706204],[]],
 ['Haarlem','other',[52.38242,4.646685],['哈勒姆']],
 ['Hilversum','other',[52.223109,5.168037],[]],
 ['Leeuwarden','other',[53.20066,5.803089],[]],
 ['Lelystad','other',[52.542725,5.374764],[]],
 ['Middelburg','other',[51.502567,3.615897],[]],
 ['Roermond','other',[51.190353,6.010232],[]],
 ["’s-Hertogenbosch",'other',[51.709975,5.295711],["'s-Hertogenbosch",'Den Bosch','登博斯']],
 ['Venlo','other',[51.379052,6.148813],[]],
 ['Zaanstad','other',[52.462909,4.773013],[]],
 ['Zoetermeer','other',[52.06091,4.489774],[]],
 ['Zwolle','other',[52.518686,6.118364],[]]
];

export const normalizeCity=value=>String(value||'').normalize('NFKC').trim().toLocaleLowerCase('nl').replaceAll('’',"'");
export const cityCatalog=Object.freeze(rows.map(([name,group,coordinates,aliases])=>Object.freeze({name,group,coordinates:Object.freeze(coordinates),aliases:Object.freeze(aliases)})));
export const cityCoordinates=Object.freeze(Object.fromEntries(cityCatalog.map(city=>[city.name,city.coordinates])));
const byAlias=new Map(cityCatalog.flatMap(city=>[city.name,...city.aliases].map(value=>[normalizeCity(value),city.name])));
export const canonicalCity=value=>byAlias.get(normalizeCity(value))||null;
