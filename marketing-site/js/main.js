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
    const statusEl = document.getElementById('contact-form-status');
    const submitBtn = document.getElementById('contact-submit-btn');
    const submitLabel = submitBtn ? submitBtn.querySelector('span') : null;

    contactForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        company: contactForm.querySelector('#company').value.trim(),
        firstName: contactForm.querySelector('#first-name').value.trim(),
        lastName: contactForm.querySelector('#last-name').value.trim(),
        phone: contactForm.querySelector('#phone').value.trim(),
        email: contactForm.querySelector('#email').value.trim(),
        reason: contactForm.querySelector('#reason').value.trim(),
        smsConsent: contactForm.querySelector('#sms-consent').checked,
        website: contactForm.querySelector('#website').value, // honeypot — real visitors never see or fill this
      };

      if (statusEl) statusEl.style.display = 'none';
      if (submitBtn) submitBtn.disabled = true;
      if (submitLabel) submitLabel.textContent = t('contact.sending');

      try {
        const res = await fetch('/public/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Request failed');
        if (statusEl) {
          statusEl.className = 'form-status success';
          statusEl.textContent = t('contact.successMessage');
          statusEl.style.display = 'block';
        }
        contactForm.reset();
      } catch (err) {
        if (statusEl) {
          statusEl.className = 'form-status error';
          statusEl.textContent = t('contact.errorMessage');
          statusEl.style.display = 'block';
        }
      } finally {
        if (submitBtn) submitBtn.disabled = false;
        if (submitLabel) submitLabel.textContent = t('contact.submit');
      }
    });
  }

  const bookDateInput = document.getElementById('book-date');
  if (bookDateInput) {
    const slotsEl = document.getElementById('book-slots');
    const bookForm = document.getElementById('book-form');
    const bookStatusEl = document.getElementById('book-form-status');
    const bookSubmitBtn = document.getElementById('book-submit-btn');
    const bookSubmitLabel = bookSubmitBtn ? bookSubmitBtn.querySelector('span') : null;
    const typeFieldEl = document.getElementById('book-type-field');
    const typeSelectEl = document.getElementById('book-type');
    let selectedSlot = null;

    // Appointment Types — which duration a visitor is booking (e.g. a short
    // "Quick Question" vs. a longer "Full Consultation"). The picker only
    // shows when there's a real choice to make; with just one active type
    // (the common case for a firm that hasn't set up multiple yet) it stays
    // hidden and that one type is used automatically, same as before this
    // feature existed.
    fetch('/public/appointments/appointment-types').then((r) => r.json()).then((data) => {
      const types = data.types || [];
      if (typeSelectEl) {
        typeSelectEl.innerHTML = '';
        types.forEach((t) => {
          const opt = document.createElement('option');
          opt.value = t.appointmentTypeId;
          opt.textContent = t.name + ' (' + t.durationMinutes + ' min)';
          typeSelectEl.appendChild(opt);
        });
      }
      if (typeFieldEl) typeFieldEl.style.display = types.length > 1 ? 'block' : 'none';
      if (typeSelectEl) typeSelectEl.addEventListener('change', loadSlots);
    }).catch(() => {});

    let apptSettings = null;
    const WEEKDAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    const WEEKDAY_NAMES = {
      en: { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' },
      ar: { mon: 'الاثنين', tue: 'الثلاثاء', wed: 'الأربعاء', thu: 'الخميس', fri: 'الجمعة', sat: 'السبت', sun: 'الأحد' },
    };
    function fmtHour12(h) {
      const period = h < 12 ? 'AM' : 'PM';
      const hour12 = h % 12 === 0 ? 12 : h % 12;
      return hour12 + ':00 ' + period;
    }
    function hoursForDay(key) {
      const override = apptSettings.dayHours && apptSettings.dayHours[key];
      const start = override && override.startHour != null ? override.startHour : apptSettings.businessStartHour;
      const end = override && override.endHour != null ? override.endHour : apptSettings.businessEndHour;
      return fmtHour12(start) + ' – ' + fmtHour12(end);
    }
    function renderHoursNote() {
      const noteEl = document.getElementById('book-hours-note');
      if (!noteEl) return;
      if (!apptSettings) {
        noteEl.textContent = t('book.hoursNote') || 'Appointments are available Monday–Friday, 9:00 AM – 5:00 PM Eastern.';
        return;
      }
      const lang = getLang();
      const names = WEEKDAY_NAMES[lang] || WEEKDAY_NAMES.en;
      const bookableDays = WEEKDAY_ORDER.filter((k) => apptSettings.bookableWeekdays[k]);
      // Group consecutive bookable days that share the same effective hours (per-day overrides fall back to the default range).
      const groups = [];
      bookableDays.forEach((k) => {
        const hours = hoursForDay(k);
        const last = groups[groups.length - 1];
        if (last && last.hours === hours) last.days.push(k);
        else groups.push({ hours: hours, days: [k] });
      });
      const sep = lang === 'ar' ? '، ' : ', ';
      const dash = lang === 'ar' ? '–' : '–';
      const parts = groups.map((g) => {
        const dayLabel = g.days.length > 2
          ? names[g.days[0]] + dash + names[g.days[g.days.length - 1]]
          : g.days.map((k) => names[k]).join(sep);
        return dayLabel + ' ' + g.hours;
      });
      const partsList = parts.join(sep);
      noteEl.textContent = lang === 'ar'
        ? ('المواعيد متاحة أيام ' + partsList + ' بتوقيت شرق أمريكا.')
        : ('Appointments are available ' + partsList + ' Eastern.');
    }
    fetch('/public/appointments/settings').then((r) => r.json()).then((data) => {
      apptSettings = data;
      renderHoursNote();
      const addrRow = document.getElementById('book-office-address-row');
      const addrEl = document.getElementById('book-office-address');
      if (addrRow && addrEl && data.locationAddress) {
        addrEl.textContent = (data.locationName ? data.locationName + ' — ' : '') + data.locationAddress;
        addrRow.style.display = 'flex';
      }
    }).catch(() => { renderHoursNote(); });
    document.querySelectorAll('.lang-toggle button').forEach((btn) => btn.addEventListener('click', renderHoursNote));

    const todayStr = new Date().toISOString().slice(0, 10);
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + 60);
    bookDateInput.min = todayStr;
    bookDateInput.max = maxDate.toISOString().slice(0, 10);
    bookDateInput.value = todayStr;

    function addDaysStr(dateStr, days) {
      const d = new Date(dateStr + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    }
    function fmtDateLabel(dateStr) {
      const lang = getLang();
      return new Date(dateStr + 'T12:00:00Z').toLocaleDateString(lang === 'ar' ? 'ar' : 'en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' });
    }
    function showNextAvailableNote(dateStr) {
      const noteEl = document.getElementById('book-next-available-note');
      if (!noteEl) return;
      if (!dateStr) { noteEl.style.display = 'none'; return; }
      noteEl.textContent = (t('book.showingNext') || 'Showing the next available day —') + ' ' + fmtDateLabel(dateStr);
      noteEl.style.display = 'block';
    }

    // Empty-state renders a "find the next open day" action instead of a bare
    // dead end — previously, landing here after hours (or on a non-bookable
    // weekday) just said "no open times," with nothing telling a first-time
    // visitor which day WOULD work, so many likely just left.
    function renderSlots(slots) {
      slotsEl.innerHTML = '';
      selectedSlot = null;
      bookForm.style.display = 'none';
      if (!slots.length) {
        const wrap = document.createElement('div');
        wrap.className = 'book-slots-empty-wrap';
        const empty = document.createElement('span');
        empty.className = 'book-slots-empty';
        empty.textContent = t('book.noSlots') || 'No open times that day — try another date.';
        wrap.appendChild(empty);
        const jumpBtn = document.createElement('button');
        jumpBtn.type = 'button';
        jumpBtn.className = 'book-jump-btn';
        jumpBtn.textContent = t('book.findNext') || 'Find the next open day';
        jumpBtn.addEventListener('click', () => jumpToNextAvailable(addDaysStr(bookDateInput.value, 1)));
        wrap.appendChild(jumpBtn);
        slotsEl.appendChild(wrap);
        return;
      }
      slots.forEach((iso) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'book-slot';
        btn.textContent = new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
        btn.addEventListener('click', () => {
          selectedSlot = iso;
          slotsEl.querySelectorAll('.book-slot').forEach((b) => b.classList.remove('selected'));
          btn.classList.add('selected');
          bookForm.style.display = 'block';
        });
        slotsEl.appendChild(btn);
      });
    }

    async function jumpToNextAvailable(fromDateStr) {
      slotsEl.innerHTML = '<span class="book-slots-empty">' + (t('book.loading') || 'Loading…') + '</span>';
      try {
        let url = '/public/appointments/next-available?from=' + encodeURIComponent(fromDateStr);
        if (typeSelectEl && typeSelectEl.value) url += '&appointmentTypeId=' + encodeURIComponent(typeSelectEl.value);
        const res = await fetch(url);
        const data = await res.json();
        if (data.date) {
          bookDateInput.value = data.date;
          renderSlots(data.slots || []);
          showNextAvailableNote(data.date);
        } else {
          renderSlots([]);
        }
      } catch (err) {
        renderSlots([]);
      }
    }

    async function loadSlots() {
      showNextAvailableNote(null);
      slotsEl.innerHTML = '<span class="book-slots-empty">' + (t('book.loading') || 'Loading…') + '</span>';
      bookForm.style.display = 'none';
      try {
        let url = '/public/appointments/availability?date=' + encodeURIComponent(bookDateInput.value);
        if (typeSelectEl && typeSelectEl.value) url += '&appointmentTypeId=' + encodeURIComponent(typeSelectEl.value);
        const res = await fetch(url);
        const data = await res.json();
        renderSlots(data.slots || []);
      } catch (err) {
        slotsEl.innerHTML = '<span class="book-slots-empty">' + (t('book.noSlots') || 'No open times that day — try another date.') + '</span>';
      }
    }

    bookDateInput.addEventListener('change', loadSlots);
    // First load is "smart" — jump straight to the next day with real open
    // slots (which may well be today) instead of always showing today's
    // picker even when today's hours have already passed or today isn't a
    // bookable weekday at all.
    jumpToNextAvailable(todayStr);

    const contactHintEl = document.getElementById('book-contact-hint');
    const bookPhoneEl = document.getElementById('book-phone');
    const bookEmailEl = document.getElementById('book-email');
    function clearContactHint() {
      if (!contactHintEl) return;
      contactHintEl.classList.remove('invalid');
      contactHintEl.textContent = t('book.contactHint') || 'Add a phone number or email so we can confirm — either one works.';
    }
    if (bookPhoneEl) bookPhoneEl.addEventListener('input', clearContactHint);
    if (bookEmailEl) bookEmailEl.addEventListener('input', clearContactHint);

    bookForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!selectedSlot) return;
      const payload = {
        name: document.getElementById('book-name').value.trim(),
        email: document.getElementById('book-email').value.trim(),
        phone: document.getElementById('book-phone').value.trim(),
        reason: document.getElementById('book-reason').value.trim(),
        startTime: selectedSlot,
        appointmentTypeId: typeSelectEl ? typeSelectEl.value : undefined,
        website: document.getElementById('book-website').value, // honeypot
      };
      if (!payload.email && !payload.phone) {
        if (contactHintEl) {
          contactHintEl.classList.add('invalid');
          contactHintEl.textContent = t('book.contactRequired') || 'Please add a phone number or email so we can confirm your appointment.';
        }
        if (bookPhoneEl) bookPhoneEl.focus();
        return;
      }
      if (bookStatusEl) bookStatusEl.style.display = 'none';
      if (bookSubmitBtn) bookSubmitBtn.disabled = true;
      if (bookSubmitLabel) bookSubmitLabel.textContent = t('contact.sending');
      try {
        const res = await fetch('/public/appointments/book', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Request failed');
        if (bookStatusEl) {
          bookStatusEl.className = 'form-status success';
          bookStatusEl.textContent = t('book.successMessage') || 'Your appointment is confirmed — check your email/text for details.';
          bookStatusEl.style.display = 'block';
        }
        bookForm.reset();
        bookForm.style.display = 'none';
        loadSlots();
      } catch (err) {
        if (bookStatusEl) {
          bookStatusEl.className = 'form-status error';
          bookStatusEl.textContent = (err && err.message) || t('book.errorMessage') || 'Something went wrong booking your appointment. Please try again, or call us directly.';
          bookStatusEl.style.display = 'block';
        }
      } finally {
        if (bookSubmitBtn) bookSubmitBtn.disabled = false;
        if (bookSubmitLabel) bookSubmitLabel.textContent = t('book.submit');
      }
    });
  }

  const manageCard = document.getElementById('manage-card');
  if (manageCard) {
    const loadingEl = document.getElementById('manage-loading');
    const notFoundEl = document.getElementById('manage-notfound');
    const titleEl = document.getElementById('manage-title');
    const whenEl = document.getElementById('manage-when');
    const statusEl = document.getElementById('manage-form-status');
    const actionsEl = document.getElementById('manage-actions');
    const confirmBtn = document.getElementById('manage-confirm-btn');
    const confirmedNoteEl = document.getElementById('manage-confirmed-note');
    const cancelBtn = document.getElementById('manage-cancel-btn');
    const rescheduleBtn = document.getElementById('manage-reschedule-btn');
    const reschedulePanel = document.getElementById('manage-reschedule-panel');
    const dateInput = document.getElementById('manage-date');
    const slotsEl = document.getElementById('manage-slots');
    const confirmRescheduleBtn = document.getElementById('manage-confirm-reschedule-btn');
    const pastNoticeEl = document.getElementById('manage-past-notice');
    const token = new URLSearchParams(window.location.search).get('token') || '';
    let selectedSlot = null;
    let currentAppt = null;

    function showStatus(kind, message) {
      statusEl.className = 'form-status ' + kind;
      statusEl.textContent = message;
      statusEl.style.display = 'block';
    }

    function renderAppointment(appt) {
      currentAppt = appt;
      titleEl.textContent = appt.title;
      const when = new Date(appt.startTime).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'full', timeStyle: 'short' });
      whenEl.textContent = when + ' ET · ' + appt.status;
      if (!appt.canManage) {
        actionsEl.style.display = 'none';
        reschedulePanel.style.display = 'none';
        pastNoticeEl.style.display = 'block';
      }
    }

    async function loadAppointment() {
      if (!token) {
        loadingEl.style.display = 'none';
        notFoundEl.style.display = 'block';
        return;
      }
      try {
        const res = await fetch('/public/appointments/manage/' + encodeURIComponent(token));
        if (!res.ok) throw new Error('not found');
        const data = await res.json();
        loadingEl.style.display = 'none';
        manageCard.style.display = 'block';
        renderAppointment(data);
        // The email now shows Confirm/Reschedule/Cancel as their own buttons
        // instead of one "Manage Appointment" link — each carries an
        // ?action= hint so this page immediately does what the client
        // clicked for, rather than making them find the right button again
        // here. Reuses the exact same click handlers below (defined further
        // down but already attached by the time this fetch resolves, since
        // that attachment code runs synchronously right after this function
        // is invoked) — so every existing safeguard (native confirm() gate
        // on Cancel, canManage check, etc.) still applies unchanged.
        if (data.canManage) {
          var action = new URLSearchParams(window.location.search).get('action') || '';
          if (action === 'confirm') confirmBtn.click();
          else if (action === 'reschedule') rescheduleBtn.click();
          else if (action === 'cancel') cancelBtn.click();
        }
      } catch (err) {
        loadingEl.style.display = 'none';
        notFoundEl.style.display = 'block';
      }
    }
    loadAppointment();

    confirmBtn.addEventListener('click', async () => {
      confirmBtn.disabled = true;
      try {
        const res = await fetch('/public/appointments/manage/' + encodeURIComponent(token) + '/confirm', { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Request failed');
        if (confirmedNoteEl) confirmedNoteEl.style.display = 'block';
      } catch (err) {
        showStatus('error', (err && err.message) || t('manage.errorMessage') || 'Something went wrong. Please try again, or call us directly.');
      } finally {
        confirmBtn.disabled = false;
      }
    });

    cancelBtn.addEventListener('click', async () => {
      if (!window.confirm(t('manage.confirmCancel') || 'Cancel this appointment?')) return;
      cancelBtn.disabled = true;
      try {
        const res = await fetch('/public/appointments/manage/' + encodeURIComponent(token) + '/cancel', { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Request failed');
        showStatus('success', t('manage.cancelledMessage') || 'Your appointment has been cancelled.');
        actionsEl.style.display = 'none';
        reschedulePanel.style.display = 'none';
      } catch (err) {
        showStatus('error', (err && err.message) || t('manage.errorMessage') || 'Something went wrong. Please try again, or call us directly.');
        cancelBtn.disabled = false;
      }
    });

    rescheduleBtn.addEventListener('click', () => {
      reschedulePanel.style.display = reschedulePanel.style.display === 'none' ? 'block' : 'none';
      if (reschedulePanel.style.display === 'block' && dateInput && !dateInput.value) {
        const todayStr = new Date().toISOString().slice(0, 10);
        const maxDate = new Date();
        maxDate.setDate(maxDate.getDate() + 60);
        dateInput.min = todayStr;
        dateInput.max = maxDate.toISOString().slice(0, 10);
        dateInput.value = todayStr;
        loadRescheduleSlots();
      }
    });

    function renderRescheduleSlots(slots) {
      slotsEl.innerHTML = '';
      selectedSlot = null;
      confirmRescheduleBtn.disabled = true;
      if (!slots.length) {
        const empty = document.createElement('span');
        empty.className = 'book-slots-empty';
        empty.textContent = t('book.noSlots') || 'No open times that day — try another date.';
        slotsEl.appendChild(empty);
        return;
      }
      slots.forEach((iso) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'book-slot';
        btn.textContent = new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
        btn.addEventListener('click', () => {
          selectedSlot = iso;
          slotsEl.querySelectorAll('.book-slot').forEach((b) => b.classList.remove('selected'));
          btn.classList.add('selected');
          confirmRescheduleBtn.disabled = false;
        });
        slotsEl.appendChild(btn);
      });
    }

    async function loadRescheduleSlots() {
      slotsEl.innerHTML = '<span class="book-slots-empty">' + (t('book.loading') || 'Loading…') + '</span>';
      confirmRescheduleBtn.disabled = true;
      try {
        // A reschedule keeps the appointment's existing duration (the server
        // enforces this regardless — see /manage/:token/reschedule) — passed
        // here too so the slot list previewed matches what will actually be
        // bookable, rather than defaulting to the firm-wide grid duration.
        let url = '/public/appointments/availability?date=' + encodeURIComponent(dateInput.value);
        if (currentAppt && currentAppt.startTime && currentAppt.endTime) {
          const durationMinutes = Math.round((new Date(currentAppt.endTime) - new Date(currentAppt.startTime)) / 60000);
          url += '&durationMinutes=' + durationMinutes;
        }
        // Without this, the client's own currently-booked slot (and any slot
        // overlapping it) always shows as unavailable when picking a new time on
        // the same day, even though the actual reschedule write path already
        // excludes this appointment from the clash check and would allow it.
        if (currentAppt && currentAppt.appointmentId) {
          url += '&excludeAppointmentId=' + encodeURIComponent(currentAppt.appointmentId);
        }
        const res = await fetch(url);
        const data = await res.json();
        renderRescheduleSlots(data.slots || []);
      } catch (err) {
        slotsEl.innerHTML = '<span class="book-slots-empty">' + (t('book.noSlots') || 'No open times that day — try another date.') + '</span>';
      }
    }
    if (dateInput) dateInput.addEventListener('change', loadRescheduleSlots);

    confirmRescheduleBtn.addEventListener('click', async () => {
      if (!selectedSlot) return;
      confirmRescheduleBtn.disabled = true;
      try {
        const res = await fetch('/public/appointments/manage/' + encodeURIComponent(token) + '/reschedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ startTime: selectedSlot }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Request failed');
        showStatus('success', t('manage.rescheduledMessage') || 'Your appointment has been rescheduled.');
        reschedulePanel.style.display = 'none';
        loadAppointment();
      } catch (err) {
        showStatus('error', (err && err.message) || t('manage.errorMessage') || 'Something went wrong. Please try again, or call us directly.');
        confirmRescheduleBtn.disabled = false;
      }
    });
  }

  document.querySelectorAll('.newsletter-form').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const emailInput = form.querySelector('input[type="email"]');
      const email = emailInput ? emailInput.value.trim() : '';
      if (!email) return;
      const btn = form.querySelector('button[type="submit"]');
      if (btn) btn.disabled = true;
      try {
        const res = await fetch('/public/newsletter/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        if (!res.ok) throw new Error('Request failed');
        alert(t('form.newsletterSuccess'));
        form.reset();
      } catch (err) {
        alert(t('form.newsletterError'));
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  });
});
