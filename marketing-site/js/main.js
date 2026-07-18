// 2026-2027 tax deadline dataset — nominal IRS/standard dates.
// If a date falls on a weekend or federal holiday, the actual deadline shifts
// to the next business day; see the disclaimer on the Resources page.
const TAX_DEADLINES = [
  { date: '2026-01-15', category: 'estimated',
    en: { title: 'Q4 2025 Estimated Tax Payment Due', desc: 'Final estimated payment for the 2025 tax year.' },
    ar: { title: 'الدفعة الضريبية المقدرة للربع الرابع 2025', desc: 'الدفعة الأخيرة المقدرة لعام 2025 الضريبي.' } },
  { date: '2026-01-31', category: 'payroll',
    en: { title: 'W-2 & 1099-NEC Deadline', desc: 'Due to employees, contractors, and the IRS/SSA.' },
    ar: { title: 'موعد نماذج W-2 و1099-NEC', desc: 'مستحقة للموظفين والمقاولين ومصلحة الضرائب/الضمان الاجتماعي.' } },
  { date: '2026-03-15', category: 'business',
    en: { title: 'S-Corp & Partnership Returns Due', desc: 'Forms 1120-S and 1065, or file for a 6-month extension.' },
    ar: { title: 'إقرارات S-Corp والشراكات مستحقة', desc: 'النماذج 1120-S و1065، أو التقديم لتمديد لمدة 6 أشهر.' } },
  { date: '2026-04-15', category: 'individual',
    en: { title: 'Individual & C-Corp Returns Due', desc: 'Form 1040 and Form 1120; Q1 2026 estimated payment also due.' },
    ar: { title: 'إقرارات الأفراد وشركات C-Corp مستحقة', desc: 'النموذج 1040 والنموذج 1120؛ كما تُستحق الدفعة المقدرة للربع الأول 2026.' } },
  { date: '2026-04-30', category: 'payroll',
    en: { title: 'Q1 Payroll Tax Return (Form 941)', desc: 'Quarterly federal payroll tax filing.' },
    ar: { title: 'إقرار ضريبة الرواتب للربع الأول (النموذج 941)', desc: 'تقديم إقرار ضريبة الرواتب الفيدرالية الفصلي.' } },
  { date: '2026-06-15', category: 'estimated',
    en: { title: 'Q2 2026 Estimated Tax Payment Due', desc: 'Second quarterly estimated payment for individuals and businesses.' },
    ar: { title: 'الدفعة الضريبية المقدرة للربع الثاني 2026', desc: 'الدفعة الفصلية المقدرة الثانية للأفراد والشركات.' } },
  { date: '2026-07-31', category: 'payroll',
    en: { title: 'Q2 Payroll Tax Return (Form 941)', desc: 'Quarterly federal payroll tax filing.' },
    ar: { title: 'إقرار ضريبة الرواتب للربع الثاني (النموذج 941)', desc: 'تقديم إقرار ضريبة الرواتب الفيدرالية الفصلي.' } },
  { date: '2026-09-15', category: 'estimated',
    en: { title: 'Q3 2026 Estimated Tax Payment Due', desc: 'Also the deadline for extended S-Corp and Partnership returns.' },
    ar: { title: 'الدفعة الضريبية المقدرة للربع الثالث 2026', desc: 'وهو أيضًا الموعد النهائي لإقرارات S-Corp والشراكات الممددة.' } },
  { date: '2026-10-15', category: 'individual',
    en: { title: 'Extended Individual & C-Corp Returns Due', desc: 'Final deadline if you filed a 6-month extension.' },
    ar: { title: 'إقرارات الأفراد وC-Corp الممددة مستحقة', desc: 'الموعد النهائي إذا قدمت طلب تمديد لمدة 6 أشهر.' } },
  { date: '2026-10-31', category: 'payroll',
    en: { title: 'Q3 Payroll Tax Return (Form 941)', desc: 'Quarterly federal payroll tax filing.' },
    ar: { title: 'إقرار ضريبة الرواتب للربع الثالث (النموذج 941)', desc: 'تقديم إقرار ضريبة الرواتب الفيدرالية الفصلي.' } },
  { date: '2027-01-15', category: 'estimated',
    en: { title: 'Q4 2026 Estimated Tax Payment Due', desc: 'Final estimated payment for the 2026 tax year.' },
    ar: { title: 'الدفعة الضريبية المقدرة للربع الرابع 2026', desc: 'الدفعة الأخيرة المقدرة لعام 2026 الضريبي.' } },
  { date: '2027-01-31', category: 'payroll',
    en: { title: 'Q4 Payroll Tax Return (Form 941)', desc: 'Quarterly federal payroll tax filing.' },
    ar: { title: 'إقرار ضريبة الرواتب للربع الرابع (النموذج 941)', desc: 'تقديم إقرار ضريبة الرواتب الفيدرالية الفصلي.' } },
];

