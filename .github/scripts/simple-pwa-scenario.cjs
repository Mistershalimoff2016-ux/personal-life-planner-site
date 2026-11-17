const fs = require('node:fs');
const assert = require('node:assert/strict');
const taskTitle = 'Проверка простой задачи';
const editedTitle = 'Изменённая простая задача';
const movedTitle = 'Перенесённая задача';
async function verifyShell(page) {
    await page.locator('.kos-shell').waitFor();
    assert.equal(await page.locator('.kos-bottom-nav').isVisible(),true);
    assert.ok(await page.locator('.kos-bottom-nav').evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight+1),'Navigation outside viewport');
    assert.deepEqual(await page.locator('.kos-bottom-nav a').allTextContents(), ['Сегодня','Календарь','Спорт']);
    assert.equal(await page.locator('.kos-header a[href="preferences"]').count(),1);
    assert.ok(!(await page.locator('.kos-brand').innerText()).includes('@if'));
    assert.equal(await page.locator('.kos-brand small').count(),0);
    assert.equal(await page.locator('.kos-legacy-nav,#sidebar-container,.kos-hero,.kos-vitals,.kos-week-mini,.kos-week-chart').count(),0);
    for(const href of ['habits','notes','progress','more','tasks','data','settings'])
        assert.equal(await page.locator(`a[href="${href}"]:visible`).count(),0,'Overloaded route exposed: '+href);
}
async function scenario(page,base) {
    await page.goto(base);await page.getByLabel('Задача',{exact:true}).waitFor({timeout:60000});
    await verifyShell(page);
    assert.equal(await page.locator('[data-testid="quick-task"] input:visible').count(),1);
    await page.getByLabel('Задача',{exact:true}).fill(taskTitle);
    await page.getByRole('button',{name:'Добавить',exact:true}).click();
    await page.getByRole('link',{name:taskTitle,exact:true}).click();
    await page.getByLabel('Название задачи',{exact:true}).fill(editedTitle);
    await page.getByRole('button',{name:'Сохранить',exact:true}).click();
    await page.getByText('Сохранено.',{exact:true}).waitFor();
    await page.locator('summary').filter({hasText:'Дата и время'}).click();
    const tomorrow = await page.evaluate(()=>{const d=new Date();d.setDate(d.getDate()+1);return {iso:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,label:`${d.getDate()} ${new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long'}).formatToParts(d).find(p=>p.type==='month').value} ${d.getFullYear()},`}});
    await page.getByLabel('Дата задачи',{exact:true}).fill(tomorrow.iso);
    await page.getByLabel('Время задачи',{exact:true}).fill('09:30');
    await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByText('Сохранено.',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Выполнить',exact:true}).click();await page.getByRole('button',{name:'Отменить выполнение',exact:true}).waitFor();
    await page.getByRole('link',{name:'Сегодня',exact:true}).click();await page.getByRole('link',{name:editedTitle,exact:true}).waitFor();
    await page.getByLabel('Задача',{exact:true}).fill(movedTitle);await page.getByRole('button',{name:'Добавить',exact:true}).click();
    const article=page.locator('article').filter({has:page.getByRole('link',{name:movedTitle,exact:true})});
    await article.locator('summary').click();await article.getByLabel('Перенести на дату',{exact:true}).fill(tomorrow.iso);
    await page.getByRole('link',{name:movedTitle,exact:true}).waitFor({state:'hidden'});
    await page.getByRole('link',{name:'Календарь',exact:true}).click();
    await page.locator(`button.kos-calendar-day[aria-label^="${tomorrow.label}"]`).click();
    await page.getByRole('link',{name:new RegExp(editedTitle)}).waitFor();await page.getByRole('link',{name:new RegExp(movedTitle)}).waitFor();
    await page.getByRole('link',{name:'Спорт',exact:true}).click();await page.getByRole('button',{name:'Новая тренировка',exact:true}).click();
    assert.equal(await page.locator('form input:visible,form select:visible,form textarea:visible').count(),3);
    await page.getByLabel('Вид тренировки',{exact:true}).selectOption('Силовая');
    await page.getByLabel('Продолжительность, мин',{exact:true}).fill('25');
    await page.getByRole('button',{name:'Сохранить тренировку',exact:true}).click();
    await page.getByRole('button',{name:'Редактировать',exact:true}).waitFor();
    await page.getByRole('button',{name:'Редактировать',exact:true}).click();
    await page.getByLabel('Продолжительность, мин',{exact:true}).fill('35');
    await page.getByRole('button',{name:'Сохранить тренировку',exact:true}).click();await page.getByRole('button',{name:'Редактировать',exact:true}).waitFor();
    await page.getByRole('link',{name:'Календарь',exact:true}).click();await page.getByRole('link',{name:/Силовая/}).waitFor();
    await page.getByRole('link',{name:'Настройки',exact:true}).click();
    assert.equal(await page.getByText(/YAML|TSV|Markdown|демонстрационн|Загрузить примеры|Категории|Приоритеты/).count(),0);
    const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Скачать резервную копию',exact:true}).click();const download=await downloadPromise;
    const backup=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
    assert.ok(JSON.stringify(backup).includes(editedTitle),'Backup omitted task');
    await page.goto(base+'habits');await page.getByRole('heading',{name:'Сегодня',exact:true}).waitFor();await verifyShell(page);
    return {task:editedTitle,movedTask:movedTitle,workout:'Силовая'};
}
async function verifyRetained(page,base) {
    await page.goto(base+'today');await page.getByRole('link',{name:editedTitle,exact:true}).waitFor({timeout:60000});await verifyShell(page);
    await page.getByRole('link',{name:'Спорт',exact:true}).click();await page.getByRole('link',{name:/Силовая/}).first().click();await page.getByRole('button',{name:'Редактировать',exact:true}).click();
    assert.equal(await page.getByLabel('Продолжительность, мин',{exact:true}).inputValue(),'35');
}
module.exports={scenario,verifyRetained,verifyShell};
