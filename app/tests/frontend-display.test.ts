import {afterEach,expect,it,vi} from 'vitest';
import {countdown,deadlineLabel,eventTimePhase} from '../web/ui/display.js';

afterEach(()=>vi.useRealTimers());
it('截止边界同时更新倒计时与详情轮询阶段',()=>{
 vi.useFakeTimers();vi.setSystemTime(1000);
 const event={rules:{recruitmentDeadline:1000,registrationDeadline:2000,promotionDeadline:3000,startsAt:4000,endsAt:5000}};
 expect(countdown(1000)).toBe('已到截止时间');expect(countdown(1000+86461000)).toBe('1 天 00 : 01 : 01');
 expect(eventTimePhase(event)).toBe('10000');vi.setSystemTime(3000);expect(eventTimePhase(event)).toBe('11100');
});
it('未选时段展示相对期限，选定时段展示阿姆斯特丹时间',()=>{
 const rules={registrationLeadHours:24,registrationDeadline:Date.UTC(2026,8,9,12),timeSlots:[{id:'a'}]};
 expect(deadlineLabel({rules},'registration')).toBe('最终开始前 24 小时（定下日期后自动计算）');
 expect(deadlineLabel({rules,selectedSlotId:'a'},'registration')).toBe('9月9日 14:00（开始前 24 小时）');
});
