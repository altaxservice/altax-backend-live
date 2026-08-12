/**
 * Shared logic for the public website tools (Business Health Check, Entity
 * Comparison, Document Checklist). Loaded only on marketing-site/tools/*.html —
 * not sitewide — since translations.js + main.js already handle everything
 * every other page needs (nav, language toggle, deadline calendar).
 *
 * Every function here is gated on the presence of its target DOM element, the
 * same convention main.js already uses for the contact form — safe to run on
 * any tool page even though each page only has some of these elements.
 *
 * All scoring/comparison/filtering happens entirely client-side with whatever
 * the visitor typed into these pages — nothing is sent to the server until
 * they explicitly submit a lead form (name/email/phone + a summary of their
 * answers), which posts to /public/tools/lead. No tool ever asks for SSN,
 * EIN, bank details, or any real account information.
 */

// ---------------- Shared: lead-capture form wiring ----------------

/**
 * Wires a lead-capture <form> (name/email/phone + honeypot) to POST
 * /public/tools/lead. `getPayload()` is called at submit time to attach
 * whatever non-sensitive summary the tool wants to send along (quiz scores,
 * comparison inputs, selected checklist tags).
 */
function initToolLeadForm(formEl, toolName, getPayload) {
  if (!formEl) return;
  const statusEl = formEl.querySelector('.form-status');
  const submitBtn = formEl.querySelector('button[type="submit"]');
  const submitLabel = submitBtn ? submitBtn.querySelector('span') : null;
  const originalLabel = submitLabel ? submitLabel.textContent : '';

  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const honeypot = formEl.querySelector('[name="website"]');
    if (honeypot && honeypot.value) return; // bot — pretend nothing happened

    const nameEl = formEl.querySelector('[name="lead-name"]');
    const emailEl = formEl.querySelector('[name="lead-email"]');
    const phoneEl = formEl.querySelector('[name="lead-phone"]');

    if (statusEl) statusEl.style.display = 'none';
    if (submitBtn) submitBtn.disabled = true;
    if (submitLabel) submitLabel.textContent = t('tools.sending');

    try {
      const res = await fetch('/public/tools/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolName,
          name: nameEl ? nameEl.value.trim() : '',
          email: emailEl ? emailEl.value.trim() : '',
          phone: phoneEl ? phoneEl.value.trim() : '',
          payload: typeof getPayload === 'function' ? getPayload() : null,
          website: honeypot ? honeypot.value : '',
        }),
      });
      if (!res.ok) throw new Error('Request failed');
      if (statusEl) {
        statusEl.className = 'form-status success';
        statusEl.textContent = t('tools.leadSuccess');
        statusEl.style.display = 'block';
      }
      formEl.reset();
    } catch (err) {
      if (statusEl) {
        statusEl.className = 'form-status error';
        statusEl.textContent = t('tools.leadError');
        statusEl.style.display = 'block';
      }
    } finally {
      if (submitBtn) submitBtn.disabled = false;
      if (submitLabel) submitLabel.textContent = originalLabel || t('tools.getResults');
    }
  });
}

// ---------------- Business Health Check ----------------

const HEALTH_CHECK_QUESTIONS = [
  { id: 'q1', category: 'bookkeeping', textKey: 'health.q1', options: ['health.q1.o1', 'health.q1.o2', 'health.q1.o3', 'health.q1.o4'] },
  { id: 'q2', category: 'bookkeeping', textKey: 'health.q2', options: ['health.q2.o1', 'health.q2.o2', 'health.q2.o3', 'health.q2.o4'] },
  { id: 'q3', category: 'payroll', textKey: 'health.q3', options: ['health.q3.o1', 'health.q3.o2', 'health.q3.o3', 'health.q3.o4'] },
  { id: 'q4', category: 'payroll', textKey: 'health.q4', options: ['health.q4.o1', 'health.q4.o2', 'health.q4.o3', 'health.q4.o4'] },
  { id: 'q5', category: 'taxPlanning', textKey: 'health.q5', options: ['health.q5.o1', 'health.q5.o2', 'health.q5.o3', 'health.q5.o4'] },
  { id: 'q6', category: 'taxPlanning', textKey: 'health.q6', options: ['health.q6.o1', 'health.q6.o2', 'health.q6.o3', 'health.q6.o4'] },
  { id: 'q7', category: 'cashFlow', textKey: 'health.q7', options: ['health.q7.o1', 'health.q7.o2', 'health.q7.o3', 'health.q7.o4'] },
  { id: 'q8', category: 'cashFlow', textKey: 'health.q8', options: ['health.q8.o1', 'health.q8.o2', 'health.q8.o3', 'health.q8.o4'] },
];
const HEALTH_CATEGORIES = ['bookkeeping', 'payroll', 'taxPlanning', 'cashFlow'];
const HEALTH_MAX_PER_CATEGORY = 6; // 2 questions x max 3 points

