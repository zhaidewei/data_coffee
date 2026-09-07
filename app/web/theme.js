let preference='dark';
try{const saved=localStorage.getItem('data-coffee-theme');if(['light','dark','system'].includes(saved))preference=saved;}catch{}
const systemTheme=matchMedia('(prefers-color-scheme: dark)');
function applyTheme(){const theme=preference==='system'?(systemTheme.matches?'dark':'light'):preference;document.documentElement.dataset.theme=theme;document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='light'?'#f4f7fb':'#171d2c');}
window.coffeeTheme={get:()=>preference,set:value=>{if(!['light','dark','system'].includes(value))return;preference=value;try{localStorage.setItem('data-coffee-theme',value);}catch{}applyTheme();}};
systemTheme.addEventListener('change',applyTheme);applyTheme();
