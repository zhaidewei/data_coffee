// 荷兰轮廓来自本地 PDOK / Kadaster BRK 矢量数据；来源与处理方式见 data/README.md。
import {canonicalCity,cityCoordinates} from './city-catalog.js';
const root = new URL('.', import.meta.url);
const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEWBOX = {width:640,height:500,padding:28};
let active;

function geometryPolygons(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates;
  if (geometry?.type === 'GeometryCollection') return geometry.geometries.flatMap(geometryPolygons);
  return [];
}

function geometryPoints(geometry) {
  return geometryPolygons(geometry).flat(2).filter(point=>Array.isArray(point)&&point.length>=2&&point.slice(0,2).every(Number.isFinite));
}

export function outlineProjection(geometry) {
  const points=geometryPoints(geometry);
  if(!points.length)throw new Error('荷兰轮廓为空');
  const lonCenter=points.reduce((sum,p)=>sum+p[0],0)/points.length;
  const latCenter=points.reduce((sum,p)=>sum+p[1],0)/points.length;
  const lonFactor=Math.cos(latCenter*Math.PI/180);
  const xs=points.map(p=>(p[0]-lonCenter)*lonFactor),ys=points.map(p=>latCenter-p[1]);
  const bounds={minX:Math.min(...xs),maxX:Math.max(...xs),minY:Math.min(...ys),maxY:Math.max(...ys)};
  const scale=Math.min((VIEWBOX.width-2*VIEWBOX.padding)/(bounds.maxX-bounds.minX),(VIEWBOX.height-2*VIEWBOX.padding)/(bounds.maxY-bounds.minY));
  const offsetX=(VIEWBOX.width-(bounds.maxX-bounds.minX)*scale)/2;
  const offsetY=(VIEWBOX.height-(bounds.maxY-bounds.minY)*scale)/2;
  return ([lat,lon])=>[offsetX+((lon-lonCenter)*lonFactor-bounds.minX)*scale,offsetY+(latCenter-lat-bounds.minY)*scale];
}