function renderHealthCheckQuestions() {
  const container = document.getElementById('health-check-questions');
  if (!container) return;
  container.innerHTML = HEALTH_CHECK_QUESTIONS.map((q, i) => `
    <fieldset class="health-question">
      <legend>${i + 1}. <span data-i18n="${q.textKey}">${t(q.textKey)}</span></legend>
      <div class="health-options">
        ${q.options.map((optKey, idx) => `
          <label class="health-option">
            <input type="radio" name="${q.id}" value="${idx}" ${idx === 0 ? '' : ''} required>
            <span data-i18n="${optKey}">${t(optKey)}</span>
          </label>
        `).join('')}
      </div>
    </fieldset>
  `).join('');
}

function computeHealthCheckScores(form) {
  const scores = { bookkeeping: 0, payroll: 0, taxPlanning: 0, cashFlow: 0 };
  HEALTH_CHECK_QUESTIONS.forEach((q) => {
    const picked = form.querySelector(`input[name="${q.id}"]:checked`);
    if (picked) scores[q.category] += Number(picked.value);
  });
  const percentages = {};
  HEALTH_CATEGORIES.forEach((cat) => {
    percentages[cat] = Math.round((scores[cat] / HEALTH_MAX_PER_CATEGORY) * 100);
  });
  const overall = Math.round(HEALTH_CATEGORIES.reduce((sum, cat) => sum + percentages[cat], 0) / HEALTH_CATEGORIES.length);
  return { percentages, overall };
}

const HEALTH_CATEGORY_SERVICE_CTA = {
  bookkeeping: { labelKey: 'health.serviceBookkeeping', descKey: 'health.serviceBookkeepingDesc' },
  payroll: { labelKey: 'health.servicePayroll', descKey: 'health.servicePayrollDesc' },
  taxPlanning: { labelKey: 'health.serviceTaxPlanning', descKey: 'health.serviceTaxPlanningDesc' },
  cashFlow: { labelKey: 'health.serviceCashFlow', descKey: 'health.serviceCashFlowDesc' },
};

function renderHealthCheckResults(percentages, overall) {
  const resultsEl = document.getElementById('health-check-results');
  const scoreEl = document.getElementById('health-check-overall-score');
  const breakdownEl = document.getElementById('health-check-breakdown');
  const recsEl = document.getElementById('health-check-recommendations');
  if (!resultsEl) return;

  if (scoreEl) scoreEl.textContent = overall + '%';

  if (breakdownEl) {
    breakdownEl.innerHTML = HEALTH_CATEGORIES.map((cat) => `
      <div class="health-bar-row">
        <span class="health-bar-label" data-i18n="health.category.${cat}">${t('health.category.' + cat)}</span>
        <div class="health-bar-track"><div class="health-bar-fill" style="width:${percentages[cat]}%"></div></div>
        <span class="health-bar-pct">${percentages[cat]}%</span>
      </div>
    `).join('');
  }

  const weak = HEALTH_CATEGORIES.filter((cat) => percentages[cat] < 60);
  if (recsEl) {
    if (weak.length === 0) {
      recsEl.innerHTML = `<p class="health-strong-note" data-i18n="health.allStrong">${t('health.allStrong')}</p>`;
    } else {
      recsEl.innerHTML = weak.map((cat) => {
        const cta = HEALTH_CATEGORY_SERVICE_CTA[cat];
        return `
          <div class="health-rec-card">
            <h4 data-i18n="${cta.labelKey}">${t(cta.labelKey)}</h4>
            <p data-i18n="${cta.descKey}">${t(cta.descKey)}</p>
          </div>
        `;
      }).join('');
    }
  }

  resultsEl.style.display = 'block';
  resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function initBusinessHealthCheck() {
  const form = document.getElementById('health-check-form');
  if (!form) return;
  renderHealthCheckQuestions();
  applyLanguage(getLang()); // re-apply so the newly-rendered question text picks up the current language

  let lastScores = null;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const { percentages, overall } = computeHealthCheckScores(form);
    lastScores = { percentages, overall };
    renderHealthCheckResults(percentages, overall);
  });

  const leadForm = document.getElementById('health-check-lead-form');
  initToolLeadForm(leadForm, 'business-health-check', () => lastScores);
}

