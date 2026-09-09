import {describe,it,expect} from 'vitest';
// @ts-ignore shared browser model
import {localParts,amsterdamMs,weekendCoffeeTemplate,popularity} from '../web/event-models.js';
// @ts-ignore browser city catalog
import {cityGroups} from '../web/city-picker.js';
import {validateRules} from '../worker/engine';
describe('人气按报名和候补计算',()=>{
 const read=(joined:number,waitlisted:number,maxPeople=8)=>popularity({counts:{joined,waitlisted},rules:{maxPeople}});
 it.each([[0,0,'quiet'],[3,0,'quiet'],[4,0,'steady'],[7,0,'steady'],[8,0,'warm'],[8,3,'warm'],[8,4,'hot']])('人数 %s + %s 的热度是 %s',(j,w,heat)=>expect(read(+j,+w).heat).toBe(heat));
 it('候补超过容量仍完整显示，图形容纳超过200%的数值',()=>{const p=read(8,17);expect(p.people).toBe(25);expect(p.percent).toBe(313);expect(p.scale).toBeGreaterThanOrEqual(p.percent);expect(p.text).toContain('17 人候补');});
 it('旧投影没有counts时按0显示',()=>expect(popularity({rules:{maxPeople:8}}).people).toBe(0));
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
// @ts-ignore shared browser mapping
import {peopleScale} from '../web/event-models.js';
it('非线性人数轴保留全部整数，始终单调且可逆',()=>{let previous=-1;for(let n=3;n<=100;n++){const position=peopleScale(n,0,1);expect(position).toBeGreaterThan(previous);expect(Math.round(peopleScale(position,1,0))).toBe(n);previous=position;}expect(peopleScale(3,0,1)).toBe(0);expect(peopleScale(10,0,1)).toBe(55);expect(peopleScale(100,0,1)).toBe(100);});
