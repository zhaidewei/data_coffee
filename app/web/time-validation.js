// Read current field values so invalid edits never fall back to an older slot value.
export function attachTimeValidation(form, parse){
  let active=false, sequence=0;
  function validate(){
    const errors=new Map();
    const inputs=[...form.querySelectorAll('input[type="datetime-local"]')];
    const values=new Map();
    for(const input of inputs){
      if(!input.value){errors.set(input,'请填写完整的日期和时间。');continue;}
      if(input.type==='time')continue;
      try{values.set(input,parse(input.value,input.closest('.time-row').querySelector(':scope > select')?.value));}
      catch{errors.set(input,'这个荷兰当地时间不存在，请避开夏令时切换跳过的时段。');}
    }
    const starts=[];
    for(const row of form.querySelectorAll('.slot-editor-row')){
      const [start,end]=row.querySelectorAll('input[type=datetime-local]');
      if(values.has(start))starts.push(values.get(start));
      if(values.has(start)&&values.has(end)&&values.get(end)<=values.get(start))errors.set(end,'结束时间必须晚于这一时段的开始时间。');
    }
    const first=starts.length?Math.min(...starts):null;
    const recruitment=form.elements.namedItem('recruitmentDeadline');
    if(values.has(recruitment)&&values.get(recruitment)<=Date.now())errors.set(recruitment,'成行决定期限必须晚于当前时间。');
    if(first!==null&&values.has(recruitment)&&values.get(recruitment)>=first)errors.set(recruitment,'成行决定期限必须早于最早候选时段的开始时间。');
    for(const name of ['registrationDeadline','promotionDeadline']){
      const input=form.elements.namedItem(name),v=values.get(input);
      if(v===undefined)continue;
      if(values.has(recruitment)&&v<values.get(recruitment))errors.set(input,'此截止时间不能早于成行决定期限。');
      else if(first!==null&&v>=first)errors.set(input,'此截止时间必须早于最早候选时段的开始时间。');
    }
    for(const input of inputs){
      let note=input.closest('label').querySelector('.field-error');
      const message=errors.get(input)||'';
      input.setCustomValidity(message);
      input.setAttribute('aria-invalid',String(Boolean(message)));
      if(message&&!note){note=document.createElement('small');note.className='field-error';note.id='time-error-'+(++sequence);note.setAttribute('aria-live','polite');input.closest('label').append(note);input.setAttribute('aria-describedby',note.id);}
      if(note){note.textContent=message;note.hidden=!message;}
      if(message){const details=input.closest('details');if(details)details.open=true;}
    }
    return errors.size===0;
  }
  form.addEventListener('focusout',e=>{if(e.target.matches('input[type="datetime-local"],input[type="time"],.time-row select')){active=true;validate();}});
  form.addEventListener('change',e=>{if(e.target.matches('input[type="datetime-local"],input[type="time"],.time-row select')){active=true;validate();}});
  form.addEventListener('input',()=>{if(active)validate();});
  form.addEventListener('slots-changed',()=>{active=true;validate();});
  form.addEventListener('submit',e=>{if(!validate()){e.preventDefault();e.stopImmediatePropagation();form.querySelector('[aria-invalid="true"]')?.focus();}},true);
  return validate;
}
