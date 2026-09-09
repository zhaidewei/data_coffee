import {describe,it,expect} from 'vitest';
// @ts-ignore Dependency-free JavaScript shared by the browser and Worker.
import {localDay,monthRange,eventSlots,matchesTime} from '../web/shared/time-rules.js';
// @ts-ignore Browser overview helpers are dependency-free JavaScript.
import {filterEvents} from '../web/overview.js';
const slot=(id:string,start:string,end:string)=>({id,startsAt:Date.parse(start),endsAt:Date.parse(end)});
const a=slot('a','2026-09-30T22:00:00Z','2026-10-01T01:00:00Z'),b=slot('b','2026-11-10T10:00:00Z','2026-11-10T12:00:00Z');
const event={city:'Amsterdam',rules:{timeSlots:[a,b],startsAt:a.startsAt,endsAt:a.endsAt}};
describe('shared Amsterdam calendar rules',()=>{
 it('uses Amsterdam local dates and month rollover',()=>{expect(localDay(a.startsAt)).toBe('2026-10-01');expect(monthRange('next',Date.parse('2026-12-31T12:00:00Z'))).toEqual({from:'2027-01-01',to:'2027-01-31'});});
 it('matches any candidate and combines city with date',()=>{expect(filterEvents([event],'Amsterdam',{from:'2026-11-01',to:'2026-11-30'})).toHaveLength(1);expect(filterEvents([event],'Utrecht',null)).toHaveLength(0);});
 it('limits confirmed time to selected slot even while recruiting',()=>{const selected={...event,status:'recruiting',selectedSlotId:'a'};expect(eventSlots(selected)).toEqual([a]);expect(filterEvents([selected],'全部',{from:'2026-11-01',to:'2026-11-30'})).toHaveLength(0);});
 it('includes overnight overlap but excludes exact midnight end',()=>{const overnight={city:'Other',rules:{timeSlots:[slot('x','2026-10-24T21:00:00Z','2026-10-25T03:00:00Z')]}};expect(filterEvents([overnight],'Other',{from:'2026-10-25',to:'2026-10-25'})).toHaveLength(1);const ended={city:'Other',rules:{timeSlots:[slot('x','2026-09-30T20:00:00Z','2026-09-30T22:00:00Z')]}};expect(filterEvents([ended],'全部',{from:'2026-10-01',to:'2026-10-01'})).toHaveLength(0);});
 it('supports legacy single time and unplaced cities',()=>{const legacy={city:'Eindhoven',rules:{startsAt:b.startsAt,endsAt:b.endsAt}};expect(filterEvents([legacy],'Eindhoven',null)).toEqual([legacy]);});
 it('keeps Amsterdam day boundaries across both DST changes',()=>{
  expect(localDay(Date.parse('2026-03-28T23:30:00Z'))).toBe('2026-03-29');
  expect(localDay(Date.parse('2026-10-24T22:30:00Z'))).toBe('2026-10-25');
  const spring={rules:{startsAt:Date.parse('2026-03-28T22:00:00Z'),endsAt:Date.parse('2026-03-28T23:00:00Z')}};
  expect(matchesTime(spring,{from:'2026-03-28',to:'2026-03-28'})).toBe(true);
  expect(matchesTime(spring,{from:'2026-03-29',to:'2026-03-29'})).toBe(false);
 });
});