export function outlinePath(geometry,project=outlineProjection(geometry)) {
  return geometryPolygons(geometry).flatMap(polygon=>polygon.map(ring=>ring.map(([lon,lat],index)=>{
    const [x,y]=project([lat,lon]);return `${index?'L':'M'}${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ')+' Z')).join(' ');
}

function svg(name,attributes={}) {
  const node=document.createElementNS(SVG_NS,name);
  for(const [key,value] of Object.entries(attributes))node.setAttribute(key,String(value));
  return node;
}

function locate(city) {
  const coords=cityCoordinates[canonicalCity(city)||city];
  return coords ? {coords} : {error:`${city}：地图暂未收录位置，仍可使用下方城市按钮筛选。`};
}

export function layoutCityLabels(cities) {
  const occupied=[];
  return cities.map(city=>{
    const width=Math.max(92,city.label.length*9+22),height=36;
    const options=[[14,-height/2],[-width-14,-height/2],[14,-height-12],[-width-14,-height-12],[14,12],[-width-14,12]];
    const position=options.find(([x,y])=>{
      const box={x:city.x+x,y:city.y+y,width,height};
      return box.x>=5&&box.y>=5&&box.x+width<=VIEWBOX.width-5&&box.y+height<=VIEWBOX.height-5&&!occupied.some(other=>box.x<other.x+other.width+4&&box.x+width+4>other.x&&box.y<other.y+other.height+4&&box.y+height+4>other.y);
    });
    if(!position)return {...city,box:null};
    const [dx,dy]=position;
    const box={x:city.x+dx,y:city.y+dy,width,height};occupied.push(box);
    return {...city,box};
  });
}

function renderCityLabel(svgRoot,city,selectedCity,onSelect) {
  const selected=selectedCity===city.city;
  const group=svg('g',{class:'city-marker'+(selected?' is-selected':''),tabindex:'0',role:'button','aria-label':`选择 ${city.city}，${city.count} 场活动`,'aria-pressed':selected});
  const edgeX=city.box.x>city.x?city.box.x:city.box.x+city.box.width;
  const text=svg('text',{class:'city-marker-label',x:city.box.x+11,y:city.box.y+23});text.textContent=city.label;
  group.append(svg('line',{class:'city-marker-line',x1:city.x,y1:city.y,x2:edgeX,y2:city.box.y+city.box.height/2}),svg('rect',{class:'city-marker-label-bg',x:city.box.x,y:city.box.y,width:city.box.width,height:city.box.height,rx:6}),text);
  const choose=()=>onSelect(city.city);
  group.addEventListener('click',choose);
  group.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();choose();}});
  svgRoot.append(group);
}

export async function mountMap(container,events,selectedCity,onSelect) {
  active?.dispose();
  const controller=new AbortController();let observer;
  const dispose=()=>{if(controller.signal.aborted)return;controller.abort();observer?.disconnect();};
  active={dispose};
  container.replaceChildren();container.classList.add('real-map');
  const canvas=svg('svg',{class:'real-map-canvas',viewBox:`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`,preserveAspectRatio:'xMidYMid meet',role:'group','aria-label':'荷兰活动城市分布图'});
  const status=document.createElement('p');status.className='real-map-status';status.setAttribute('role','status');status.textContent='正在加载荷兰城市地图…';
  const attribution=document.createElement('p');attribution.className='real-map-attribution';attribution.append('轮廓：',Object.assign(document.createElement('a'),{href:'https://www.pdok.nl/',target:'_blank',rel:'noopener noreferrer',textContent:'PDOK / Kadaster'}),'（',Object.assign(document.createElement('a'),{href:'https://creativecommons.org/licenses/by/4.0/',target:'_blank',rel:'noopener noreferrer',textContent:'CC BY 4.0'}),'） + ',Object.assign(document.createElement('a'),{href:'https://www.naturalearthdata.com/',target:'_blank',rel:'noopener noreferrer',textContent:'Natural Earth'}),'（public domain）');
  const footer=document.createElement('div');footer.className='real-map-footer';footer.append(status,attribution);
  container.append(canvas,footer);
  const issues=new Set();
  const update=()=>{status.textContent=issues.size?[...issues].join(' '):'点击城市筛选活动 · 矢量地图可随屏幕清晰缩放';};
  const alive=()=>!controller.signal.aborted;
  observer=new MutationObserver(()=>{if(!container.isConnected)dispose();});observer.observe(document.body,{childList:true,subtree:true});
  try {
    const waterPromise=fetch(new URL('data/nl-water.geojson',root),{signal:controller.signal}).then(response=>{if(!response.ok)throw new Error('water');return response.json();}).catch(()=>null);
    const response=await fetch(new URL('data/nl-outline.geojson',root),{signal:controller.signal});
    if(!response.ok)throw new Error('outline');
    const data=await response.json(),waterData=await waterPromise,geometry=data.features?.[0]?.geometry||data.geometry||data;
    const project=outlineProjection(geometry);
    canvas.append(svg('path',{class:'city-map-land',d:outlinePath(geometry,project),'fill-rule':'evenodd'}));
    if(waterData){const waterGeometry=waterData.features?.[0]?.geometry||waterData.geometry||waterData;canvas.append(svg('path',{class:'city-map-water',d:outlinePath(waterGeometry,project),'fill-rule':'evenodd'}));}
    else issues.add('水面图层暂不可用；城市位置和筛选仍可使用。');
    const cityNames=[...new Set(events.map(event=>event.city).filter(Boolean))];
    const placed=cityNames.map(city=>{
      const place=locate(city);if(!alive())return null;
      if(place.error){issues.add(place.error);return null;}
      const count=events.filter(event=>event.city===city).reduce((sum,event)=>sum+(event.count??1),0);
      const [x,y]=project(place.coords);return {city,count,x,y,label:`${city} · ${count}`};
    }).filter(Boolean);
    if(!alive())return dispose;
    placed.forEach(city=>canvas.append(svg('circle',{class:'map-city-dot'+(selectedCity===city.city?' is-selected':''),cx:city.x,cy:city.y,r:7,'aria-hidden':'true'})));
    layoutCityLabels(placed.sort((a,b)=>b.y-a.y)).filter(city=>city.box).forEach(city=>renderCityLabel(canvas,city,selectedCity,onSelect));
    update();
  } catch(error) {
    if(alive()){issues.add('地图轮廓加载失败，请使用下方城市按钮筛选活动。');update();}
  }
  return dispose;
}