// ---------------- i18n ----------------
const LANG_STORAGE_KEY = 'altax_lang';

function getLang() {
  return localStorage.getItem(LANG_STORAGE_KEY) === 'ar' ? 'ar' : 'en';
}

function t(key) {
  const entry = typeof TRANSLATIONS !== 'undefined' ? TRANSLATIONS[key] : null;
  if (!entry) return '';
  return entry[getLang()] || entry.en || '';
}

function applyLanguage(lang) {
  localStorage.setItem(LANG_STORAGE_KEY, lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    const val = t(key);
    if (val) el.innerHTML = val;
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    const val = t(key);
    if (val) el.setAttribute('placeholder', val);
  });
  document.querySelectorAll('.lang-toggle button').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-lang') === lang);
  });

  renderUtilityBar();
  renderCalendarList();
}

function initLangToggle() {
  document.querySelectorAll('.lang-toggle button').forEach((btn) => {
    btn.addEventListener('click', () => applyLanguage(btn.getAttribute('data-lang')));
  });
}

// ---------------- Tax deadline helpers ----------------
function parseLocalDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatDate(d) {
  const lang = getLang();
  // numberingSystem: 'latn' keeps Western digits (0-9) even in Arabic — dates/numbers
  // stay Latin per the site's convention, only the month name translates.
  return d.toLocaleDateString(lang === 'ar' ? 'ar-u-nu-latn' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysUntil(d) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((d - today) / 86400000);
}

function getNextDeadline() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return TAX_DEADLINES.find((item) => parseLocalDate(item.date) >= today) || TAX_DEADLINES[TAX_DEADLINES.length - 1];
}

function renderUtilityBar() {
  const els = document.querySelectorAll('[data-next-deadline]');
  if (!els.length) return;
  const lang = getLang();
  const next = getNextDeadline();
  const d = parseLocalDate(next.date);
  const days = daysUntil(d);
  const daysLabel = days <= 0 ? t('utility.dueNow') : days === 1 ? t('utility.oneDayLeft') : `<bdi dir="ltr">${days}</bdi> ${t('utility.daysLeft')}`;
  const dateHtml = `<bdi dir="ltr">${formatDate(d)}</bdi>`;
  els.forEach((el) => {
    el.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
      <span class="dl-segment">${t('utility.nextDeadline')} <strong>${dateHtml}</strong></span>
      <span class="dl-segment dl-title">${next[lang].title}</span>
      <span class="days-chip">${daysLabel}</span>
    `;
  });
}

function renderCalendarList() {
  const list = document.getElementById('tax-calendar-list');
  if (!list) return;
  const lang = getLang();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const next = getNextDeadline();
  const tagLabels = {
    individual: t('calendar.tagIndividual'),
    business: t('calendar.tagBusiness'),
    payroll: t('calendar.tagPayroll'),
    estimated: t('calendar.tagEstimated'),
    sales: t('calendar.tagSales'),
  };
  list.innerHTML = TAX_DEADLINES.map((item) => {
    const d = parseLocalDate(item.date);
    const isPast = d < today;
    const isNext = item.date === next.date;
    return `
      <div class="calendar-row${isPast ? ' is-past' : ''}">
        <div class="cal-date"><bdi dir="ltr">${formatDate(d)}</bdi></div>
        <span class="tag tag-${item.category}">${tagLabels[item.category]}</span>
        <div class="cal-body">
          <h4>${item[lang].title}</h4>
          <p>${item[lang].desc}</p>
        </div>
        ${isNext ? `<span class="cal-next">${t('calendar.nextUp')}</span>` : ''}
      </div>
    `;
  }).join('');
}

document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.querySelector('.nav-toggle');
  const links = document.querySelector('.nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', () => links.classList.toggle('open'));
    links.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => links.classList.remove('open')));
  }

  const header = document.querySelector('.site-header');
  if (header) {
    const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  const revealEls = document.querySelectorAll('.reveal');
  if (revealEls.length) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -60px 0px' });
    revealEls.forEach((el) => io.observe(el));
  }

  initLangToggle();
  applyLanguage(getLang());

  const contactForm = document.querySelector('.contact-form-card form');
  if (contactForm) {
    contactForm.addEventListener('submit', (e) => {
      e.preventDefault();
      alert(t('form.contactSuccess'));
      contactForm.reset();
    });
  }

  document.querySelectorAll('.newsletter-form').forEach((form) => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      alert(t('form.newsletterSuccess'));
      form.reset();
    });
  });
});
