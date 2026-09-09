import {spawnSync} from 'node:child_process';

const hour=60*60*1000,day=24*hour,now=Date.now();
const users=[
  ['dev-alice','alice@data-coffee.local','爱丽丝',1],
  ['dev-bob','bob@data-coffee.local','小波',1],
  ['dev-chen','chen@data-coffee.local','陈晨',1],
  ['dev-dana','dana@data-coffee.local','Dana',0],
];
const slot=(id,start)=>({id,startsAt:start,endsAt:start+2*hour});
const rules=(slots,overrides={})=>({
  timeSlots:slots,minPeople:3,maxPeople:8,waitlist:true,
  recruitmentDeadline:now+4*day,startsAt:slots[0].startsAt,endsAt:slots[0].endsAt,
  registrationDeadline:now+5*day,promotionDeadline:now+5*day,repairMinutes:120,
  venueRequired:false,minTalks:0,minCohosts:0,minHosts:0,allowRoleOverlap:true,
  continuousVenue:true,continuousTalks:false,continuousCohosts:false,continuousHosts:true,
  addressVisibility:'participants',...overrides,
});
const activity=(id,ownerId,title,city,status,slots,extra={})=>({
  schemaVersion:1,id,ownerId,title,city,tags:city==='Amsterdam'?['AI','职场','求职']:city==='Rotterdam'?['创业','组队']:['荷兰语','融入考试'],description:`本地开发样例：${title}`,
  rules:rules(slots,extra.rules),status,version:extra.version??1,createdAt:now-2*day,
  publishedAt:status==='draft'?undefined:now-day,participants:extra.participants??[],
  applications:extra.applications??[],repairs:[],receipts:[],sequence:extra.sequence??0,
  processed:[],...(extra.selectedSlotId?{selectedSlotId:extra.selectedSlotId}:{}),
});
const openSlots=[slot('ams-1',now+7*day),slot('ams-2',now+14*day)];
const confirmedSlot=slot('rtm-1',now+2*day);
const events=[
  activity('dev-event-amsterdam','dev-alice','Amsterdam 数据咖啡','Amsterdam','recruiting',openSlots,{
    participants:[
      {userId:'dev-chen',status:'joined',appliedAt:now-day,order:1,availableSlotIds:['ams-1','ams-2'],transportPreferences:['public_transport'],registrationMessage:'想聊数据平台。'},
      {userId:'dev-dana',status:'joined',appliedAt:now-day,order:2,availableSlotIds:['ams-2'],transportPreferences:['car'],registrationMessage:'可以分享可观测性经验。'},
    ],sequence:2,
  }),
  activity('dev-event-utrecht','dev-bob','Utrecht 草稿聚会','Utrecht','draft',[slot('utr-1',now+10*day)],{version:0}),
  activity('dev-event-rotterdam','dev-chen','Rotterdam 已成行咖啡','Rotterdam','confirmed',[confirmedSlot],{
    selectedSlotId:'rtm-1',rules:{recruitmentDeadline:now-day,registrationDeadline:now+day,promotionDeadline:now+day},
    participants:['dev-alice','dev-bob','dev-dana'].map((userId,index)=>({userId,status:'joined',appliedAt:now-2*day,order:index+1,availableSlotIds:['rtm-1'],transportPreferences:['public_transport']})),sequence:3,
  }),
];
const quote=value=>`'${String(value).replaceAll("'","''")}'`;
const statements=[
  ...users.map(([id,email,nickname,publicNickname])=>`INSERT INTO users(id,email,nickname,public_nickname) VALUES(${quote(id)},${quote(email)},${quote(nickname)},${publicNickname}) ON CONFLICT(id) DO UPDATE SET email=excluded.email,nickname=excluded.nickname,public_nickname=excluded.public_nickname`),
  ...events.map(event=>`INSERT INTO activities(id,version,document,commit_id,next_due,created_at) VALUES(${quote(event.id)},${event.version},${quote(JSON.stringify(event))},${quote(`seed-${event.id}`)},NULL,${event.createdAt}) ON CONFLICT(id) DO UPDATE SET version=excluded.version,document=excluded.document,commit_id=excluded.commit_id,next_due=NULL,created_at=excluded.created_at`),
].join(';');
const result=spawnSync('npx',['wrangler','d1','execute','DB','--local','--command',statements],{stdio:'inherit',shell:false});
if(result.status!==0)process.exit(result.status??1);
console.log('\n本地样例已创建：alice、bob、chen、dana @data-coffee.local');
console.log('在登录框输入任一邮箱，开发验证码会直接显示。');
