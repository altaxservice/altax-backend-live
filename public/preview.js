const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbiIsInJvbGUiOiJhZG1pbiIsImVtYWlsIjoiYWx0YXhAYWxtYWJhcmlncm91cC5jb20iLCJpYXQiOjE3ODM1NjY0NTcsImV4cCI6MTc4NjE1ODQ1N30.E03If4l-o7rKJRDJ0CL5sXWUUDKFPLL7JFV3EkSpNlc";

async function api(path) {
  const res = await fetch(path, { headers: { Authorization: "Bearer " + TOKEN } });
  if (!res.ok) throw new Error((await res.json()).error || res.statusText);
  return res.json();
}

function fmtDate(v) {
  if (!v) return "—";
  return new Date(v).toLocaleDateString();
}

function fmtDateTime(v) {
  if (!v) return "—";
  return new Date(v).toLocaleString();
}

function fmtMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function badge(text) {
  return `<span class="badge">${text || "—"}</span>`;
}

function fillTable(tableId, moreId, rows, limit, mapper, total) {
  const tbody = document.querySelector("#" + tableId + " tbody");
  const shown = rows.slice(0, limit);
  if (!shown.length) {
    tbody.innerHTML = `<tr><td colspan="10"><div class="empty">No records.</div></td></tr>`;
  } else {
    tbody.innerHTML = shown.map(r => "<tr>" + mapper(r).map(c => "<td>" + c + "</td>").join("") + "</tr>").join("");
  }
  const totalCount = total !== undefined ? total : rows.length;
  document.getElementById(moreId).textContent =
    totalCount > shown.length ? `Showing ${shown.length} of ${totalCount}.` : `${totalCount} total.`;
}

function setStats(entries) {
  document.getElementById("stats").innerHTML = entries
    .map(([label, num]) => `<div class="card"><div class="num">${num}</div><div class="label">${label}</div></div>`)
    .join("");
}

function setupTabs() {
  const tabs = document.querySelectorAll(".tab");
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById("panel-" + tab.dataset.panel).classList.add("active");
    });
  });
}

async function loadClientsAndTasks() {
  const [{ clients }, { tasks }] = await Promise.all([api("/clients"), api("/tasks")]);

  fillTable("clientsTable", "clientsMore", clients, 25, c => [
    c.client_name || "—", badge(c.status), c.entity_type || "—", c.assigned_to || "—",
    c.portal_enabled ? "Enabled" : "—",
  ]);

  fillTable("tasksTable", "tasksMore", tasks, 25, t => [
    t.task_name || "—", t.client_name || "—", badge(t.status), t.assigned_to || "—", fmtDate(t.agency_due_date),
  ]);

  const openTasks = tasks.filter(t => !["completed", "void", "closed"].includes(String(t.status || "").toLowerCase())).length;
  return { clients, tasks, openTasks };
}

async function loadDocuments() {
  const [{ requests }, { uploads }] = await Promise.all([
    api("/documents/requests").catch(() => ({ requests: [] })),
    api("/documents/uploads").catch(() => ({ uploads: [] })),
  ]);

  fillTable("docRequestsTable", "docRequestsMore", requests, 20, r => [
    r.requested_item || "—", r.client_name || "—", badge(r.status), r.priority || "—", r.due_from_client || "—",
  ]);
  fillTable("docUploadsTable", "docUploadsMore", uploads, 20, u => [
    u.file_name || "—", u.client_name || "—", u.direction || "—", badge(u.status), fmtDateTime(u.uploaded_at),
  ]);

  return { requests, uploads };
}

async function loadBilling() {
  const { invoices } = await api("/billing/invoices").catch(() => ({ invoices: [] }));

  fillTable("invoicesTable", "invoicesMore", invoices, 20, i => [
    i.invoice_id, i.client_id || "—", fmtMoney(i.total_amount), fmtMoney(i.balance_due), badge(i.status),
  ]);

  const unpaid = invoices.filter(i => Number(i.balance_due) > 0).length;
  return { invoices, unpaid };
}

async function loadCommunications() {
  const { communications } = await api("/communications").catch(() => ({ communications: [] }));

  fillTable("commsTable", "commsMore", communications, 20, c => [
    c.subject || "—", c.client_name || "—", c.channel || "—", c.direction || "—", fmtDateTime(c.sent_at),
  ]);

  return { communications };
}

async function loadAccounting() {
  const [{ accounts }, { taxRates }] = await Promise.all([
    api("/accounting/coa").catch(() => ({ accounts: [] })),
    api("/accounting/tax-rates").catch(() => ({ taxRates: [] })),
  ]);

  fillTable("coaTable", "coaMore", accounts, 25, a => [
    a.account_name || "—", a.account_type || "—", a.normal_balance || "—", a.active ? "Yes" : "No",
  ]);
  fillTable("taxRatesTable", "taxRatesMore", taxRates, 25, r => [
    r.rate_type || "—", r.scope || "—", r.rate ?? "—", r.state || "—", r.active ? "Yes" : "No",
  ]);
}

async function loadRules() {
  const [{ rules }, { batches }] = await Promise.all([
    api("/rules").catch(() => ({ rules: [] })),
    api("/rules/batches").catch(() => ({ batches: [] })),
  ]);

  fillTable("rulesTable", "rulesMore", rules, 25, r => [
    r.task_type || "—", r.trigger_column ? `${r.trigger_column} = ${r.trigger_value}` : "Manual selection", r.frequency || "—", r.active ? "Yes" : "No",
  ]);
  fillTable("batchesTable", "batchesMore", batches, 15, b => [
    b.task_type || "—", b.period_label || "—", fmtDateTime(b.created_at), b.created_by || "—",
  ]);
}

async function main() {
  setupTabs();
  try {
    const [{ clients, tasks, openTasks }, { requests }, { invoices, unpaid }] = await Promise.all([
      loadClientsAndTasks(), loadDocuments(), loadBilling(), loadCommunications(), loadAccounting(), loadRules(),
    ]);

    setStats([
      ["Total Clients", clients.length],
      ["Total Tasks", tasks.length],
      ["Open Tasks", openTasks],
      ["Open Requests", requests.filter(r => !["closed", "void", "archived"].includes(String(r.status || "").toLowerCase())).length],
      ["Unpaid Invoices", unpaid],
    ]);
  } catch (err) {
    document.body.insertAdjacentHTML("afterbegin", `<p class="error">Could not load data: ${err.message}. Is the server running and connected to the database?</p>`);
  }
}

main();
