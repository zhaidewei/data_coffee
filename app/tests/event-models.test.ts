import {describe,it,expect} from 'vitest';
// @ts-ignore shared browser model
import {localParts,amsterdamMs,weekendCoffeeTemplate,popularity,participationSummary,overviewAction,overviewTiming} from '../web/event-models.js';
// @ts-ignore browser city catalog
import {cityCatalog,cityCoordinates,canonicalCity} from '../web/city-catalog.js';
// @ts-ignore browser city picker
import {cityGroups} from '../web/city-picker.js';
// @ts-ignore browser map geometry helpers
import {layoutCityLabels,outlinePath,outlineProjection} from '../web/map.js';
import {validateRules} from '../worker/engine';
describe('人气按报名和候补计算',()=>{
 const read=(joined:number,waitlisted:number,maxPeople=8)=>popularity({counts:{joined,waitlisted},rules:{maxPeople}});
 it.each([[0,0,'quiet'],[3,0,'quiet'],[4,0,'steady'],[7,0,'steady'],[8,0,'warm'],[8,3,'warm'],[8,4,'hot']])('人数 %s + %s 的热度是 %s',(j,w,heat)=>expect(read(+j,+w).heat).toBe(heat));
 it('候补超过容量仍完整显示，图形容纳超过200%的数值',()=>{const p=read(8,17);expect(p.people).toBe(25);expect(p.percent).toBe(313);expect(p.scale).toBeGreaterThanOrEqual(p.percent);expect(p.text).toContain('17 人候补');});
 it('旧投影没有counts时按0显示',()=>expect(popularity({rules:{maxPeople:8}}).people).toBe(0));
});
describe('活动卡片把决定参与的信息压缩成一份',()=>{
 it('最终时间未定时不从总报名数推断成行差额',()=>{
  expect(participationSummary({counts:{joined:2,waitlisted:0},rules:{minPeople:4,maxPeople:8,timeSlots:[{}]}})).toMatchObject({headline:'2 人已报名 · 最终时段需 4 人可参加',needed:null,limit:'最多 8 人'});
  expect(participationSummary({selectedSlotId:'final',counts:{joined:2,waitlisted:0},rules:{minPeople:4,maxPeople:8,timeSlots:[{}]}}).headline).toBe('2 人已报名 · 还差 2 人成行');
  expect(participationSummary({counts:{joined:8,waitlisted:3},rules:{minPeople:4,maxPeople:8}}).headline).toBe('8 人已报名 · 3 人候补');
 });
 it('下一步只在确实仍可报名时发出报名邀请',()=>{
  const rules={startsAt:5000,registrationDeadline:3000,promotionDeadline:4000,minPeople:4,maxPeople:8,waitlist:true};
  expect(overviewAction({status:'recruiting',counts:{joined:2},rules},2000)).toBe('查看并报名');
  expect(overviewAction({status:'recruiting',counts:{joined:8},rules},4500)).toBe('查看活动');
  expect(overviewAction({status:'completed',counts:{joined:8},rules},2000)).toBe('查看结果');
  expect(overviewAction({status:'cancelled',counts:{joined:2},rules},2000)).toBe('查看活动');
  expect(overviewAction({status:'draft',counts:{joined:0},rules},2000)).toBe('查看草稿');
 });
 it('同一节奏的候选日期合并显示，跨节奏时不制造共同时间',()=>{
  const slot=(day:number,hour=13)=>({startsAt:amsterdamMs(`2026-09-${day}T${hour}:00`),endsAt:amsterdamMs(`2026-09-${day}T${hour+2}:30`)});
 expect(overviewTiming([slot(13),slot(20),slot(27)])).toEqual({dates:'9月13、20、27日',rhythm:'周日 · 13:00–15:30'});
  expect(overviewTiming([slot(13),slot(20),slot(27)],true)).toEqual({dates:'时间待定',rhythm:'候选：9月13、20、27日 · 最终选 1 场 · 周日 · 13:00–15:30'});
  expect(overviewTiming([slot(13),slot(20,14)])).toEqual({dates:'9月13、20日',rhythm:'2 个候选时段'});
  expect(overviewTiming([slot(13),slot(20,14)],true)).toEqual({dates:'时间待定',rhythm:'候选：9月13、20日 · 最终选 1 场'});
  expect(overviewTiming([{startsAt:amsterdamMs('2026-12-27T13:00'),endsAt:amsterdamMs('2026-12-27T15:30')},{startsAt:amsterdamMs('2027-01-03T13:00'),endsAt:amsterdamMs('2027-01-03T15:30')}]).dates).toBe('2026年12月27日、2027年1月3日');
 });
});
describe('周末模板的荷兰当地日期和业务有效性',()=>{
 it.each(['2026-09-08T19:00:00Z','2026-10-13T10:00:00Z','2026-03-17T10:00:00Z','2026-12-24T10:00:00Z','2026-09-11T11:01:00Z'])('跨周、跨年或夏令时 %s',iso=>{
  const now=Date.parse(iso),r=weekendCoffeeTemplate(now);expect(r.timeSlots).toHaveLength(8);expect(new Set(r.timeSlots.map((s:any)=>s.id)).size).toBe(8);
  for(const s of r.timeSlots){expect(s.startsAt).toBeGreaterThan(now);expect(localParts(s.startsAt).slice(11)).toBe('14:00');expect(localParts(s.endsAt).slice(11)).toBe('17:00');expect([0,6]).toContain(new Date(localParts(s.startsAt).slice(0,10)+'T12:00Z').getUTCDay());expect(s.endsAt-s.startsAt).toBe(10800000);}
  expect(()=>validateRules({...r,minTalks:0,minCohosts:0,allowRoleOverlap:true,continuousTalks:false,continuousCohosts:false,addressVisibility:'public'},now)).not.toThrow();
 });
 it('夏令时不存在的时刻拒绝；重复时刻可选早晚',()=>{expect(()=>amsterdamMs('2026-03-29T02:30')).toThrow();expect(amsterdamMs('2026-10-25T02:30','late')-amsterdamMs('2026-10-25T02:30')).toBe(3600000);});
});
it('城市优先级稳定，新增城市去重并按字母排序',()=>{const g=cityGroups(['zz City','Amsterdam','Almere','aa City']);expect(g[0][1]).toEqual(['Amsterdam','Rotterdam','Den Haag','Utrecht','Amstelveen']);expect(g[1][1]).toContain('Hoofddorp');expect(g[1][1]).toContain('Zaandam');expect(g[2][1]).not.toContain('Amsterdam');expect(g[2][1].filter((x:string)=>x==='Almere')).toHaveLength(1);expect(g[2][1]).toEqual([...g[2][1]].sort((a:string,b:string)=>a.localeCompare(b,'nl')));});
describe('城市矢量地图',()=>{
 it('城市选择器的全部地点都有本地荷兰坐标',()=>{
  const catalog=cityGroups().flatMap((group:any)=>group[1] as string[]),located=Object.keys(cityCoordinates);
  expect(new Set(located)).toEqual(new Set(catalog));
  for(const city of catalog){const [lat,lon]=cityCoordinates[city];expect(lat,city).toBeGreaterThanOrEqual(50);expect(lat,city).toBeLessThanOrEqual(54);expect(lon,city).toBeGreaterThanOrEqual(3);expect(lon,city).toBeLessThanOrEqual(8);}
 });
 it('别名统一为目录名称，Zaanstad 与 Zaandam 保持独立',()=>{
  expect(cityCatalog).toHaveLength(38);
  expect(['The Hague',"'s-Gravenhage",'s gravenhage','海牙'].map(canonicalCity)).toEqual(Array(4).fill('Den Haag'));
  expect(['Den Bosch',"'s-Hertogenbosch",'’s-Hertogenbosch','登博斯'].map(canonicalCity)).toEqual(Array(4).fill('’s-Hertogenbosch'));
  expect(canonicalCity('Zaanstad')).toBe('Zaanstad');expect(canonicalCity('Zaandam')).toBe('Zaandam');expect(canonicalCity('未知城市')).toBeNull();
 });
 it('把多块陆地投影到固定高清 SVG 画布',()=>{
  const geometry={type:'GeometryCollection',geometries:[{type:'MultiPolygon',coordinates:[[[[3,51],[7,51],[7,54],[3,54],[3,51]]]]}]};
  const project=outlineProjection(geometry),path=outlinePath(geometry,project),corners=[[51,3],[54,7]].map(point=>project(point)) as number[][];
  expect(path).toMatch(/^M/);expect(path).toContain(' Z');
  for(const [x,y] of corners){expect(x).toBeGreaterThanOrEqual(28);expect(x).toBeLessThanOrEqual(612);expect(y).toBeGreaterThanOrEqual(28);expect(y).toBeLessThanOrEqual(472);}
 });
 it('密集城市只保留不重叠的标签，其余位置点仍可显示',()=>{
  const cities=Array.from({length:36},(_,index)=>({city:`城市${index}`,label:`城市${index} · 1`,count:1,x:300+(index%6),y:240+Math.floor(index/6)}));
  const shown=layoutCityLabels(cities).map((city:any)=>city.box).filter(Boolean) as {x:number,y:number,width:number,height:number}[];
  expect(shown.length).toBeGreaterThan(0);expect(shown.length).toBeLessThan(cities.length);
  for(let i=0;i<shown.length;i++)for(let j=i+1;j<shown.length;j++)expect(shown[i].x<shown[j].x+shown[j].width+4&&shown[i].x+shown[i].width+4>shown[j].x&&shown[i].y<shown[j].y+shown[j].height+4&&shown[i].y+shown[i].height+4>shown[j].y).toBe(false);
 });
});
// @ts-ignore shared browser mapping
import {peopleScale} from '../web/event-models.js';
it('非线性人数轴保留全部整数，始终单调且可逆',()=>{let previous=-1;for(let n=3;n<=100;n++){const position=peopleScale(n,0,1);expect(position).toBeGreaterThan(previous);expect(Math.round(peopleScale(position,1,0))).toBe(n);previous=position;}expect(peopleScale(3,0,1)).toBe(0);expect(peopleScale(10,0,1)).toBe(55);expect(peopleScale(100,0,1)).toBe(100);});
