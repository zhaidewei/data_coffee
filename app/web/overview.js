import {matchesTime} from './shared/time-rules.js';

export function filterEvents(events,city,range){return events.filter(e=>(city==='全部'||e.city===city)&&matchesTime(e,range));}

export function overviewQuery(state,range){const params=new URLSearchParams({page:String(state.page),pageSize:'12'});if(state.city!=='全部')params.set('city',state.city);if(state.selectedTag)params.set('tag',state.selectedTag);if(range){params.set('from',range.from);params.set('to',range.to);}return params.toString();}
