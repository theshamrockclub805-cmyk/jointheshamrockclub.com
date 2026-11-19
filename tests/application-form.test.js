'use strict';

/**
 * Drives the real application form in a browser.
 *
 * The referral block decides who gets paid 15%, and it is built entirely out
 * of show/hide behaviour, so reading the markup proves nothing. These checks
 * click through it the way an applicant would.
 *
 * Skipped where Playwright is not installed - it is not a dependency of this
 * repo, and a missing browser should not read as a broken site.
 */

const { playwright, repoPath, Skip } = require('./lib/harness');

const STAFF = 'A teacher, coach or school staff member';

module.exports = async function (t) {
  const pw = playwright();
  if (!pw) throw new Skip('playwright is not installed');

  const browser = await pw.chromium.launch();
  try {
    const pg = await browser.newPage();
    const errors = [];
    pg.on('pageerror', e => errors.push(e.message));
    await pg.goto('file://' + repoPath('application-form.html'));

    const hidden = sel => pg.$eval(sel, e => e.hidden);
    const text = sel => pg.$eval(sel, e => e.textContent);

    // --- the staff block appears only for a staff referral
    t('staff block hidden on load', await hidden('#staff-referral') === true);
    await pg.selectOption('#heard', 'Instagram');
    t('still hidden for a social source', await hidden('#staff-referral') === true);
    await pg.selectOption('#heard', STAFF);
    t('revealed for a staff referral', await hidden('#staff-referral') === false);
    t('the write-in asks for a name', (await text('#referred-label')).trim().startsWith('Their name'),
      await text('#referred-label'));

    // --- a referrer may work at any school, including one closed to sponsors
    const schools = await pg.$$eval('#referrer-school option',
      os => os.filter(o => o.value).map(o => ({ value: o.value, disabled: o.disabled })));
    t('all 11 schools offered as a referrer school', schools.length === 11, schools.length);
    t('none disabled - the Oxnard hold is about sponsors, not staff',
      schools.every(o => !o.disabled), schools.filter(o => o.disabled));
    t('Oxnard is selectable for a referrer',
      schools.some(o => o.value === 'Oxnard High School' && !o.disabled));

    // --- switching away must not leave a payee behind
    await pg.fill('#referred-by', 'Dana Ruiz');
    await pg.selectOption('#referrer-school', 'Ventura High School');
    await pg.fill('#referrer-email', 'druiz@vusd.org');
    await pg.fill('#referrer-program', 'Marching Band');
    await pg.selectOption('#heard', 'A friend or someone I know');
    t('hidden again when the source changes', await hidden('#staff-referral') === true);
    const leftovers = await pg.evaluate(() => ({
      school: document.getElementById('referrer-school').value,
      email: document.getElementById('referrer-email').value,
      program: document.getElementById('referrer-program').value
    }));
    t('every hidden referral answer is cleared, not just the school',
      !leftovers.school && !leftovers.email && !leftovers.program, leftovers);

    // --- the school is required, because it identifies whose program is owed
    await pg.selectOption('#heard', STAFF);
    await pg.fill('#biz-name', 'Test Co');
    await pg.selectOption('#category', 'Home & trade services');
    await pg.fill('#city', 'Ventura');
    await pg.fill('#contact-name', 'Pat Tester');
    await pg.fill('#email', 'pat@example.com');
    await pg.fill('#phone', '8055551234');
    await pg.fill('#referred-by', 'Dana Ruiz');
    await pg.click('button[type="submit"]');
    t('submit blocked with no referrer school',
      await pg.$eval('#referrer-school', e => e.closest('.field').classList.contains('invalid')));

    // --- two fields here ask about a "program" and mean different things
    t('the referral program label names the referrer',
      (await text('#referrer-program-label')).includes('Dana Ruiz'), await text('#referrer-program-label'));
    t('it cannot be confused with the sponsor’s own program choice',
      (await text('label[for="program"]')) !== (await text('#referrer-program-label')));
    await pg.fill('#referred-by', '');
    t('it falls back to "their" before a name is typed',
      (await text('#referrer-program-label')).trim() === 'Which of their programs should we credit?',
      await text('#referrer-program-label'));
    await pg.fill('#referred-by', '<img src=x onerror=alert(1)>');
    t('a name containing markup is rendered as text, not HTML',
      (await pg.$eval('#referrer-program-label', e => e.innerHTML)).includes('&lt;img'),
      await pg.$eval('#referrer-program-label', e => e.innerHTML));

    // --- what actually gets posted
    await pg.fill('#referred-by', 'Dana Ruiz');
    await pg.selectOption('#referrer-school', 'Ventura High School');
    await pg.fill('#referrer-email', 'druiz@vusd.org');
    await pg.fill('#referrer-program', 'Marching Band');
    const posted = await pg.evaluate(() => {
      const d = {};
      new FormData(document.getElementById('apply-form'))
        .forEach((v, k) => { if (!(v instanceof File)) d[k] = v; });
      return d;
    });
    t('posts the source', posted.heard === STAFF, posted.heard);
    t('posts the referrer name', posted.referredBy === 'Dana Ruiz', posted.referredBy);
    t('posts the referrer school', posted.referrerSchool === 'Ventura High School', posted.referrerSchool);
    t('posts the referrer email', posted.referrerEmail === 'druiz@vusd.org', posted.referrerEmail);
    t('posts the program to credit', posted.referrerProgram === 'Marching Band', posted.referrerProgram);

    // --- anyone can be named, whatever route they came by
    await pg.selectOption('#heard', 'A friend or someone I know');
    t('a friend is an option in its own right, not "Other"',
      await pg.$eval('#heard', e => e.value) === 'A friend or someone I know');
    t('no staff block for a friend, because it earns nothing',
      await hidden('#staff-referral') === true);
    t('the hint says why we are asking', /thank/i.test(await text('#referred-hint')),
      await text('#referred-hint'));
    await pg.selectOption('#heard', 'Local event');
    t('an event invites a person too', /who did you speak to/i.test(await text('#referred-label')),
      await text('#referred-label'));

    const sources = await pg.$$eval('#heard option', os => os.filter(o => o.value).map(o => o.value));
    t('all ten sources present', sources.length === 10, sources);
    let everySourceAsks = true;
    for (const source of sources) {
      await pg.selectOption('#heard', source);
      if (await hidden('#referred-field')) everySourceAsks = false;
    }
    t('every source offers somewhere to put a name', everySourceAsks, sources);

    // --- the school a BUSINESS sponsors is a different list, and Oxnard is held
    const sponsorSchools = await pg.$$eval('#school option',
      os => os.map(o => ({ label: o.textContent.trim(), value: o.value, disabled: o.disabled })));
    const oxnard = sponsorSchools.find(o => o.label.startsWith('Oxnard High School'));
    t('Oxnard is disabled as a sponsorship choice', oxnard && oxnard.disabled === true, oxnard);
    t('and posts nothing even if forced', oxnard && oxnard.value === '', oxnard);

    t('no page errors throughout', errors.length === 0, errors);
  } finally {
    await browser.close();
  }
};
