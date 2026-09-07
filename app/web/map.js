// Local Leaflet runtime; geographic data and attribution are documented in data/README.md.
const root = new URL('.', import.meta.url);
const fallback = {Amsterdam:[52.37344,4.90454],Rotterdam:[51.9225,4.47917],Utrecht:[52.09074,5.12142],'Den Haag':[52.0705,4.3007]};
let leafletPromise;
let active;
const locations = new Map();
const normal = value => String(value || '').normalize('NFKC').trim().toLocaleLowerCase('nl');
export function exactCityLocation(city, docs) {
  const aliases = new Set([normal(city)]);
  if (aliases.has('den haag')) aliases.add("'s-gravenhage");
  const matches = docs.filter(d => d.type === 'woonplaats' && aliases.has(normal(d.woonplaatsnaam)));
  const unique = [...new Map(matches.map(d => [d.woonplaatscode || d.id,d])).values()];
  if (unique.length !== 1) return null;
  const point = /^POINT\(\s*([-\d.]+)\s+([-\d.]+)\s*\)$/.exec(unique[0].centroide_ll || '');
  if (!point) return null;
  const latlng = [Number(point[2]),Number(point[1])];
  return latlng.every(Number.isFinite) && latlng[0]>=50 && latlng[0]<=54 && latlng[1]>=3 && latlng[1]<=8 ? latlng : null;
}
function loadLeaflet() {
  if (!leafletPromise) leafletPromise = new Promise((resolve,reject) => {
    const css = document.createElement('link');css.rel='stylesheet';css.href=new URL('vendor/leaflet/leaflet.css',root);document.head.append(css);
    const script=document.createElement('script');script.src=new URL('vendor/leaflet/leaflet.js',root);
    script.onload=()=>resolve(window.L);script.onerror=()=>{leafletPromise=null;script.remove();reject(new Error('地图组件加载失败'));};document.head.append(script);
  });
  return leafletPromise;
}
async function locate(city, signal) {
  if(locations.has(city)) return locations.get(city);
  const url=new URL('https://api.pdok.nl/bzk/locatieserver/search/v3_1/free');
  url.search=new URLSearchParams({q:city,fq:'type:woonplaats',rows:'100'});
  try {
    const response=await fetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(8000)])});
    if(!response.ok) throw new Error('geocoder');
    const data=await response.json();
    const coords=exactCityLocation(city,data.response?.docs||[]);
    // Ambiguous or unmatched names must never be placed by guessing.
    if(coords)locations.set(city,{coords});
    return coords ? {coords} : {error:`${city}：未找到唯一同名荷兰城市，请使用下方城市按钮。`};
  } catch(error) {
    if(signal.aborted)throw error;
    if(fallback[city])return {coords:fallback[city],approximate:true};
    return {error:`${city}：城市定位服务暂不可用，仍可使用下方城市按钮。`};
  }
}
export async function mountMap(container,events,selectedCity,onSelect) {
  active?.dispose();
  const controller=new AbortController();let map;let observer;
  const dispose=()=>{if(controller.signal.aborted)return;controller.abort();observer?.disconnect();map?.remove();map=undefined;};
  active={dispose};
  container.replaceChildren();container.classList.add('real-map');
  const canvas=document.createElement('div');canvas.className='real-map-canvas';canvas.setAttribute('aria-label','荷兰活动地图，可缩放、拖动和选择城市');
  const status=document.createElement('p');status.className='real-map-status';status.setAttribute('role','status');status.textContent='正在加载荷兰地图…';
  container.append(canvas,status);
  const issues=new Set();const update=()=>{status.textContent=issues.size?[...issues].join(' '):'点击城市筛选活动 · 双指拖动或使用 ＋ / − 缩放';};
  const alive=()=>!controller.signal.aborted;
  observer=new MutationObserver(()=>{if(!container.isConnected)dispose();});observer.observe(document.body,{childList:true,subtree:true});
  try {
    const L=await loadLeaflet();if(!alive())return dispose;
    const netherlandsBounds=L.latLngBounds([[50.72,3.25],[53.58,7.25]]);
    map=L.map(canvas,{preferCanvas:true,scrollWheelZoom:false,minZoom:6,maxZoom:17,zoomControl:true,maxBounds:netherlandsBounds.pad(.08),maxBoundsViscosity:1}).setView([52.2,5.35],7);
    map.fitBounds(netherlandsBounds,{padding:[15,15]});
    const zoomLabels=()=>canvas.classList.toggle('map-close-up',map.getZoom()>=10);map.on('zoomend',zoomLabels);zoomLabels();
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,noWrap:true,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).on('tileerror',()=>{issues.add('底图暂不可用；已加载的省界和城市仍可操作。');update();}).addTo(map);
    map.attributionControl.addAttribution('省界与地名：<a href="https://www.pdok.nl/">PDOK / Kadaster</a> · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>');
    const boundaries=fetch(new URL('data/nl-provinces.geojson',root),{signal:controller.signal}).then(r=>{if(!r.ok)throw new Error();return r.json();}).then(data=>{if(!alive())return;L.geoJSON(data,{interactive:false,style:{color:'#49716c',weight:1.4,fillColor:'#b6d3bb',fillOpacity:.09},onEachFeature:(feature,layer)=>{layer.bindTooltip(feature.properties.naam,{className:'province-label',direction:'center',permanent:true});}}).addTo(map);}).catch(()=>{if(alive()){issues.add('省界加载失败，可继续通过城市选择活动。');update();}});
    const cities=[...new Set([...Object.keys(fallback),...events.map(e=>e.city).filter(Boolean)])];
    await Promise.all(cities.map(async city=>{
      const place=await locate(city,controller.signal);if(!alive())return;
      if(place.error){issues.add(place.error);update();return;}
      if(place.approximate)issues.add('定位服务暂不可用，四个常用城市使用预设市中心位置。');
      const count=events.filter(e=>e.city===city).length;
      const label=document.createElement('span');label.className='map-marker-label'+(city==='Den Haag'?' label-west':'');label.textContent=`${city} · ${count}`;
      const marker=L.marker(place.coords,{keyboard:true,title:`${city}，${count} 场活动`,alt:`选择 ${city}`,icon:L.divIcon({className:'activity-city-marker'+(selectedCity===city?' is-selected':''),html:label,iconSize:[18,18],iconAnchor:[9,9]})}).addTo(map);
      marker.on('click',()=>onSelect(city));
      const element=marker.getElement();element?.setAttribute('role','button');element?.setAttribute('aria-pressed',String(selectedCity===city));
      element?.addEventListener('keydown',event=>{if(event.key===' '){event.preventDefault();onSelect(city);}});
    }));
    await boundaries;if(alive()){update();map.invalidateSize({pan:false});map.fitBounds(netherlandsBounds,{padding:[22,22]});}
  } catch(error) {if(alive()){issues.add('地图加载失败，请使用下方城市按钮筛选活动。');update();}}
  return dispose;
}
