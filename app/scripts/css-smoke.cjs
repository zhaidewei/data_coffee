// 面向前端维护者：使用固定 API 数据验证 CSS 布局、交互与主题；不连接真实服务。
const { chromium } = require('playwright');
const fs = require('node:fs'), http = require('node:http'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(process.argv[2] || path.join(__dirname, '../web')), name = 'css-smoke', out = process.env.CSS_SMOKE_OUTPUT || require('node:os').tmpdir() + '/data-coffee-css-smoke';
fs.mkdirSync(out, { recursive: true });
const startsAt = Date.parse('2026-09-26T12:00Z'), rules = { startsAt, endsAt: startsAt + 10800000, timeSlots: [{id:'slot-a',startsAt,endsAt:startsAt+10800000},{id:'slot-b',startsAt:startsAt+7*86400000,endsAt:startsAt+7*86400000+10800000}], recruitmentDeadline: startsAt - 86400000, registrationDeadline: startsAt - 3600000, promotionDeadline: startsAt - 3600000, minPeople: 3, maxPeople: 8, minHosts: 0, minTalks: 0, minCohosts: 0, venueRequired: false, waitlist: true, repairMinutes: 60, continuousVenue: true, continuousHosts: true };
const event = { id: 'css-smoke', title: '数据同行周末咖啡', description: '一起聊数据、工具与生活。', city: 'Amsterdam', status: 'recruiting', version: 1, rules, tags: ['AI', 'Data'], counts: { joined: 4, waitlisted: 1 }, conditions: [{ key: 'people', label: '人数', required: 3, current: 4, satisfied: true }], repairs: [], participants: [], applications: [], myApplications: [], receipts: [], preferenceSummary: { slots: [], times: [], places: [], transport: [] }, publisher: { nickname: '社区成员' }, myParticipation: null, canManage: false, isOwner: false, createdAt: startsAt - 7 * 86400000 };
const user = { id: 'smoke-user', nickname: '测试成员', publicNickname: true };
(async () => {
    const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); if (p === '/')
        p = '/index.html'; const file = path.join(root, p); try {
        res.setHeader('Content-Type', (file.endsWith('.js') || file.endsWith('.mjs')) ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.json') ? 'application/json' : 'text/html');
        res.end(fs.readFileSync(file));
    }
    catch {
        res.statusCode = 404;
        res.end();
    } });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const url = 'http://127.0.0.1:' + server.address().port;
    const browser = await chromium.launch({ channel: process.env.CSS_SMOKE_CHANNEL || 'chrome', headless: true });
    const results = {};
    try {
        for (const width of [375, 600, 601, 900, 1280])
            for (const theme of ['dark', 'light'])
                for (const view of ['home', 'form', 'detail', 'focus', 'dialog', 'cli']) {
                    const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
                    const page = await context.newPage();
                    let errors = [];
                    page.on('pageerror', e => (errors.push(e.message), console.error(e.message)));
                    await page.addInitScript(theme => { localStorage.setItem('data-coffee-theme', theme); const Original = Date; window.Date = class extends Original {
                        constructor(...args) { super(...(args.length ? args : ['2026-09-09T12:00Z'])); }
                        static now() { return new Original('2026-09-09T12:00Z').getTime(); }
                    }; }, theme);
                    await page.route('**/*', async (route) => { const u = new URL(route.request().url()); if (u.origin !== url)
                        return route.abort(); if (u.pathname.startsWith('/api/')) {
                        let data = u.pathname === '/api/me' ? { user } : u.pathname === '/api/tags' ? { tags: ['AI', 'Data'] } : u.pathname === '/api/events/css-smoke' ? { event } : { events: [event], user, pagination: { page: 1, pageSize: 12, total: 1, totalPages: 1, nextPage: null }, overview: { total: 1, cities: [{ city: 'Amsterdam', count: 1 }], tags: [{ label: 'AI', count: 1 }], allCities: ['Amsterdam'] } };
                        return route.fulfill({ json: data });
                    } return route.continue(); });
                    const hash = { home: '', form: '#new', detail: '#event/css-smoke', focus: '#event/css-smoke', dialog: '#event/css-smoke', cli: '#cli' }[view];
                    await page.goto(url + '/' + hash);
                    await page.locator(view === 'home' ? '.overview-event' : view === 'form' ? '.wide-form' : view === 'cli' ? '.cli-reference' : '.dag-node').first().waitFor({ timeout: 5000 }).catch(async (e) => { console.error(await page.locator('body').innerText()); throw e; });
                    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
                    if (view === 'home') {
                        assert.equal(await page.locator('.overview-card-cta').innerText(), '查看并报名');
                        assert.equal(await page.locator('.overview-card-fact').first().locator('dd strong').innerText(),'时间待定');
                        assert.match(await page.locator('.overview-card-fact').first().locator('dd small').innerText(),/最终选 1 场/);
                        assert.equal(await page.locator('.event-popularity progress').getAttribute('aria-label'), '活动人气（含报名与候补）');
                        assert.equal(await page.locator('.event-popularity progress').getAttribute('aria-valuetext'), '4 人已报名 · 最终时段需 3 人可参加 · 总人气 5 人 · 上限 8 人');
                        assert.deepEqual(await page.locator('.popularity-track').evaluate(root => ({ max: Number(root.querySelector('progress').max), value: Number(root.querySelector('progress').value), marker: parseFloat(root.querySelector('.quorum-marker').style.left) })), { max: 8, value: 5, marker: 37.5 });
                        assert.equal(await page.locator('.event-popularity small').innerText(),'人气含报名与候补 · 成行线 3 人 · 上限 8 人');
                        assert.deepEqual(await page.locator('.overview-fact-icon').evaluateAll(nodes=>nodes.map(node=>({kind:node.classList.item(1),width:getComputedStyle(node).width,before:getComputedStyle(node,'::before').content}))),[{kind:'time',width:'14px',before:'""'},{kind:'place',width:'14px',before:'""'}]);
                    }
                    if (view === 'form') {
                        await page.locator('.city-toggle').click();
                        assert.equal(await page.locator('.city-options').isVisible(), true);
                        await page.locator('input[name=city]').fill('Rotterdam');
                        await page.locator('[role=option]').first().click();
                        assert.equal(await page.locator('input[name=city]').inputValue(), 'Rotterdam');
                    }
                    if (view === 'dialog') {
                        await page.locator('.dag-node').first().click();
                        await page.locator('dialog[open]').waitFor();
                    }
                    if (view === 'focus') {
                        await page.keyboard.press('Tab');
                        await page.locator('.dag-node').first().evaluate(n => { n.setAttribute('aria-pressed', 'true'); n.focus(); });
                        assert.equal(await page.locator('.dag-node').first().evaluate(n=>n.matches(':focus-visible')),true);
                    }
                    const navWidth = await page.locator('.workspace-nav').evaluate(n=>Math.round(n.getBoundingClientRect().width));
                    assert.equal(navWidth,width<=600?width:64,'导航宽度');
                    if(view==='focus') {
                        const focus = await page.locator('.dag-node').first().evaluate(n=>({visible:n.matches(':focus-visible'),width:getComputedStyle(n).outlineWidth,offset:getComputedStyle(n).outlineOffset}));
                        assert.deepEqual(focus,{visible:true,width:'3px',offset:'3px'});
                    }
                    await page.mouse.move(0, 0);
                    await page.evaluate(() => document.fonts.ready);
                    await page.waitForTimeout(220);
                    const key = [width, theme, view].join('-');
                    results[key] = await page.evaluate(() => { const props = ['display', 'position', 'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height', 'padding', 'margin', 'gap', 'grid-template-columns', 'flex-direction', 'align-items', 'justify-content', 'justify-items', 'font-size', 'font-weight', 'line-height', 'color', 'background-color', 'border', 'border-radius', 'box-shadow', 'transform', 'top', 'left', 'right', 'bottom', 'overflow', 'outline', 'outline-offset', 'opacity', 'float']; return [...document.querySelectorAll('body,header.workspace-nav,header.workspace-nav *,#app,#app *,dialog[open],dialog[open] *,footer,footer *')].filter(n => !n.closest('.leaflet-container') && !n.classList.contains('real-map-status')).map(n => ({ tag: n.tagName, cls: n.className?.baseVal ?? n.className, styles: Object.fromEntries(props.map(p => [p, getComputedStyle(n).getPropertyValue(p)])) })); });
                    if ([375, 1280].includes(width) && view === 'home')
                        await page.screenshot({ path: path.join(out, `${name}-${key}.png`), fullPage: true });
                    assert.deepEqual(errors, []);
                    await context.close();
                }
        if (process.env.CSS_SMOKE_BASELINE) {
            const baseline = JSON.parse(fs.readFileSync(process.env.CSS_SMOKE_BASELINE, 'utf8'));
            assert.deepEqual(Object.keys(results), Object.keys(baseline));
            for (const key of Object.keys(results))
                assert.deepEqual(results[key], baseline[key], key + ' 样式发生变化');
        }
        fs.writeFileSync(path.join(out, name + '.json'), JSON.stringify(results));
        console.log(name, Object.keys(results).length, 'browser states passed');
    }
    finally {
        await browser.close();
        server.close();
    }
})().catch(e => { console.error(e); process.exit(1); });