// ---------------- Entity Comparison ----------------

function computeEntitySuggestion(profit, owners, wantsSalary) {
  if (owners >= 2) return 'partnership-or-scorp';
  if (profit >= 40000 && wantsSalary) return 'scorp';
  return 'llc';
}

function initEntityComparison() {
  const form = document.getElementById('entity-comparison-form');
  if (!form) return;

  let lastInputs = null;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const profit = Number(form.querySelector('#entity-profit').value) || 0;
    const owners = Number(form.querySelector('#entity-owners').value) || 1;
    const wantsSalary = form.querySelector('#entity-salary').value === 'yes';
    const suggestion = computeEntitySuggestion(profit, owners, wantsSalary);
    lastInputs = { profit, owners, wantsSalary, suggestion };

    document.querySelectorAll('.entity-card').forEach((card) => {
      card.classList.toggle('entity-card-highlighted', card.getAttribute('data-entity') === suggestion);
    });
    const noteEl = document.getElementById('entity-suggestion-note');
    if (noteEl) {
      noteEl.textContent = t('entity.suggestion.' + suggestion);
      noteEl.style.display = 'block';
      noteEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });

  const leadForm = document.getElementById('entity-lead-form');
  initToolLeadForm(leadForm, 'entity-comparison', () => lastInputs);
}

// ---------------- Document Checklist ----------------

const CHECKLIST_ITEMS = [
  { tag: 'general', textKey: 'checklist.item.priorReturn' },
  { tag: 'general', textKey: 'checklist.item.photoId' },
  { tag: 'general', textKey: 'checklist.item.ssnCards' },
  { tag: 'general', textKey: 'checklist.item.bankInfo' },
  { tag: 'selfEmployed', textKey: 'checklist.item.1099s' },
  { tag: 'selfEmployed', textKey: 'checklist.item.businessIncome' },
  { tag: 'selfEmployed', textKey: 'checklist.item.businessExpenses' },
  { tag: 'selfEmployed', textKey: 'checklist.item.mileageLog' },
  { tag: 'selfEmployed', textKey: 'checklist.item.homeOffice' },
  { tag: 'newBusiness', textKey: 'checklist.item.einLetter' },
  { tag: 'newBusiness', textKey: 'checklist.item.articles' },
  { tag: 'newBusiness', textKey: 'checklist.item.operatingAgreement' },
  { tag: 'newBusiness', textKey: 'checklist.item.licenses' },
  { tag: 'property', textKey: 'checklist.item.closingStatement' },
  { tag: 'property', textKey: 'checklist.item.1098' },
  { tag: 'property', textKey: 'checklist.item.rentalRecords' },
  { tag: 'property', textKey: 'checklist.item.depreciationSchedule' },
  { tag: 'lifeChange', textKey: 'checklist.item.maritalDocs' },
  { tag: 'lifeChange', textKey: 'checklist.item.dependentSsn' },
  { tag: 'lifeChange', textKey: 'checklist.item.healthCoverage' },
  { tag: 'payroll', textKey: 'checklist.item.w2w3' },
  { tag: 'payroll', textKey: 'checklist.item.payrollDeposits' },
  { tag: 'payroll', textKey: 'checklist.item.contractor1099s' },
];

function renderChecklist(selectedTags) {
  const listEl = document.getElementById('checklist-results-list');
  if (!listEl) return;
  const items = CHECKLIST_ITEMS.filter((item) => item.tag === 'general' || selectedTags.includes(item.tag));
  listEl.innerHTML = items.map((item) => `<li data-i18n="${item.textKey}">${t(item.textKey)}</li>`).join('');
  const resultsEl = document.getElementById('checklist-results');
  if (resultsEl) resultsEl.style.display = items.length ? 'block' : 'none';
}

function initDocumentChecklist() {
  const form = document.getElementById('checklist-form');
  if (!form) return;

  let lastTags = [];
  form.addEventListener('change', () => {
    lastTags = Array.from(form.querySelectorAll('input[name="checklist-tag"]:checked')).map((el) => el.value);
    renderChecklist(lastTags);
  });
  renderChecklist([]); // baseline general items visible immediately, no gate

  const leadForm = document.getElementById('checklist-lead-form');
  initToolLeadForm(leadForm, 'document-checklist', () => ({ tags: lastTags }));
}

document.addEventListener('DOMContentLoaded', () => {
  initBusinessHealthCheck();
  initEntityComparison();
  initDocumentChecklist();
});
