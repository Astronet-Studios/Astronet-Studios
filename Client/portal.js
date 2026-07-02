let supabaseClient;
let authSession;
let currentMode = 'client';
let adminClientState = [];
let adminInvoiceState = [];
let adminContractState = [];
let adminSearchFilters = {
  clients: '',
  invoices: '',
  contracts: '',
};

const maintenanceTierLabels = {
  'Tier 1 - Basic Care': 'Tier 1 - Basic Care ($49/month)',
  'Tier 2 - Growth Care': 'Tier 2 - Growth Care ($149/month)',
  'Tier 3 - Business Care': 'Tier 3 - Business Care ($299/month)',
  'Tier 4 - Full Management': 'Tier 4 - Full Management ($499-$1,200/month)',
};

const maintenanceTierAmounts = {
  'Tier 1 - Basic Care': 49,
  'Tier 2 - Growth Care': 149,
  'Tier 3 - Business Care': 299,
};

const siteTypeBasePricing = {
  'Starter Website': 1000,
  'Business Website': 2500,
  'Premium Website': 5000,
  'E-Commerce Website': 1500,
  'Landing Page': 1200,
  'Custom Web App': 5000,
};

const extraPageTypePricing = {
  'Simple Page': 150,
  'Service/Product Page': 225,
  'Blog/Article Template': 300,
  'Landing Page': 500,
  'Portfolio/Gallery Page': 550,
  'Custom Interactive Page': 1000,
};

const extraFeatureTypePricing = {
  'Product Upload (Shopify)': 10,
  'App Integrations': 250,
  'Advanced Forms': 325,
  'Custom Animations': 375,
  'SEO Setup': 500,
  'Booking System': 750,
  'Branding Package': 600,
  'Membership/Login System': 1800,
  'Custom Dashboard': 2500,
};

const extraPageTypeOptions = Object.keys(extraPageTypePricing);
const extraFeatureTypeOptions = Object.keys(extraFeatureTypePricing);

document.addEventListener('DOMContentLoaded', async () => {
  const page = document.body.dataset.page;

  try {
    const configResponse = await fetch('/api/config');
    const config = await readJsonResponse(configResponse, 'Unable to load portal configuration.');

    if (!configResponse.ok) {
      throw new Error(config.error || 'Portal API is unavailable. Deploy the Node server and confirm /api/config is reachable.');
    }

    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      setMessage(document.querySelector('.form-message') || document.body, 'Configure Supabase environment variables before using the portal.', true);
      return;
    }

    supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    const { data } = await supabaseClient.auth.getSession();
    authSession = data.session;

    if (page === 'login') {
      initLoginPage();
      if (authSession) {
        await redirectForRole();
      }
      return;
    }

    if (!authSession) {
      window.location.href = 'portal-login.html';
      return;
    }

    if (page === 'client-dashboard') {
      await initClientDashboard();
      return;
    }

    if (page === 'admin-dashboard') {
      await initAdminDashboard();
    }
  } catch (error) {
    console.error(error);
    setMessage(document.querySelector('.form-message') || document.body, error.message || 'Unable to load portal.', true);
  }
});

function setMessage(target, message, isError = false) {
  if (!target) {
    return;
  }

  target.textContent = message;
  target.classList.toggle('is-error', isError);
  target.classList.toggle('is-success', !isError && Boolean(message));
}

async function readJsonResponse(response, fallbackMessage) {
  const raw = await response.text();

  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch (_error) {
    if (!response.ok) {
      throw new Error(`${fallbackMessage} Server returned ${response.status} ${response.statusText}.`);
    }

    throw new Error(fallbackMessage);
  }
}

async function fetchWithAuth(path, options = {}) {
  const sendRequest = async () => {
    const { data } = await supabaseClient.auth.getSession();
    authSession = data.session;

    return fetch(path, {
      ...options,
      headers: {
        Authorization: `Bearer ${authSession?.access_token || ''}`,
        ...(options.headers || {}),
      },
    });
  };

  let response = await sendRequest();

  if (response.status === 401) {
    const { data, error } = await supabaseClient.auth.refreshSession();

    if (!error && data.session) {
      authSession = data.session;
      response = await sendRequest();
    }
  }

  return response;
}

async function apiFetch(path, options = {}) {
  const response = await fetchWithAuth(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (response.status === 204) {
    return null;
  }

  const payload = await readJsonResponse(response, 'Request failed.');
  if (!response.ok) {
    throw new Error(payload.error || 'Request failed.');
  }

  return payload;
}

async function openProtectedPdf(path) {
  const response = await fetchWithAuth(path);

  if (!response.ok) {
    const payload = await readJsonResponse(response, 'Unable to load PDF.');
    throw new Error(payload.error || 'Unable to load PDF.');
  }

  const blob = await response.blob();
  const fileUrl = URL.createObjectURL(blob);
  window.open(fileUrl, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(fileUrl), 45000);
}

async function redirectForRole(preferredMode) {
  const me = await apiFetch('/api/me');
  const role = me.user.profile.role;

  if (preferredMode === 'admin' && role !== 'admin') {
    throw new Error('This account is not allowed into the admin dashboard.');
  }

  window.location.href = role === 'admin' ? 'admin.html' : 'dashboard.html';
}

function initLoginPage() {
  const modeButtons = Array.from(document.querySelectorAll('.mode-button'));
  const loginForm = document.getElementById('login-form');
  const loginMessage = document.getElementById('login-message');

  modeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      currentMode = button.dataset.mode;
      modeButtons.forEach((item) => item.classList.toggle('active', item === button));
    });
  });

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setMessage(loginMessage, 'Signing in...');

    const formData = new FormData(loginForm);
    const email = formData.get('email');
    const password = formData.get('password');

    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
      setMessage(loginMessage, error.message, true);
      return;
    }

    try {
      await redirectForRole(currentMode);
    } catch (redirectError) {
      await supabaseClient.auth.signOut();
      setMessage(loginMessage, redirectError.message, true);
    }
  });
}

async function initClientDashboard() {
  const me = await apiFetch('/api/me');
  if (me.user.profile.role !== 'client') {
    window.location.href = 'admin.html';
    return;
  }

  document.getElementById('dashboard-user').textContent = me.user.profile.company_name || me.user.email;
  bindLogout();

  const data = await apiFetch('/api/me/dashboard');
  renderClientDashboard(data);
  bindClientForms();
}

function renderClientDashboard(data) {
  document.getElementById('website-status').textContent = capitalize(data.clientAccount.website_status);
  document.getElementById('website-url').textContent = data.clientAccount.website_url || 'Website URL not added yet.';
  document.getElementById('subscription-plan').textContent = formatMaintenanceTier(data.clientAccount.subscription_plan);

  const unpaidTotal = data.openInvoices.reduce((sum, invoice) => sum + Number(invoice.amount_dollars || 0), 0);
  document.getElementById('invoice-balance').textContent = formatCurrency(unpaidTotal);
  document.getElementById('invoice-balance-caption').textContent = data.openInvoices.length
    ? `${data.openInvoices.length} unpaid invoice${data.openInvoices.length === 1 ? '' : 's'} | ${data.contracts?.length || 0} contract${(data.contracts?.length || 0) === 1 ? '' : 's'} on file`
    : `No unpaid invoices | ${data.contracts?.length || 0} contract${(data.contracts?.length || 0) === 1 ? '' : 's'} on file`;

  const invoiceShell = document.getElementById('client-invoices');
  if (!data.invoices.length) {
    invoiceShell.innerHTML = '<p class="muted-copy">No invoices yet.</p>';
    return;
  }

  invoiceShell.innerHTML = `
    <table class="portal-table">
      <thead>
        <tr>
          <th>Invoice</th>
          <th>Status</th>
          <th>Amount</th>
          <th>Due</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${data.invoices.map((invoice) => `
          <tr>
            <td>
              <strong>${invoice.invoice_number}</strong>
              <div class="table-subcopy">${formatInvoiceDescription(invoice.description)}</div>
            </td>
            <td><span class="status-pill status-${invoice.status}">${capitalize(invoice.status)}</span></td>
            <td>${formatCurrency(invoice.amount_dollars)}</td>
            <td>${invoice.due_date || 'N/A'}</td>
            <td>
              <div class="table-button-row">
                <button type="button" class="btn btn-secondary btn-small view-invoice-pdf-button" data-invoice-id="${invoice.id}">View Full Invoice</button>
                ${invoice.square_payment_link_url ? `<a class="btn btn-secondary btn-small" href="${invoice.square_payment_link_url}" target="_blank" rel="noopener noreferrer">Pay Invoice</a>` : invoice.status !== 'paid' ? `<button type="button" class="btn btn-secondary btn-small pay-link-button" data-invoice-id="${invoice.id}">Pay Invoice</button>` : '<span class="muted-copy">Paid</span>'}
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  invoiceShell.querySelectorAll('.pay-link-button').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = 'Preparing...';
      try {
        const payload = await apiFetch(`/api/me/invoices/${button.dataset.invoiceId}/payment-link`, { method: 'POST' });
        if (payload.warning) {
          alert(payload.warning);
        }
        if (payload.url) {
          window.open(payload.url, '_blank', 'noopener');
        }
      } catch (error) {
        alert(error.message);
      } finally {
        button.disabled = false;
        button.textContent = 'Pay Invoice';
      }
    });
  });

  invoiceShell.querySelectorAll('.view-invoice-pdf-button').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await openProtectedPdf(`/api/invoices/${button.dataset.invoiceId}/pdf`);
      } catch (error) {
        alert(error.message);
      }
    });
  });
}

function bindClientForms() {
  const changeRequestForm = document.getElementById('change-request-form');
  const supportForm = document.getElementById('support-form');
  const subscriptionForm = document.getElementById('subscription-form');

  changeRequestForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await submitPortalForm(changeRequestForm, '/api/me/change-requests', 'change-request-message', 'Change request submitted.');
  });

  supportForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await submitPortalForm(supportForm, '/api/me/questions', 'support-message', 'Question submitted.');
  });

  subscriptionForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await submitPortalForm(subscriptionForm, '/api/me/subscription-change', 'subscription-message', 'Subscription change request submitted.');
  });
}

async function submitPortalForm(form, path, messageId, successMessage) {
  const messageNode = document.getElementById(messageId);
  setMessage(messageNode, 'Submitting...');

  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  try {
    await apiFetch(path, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    form.reset();
    setMessage(messageNode, successMessage);
  } catch (error) {
    setMessage(messageNode, error.message, true);
  }
}

async function initAdminDashboard() {
  const me = await apiFetch('/api/me');
  if (me.user.profile.role !== 'admin') {
    window.location.href = 'dashboard.html';
    return;
  }

  document.getElementById('admin-user').textContent = me.user.profile.full_name || me.user.email;
  bindLogout();

  await loadAdminOverview();
  bindAdminFilters();
  bindAdminForms();
}

async function loadAdminOverview() {
  const data = await apiFetch('/api/admin/overview');
  adminClientState = data.clients;
  adminInvoiceState = data.invoices || [];
  adminContractState = data.contracts || [];
  applyAdminRecordFilters();

  renderRequestList('admin-change-requests', data.changeRequests, (item) => `
    <h3>${item.title}</h3>
    <p>${item.description}</p>
    <span class="status-pill status-${item.status}">${capitalize(item.status)}</span>
  `);
  renderRequestList('admin-support-questions', data.supportQuestions, (item) => `
    <h3>${item.subject}</h3>
    <p>${item.message}</p>
    <span class="status-pill status-${item.status}">${capitalize(item.status)}</span>
  `);
  renderRequestList('admin-subscription-requests', data.subscriptionRequests, (item) => `
    <h3>${formatMaintenanceTier(item.requested_plan)}</h3>
    <p>Current plan: ${item.current_plan ? formatMaintenanceTier(item.current_plan) : 'Unknown'}</p>
    <p>${item.notes || 'No extra notes.'}</p>
    <span class="status-pill status-${item.status}">${capitalize(item.status)}</span>
  `);

  const invoiceSelect = document.getElementById('invoice-client-select');
  const contractSelect = document.getElementById('contract-client-select');
  const options = adminClientState.map((client) => `<option value="${client.id}">${client.profile.company_name || client.profile.email}</option>`).join('');
  invoiceSelect.innerHTML = options;
  contractSelect.innerHTML = options;
}

function normalizeSearchValue(value) {
  return String(value || '').trim().toLowerCase();
}

function clientDisplayName(client) {
  return (client?.profile?.company_name || client?.profile?.full_name || '').trim();
}

function bindAdminFilters() {
  const clientSearchInput = document.getElementById('admin-client-search');
  const invoiceSearchInput = document.getElementById('admin-invoice-search');
  const contractSearchInput = document.getElementById('admin-contract-search');

  if (!clientSearchInput || !invoiceSearchInput || !contractSearchInput) {
    return;
  }

  clientSearchInput.addEventListener('input', (event) => {
    adminSearchFilters.clients = event.target.value || '';
    applyAdminRecordFilters();
  });

  invoiceSearchInput.addEventListener('input', (event) => {
    adminSearchFilters.invoices = event.target.value || '';
    applyAdminRecordFilters();
  });

  contractSearchInput.addEventListener('input', (event) => {
    adminSearchFilters.contracts = event.target.value || '';
    applyAdminRecordFilters();
  });
}

function applyAdminRecordFilters() {
  const clientQuery = normalizeSearchValue(adminSearchFilters.clients);
  const invoiceQuery = normalizeSearchValue(adminSearchFilters.invoices);
  const contractQuery = normalizeSearchValue(adminSearchFilters.contracts);

  const filteredClients = adminClientState.filter((client) => {
    if (!clientQuery) {
      return true;
    }

    return clientDisplayName(client).toLowerCase().includes(clientQuery);
  });

  const clientsById = new Map(adminClientState.map((client) => [client.id, client]));

  const filteredInvoices = adminInvoiceState.filter((invoice) => {
    if (!invoiceQuery) {
      return true;
    }

    const invoiceNumber = String(invoice.invoice_number || '').toLowerCase();
    const invoiceClientName = clientDisplayName(clientsById.get(invoice.client_id)).toLowerCase();
    return invoiceNumber.includes(invoiceQuery) || invoiceClientName.includes(invoiceQuery);
  });

  const filteredContracts = adminContractState.filter((contract) => {
    if (!contractQuery) {
      return true;
    }

    const contractNumber = String(contract.contract_number || '').toLowerCase();
    const contractClientName = clientDisplayName(clientsById.get(contract.client_id)).toLowerCase();
    return contractNumber.includes(contractQuery) || contractClientName.includes(contractQuery);
  });

  renderAdminClients(filteredClients, {
    isFiltered: Boolean(clientQuery),
  });
  renderAdminInvoices(filteredInvoices, adminClientState, {
    isFiltered: Boolean(invoiceQuery),
  });
  renderAdminContracts(filteredContracts, adminClientState, {
    isFiltered: Boolean(contractQuery),
  });
}

function renderAdminClients(clients, options = {}) {
  const shell = document.getElementById('admin-clients');

  if (!clients.length) {
    shell.innerHTML = options.isFiltered
      ? '<p class="muted-copy">No clients match this search.</p>'
      : '<p class="muted-copy">No clients yet.</p>';
    return;
  }

  shell.innerHTML = `
    <table class="portal-table">
      <thead>
        <tr>
          <th>Client</th>
          <th>Website</th>
          <th>Plan</th>
          <th>Documents</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${clients.map((client) => `
          <tr>
            <td>
              <strong>${client.profile.company_name || 'Untitled Client'}</strong>
              <div class="table-subcopy">${client.profile.email}</div>
            </td>
            <td>
              <span class="status-pill status-${client.website_status}">${capitalize(client.website_status)}</span>
              <div class="table-subcopy">${client.website_url || 'No URL added'}</div>
            </td>
            <td>${formatMaintenanceTier(client.subscription_plan)}</td>
            <td>${client.invoice_count} invoice${client.invoice_count === 1 ? '' : 's'} | ${client.contract_count || 0} contract${(client.contract_count || 0) === 1 ? '' : 's'}</td>
            <td>
              <div class="table-button-row">
                <button type="button" class="btn btn-secondary btn-small edit-client-button" data-client-id="${client.id}">Edit</button>
                <button type="button" class="btn btn-secondary btn-small delete-client-button" data-client-id="${client.id}">Delete</button>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  shell.querySelectorAll('.edit-client-button').forEach((button) => {
    button.addEventListener('click', () => populateClientForm(button.dataset.clientId));
  });

  shell.querySelectorAll('.delete-client-button').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!confirm('Delete this client and their auth account?')) {
        return;
      }

      try {
        await apiFetch(`/api/admin/clients/${button.dataset.clientId}`, { method: 'DELETE' });
        await loadAdminOverview();
      } catch (error) {
        alert(error.message);
      }
    });
  });
}

function renderAdminInvoices(invoices, clients, options = {}) {
  const clientsById = new Map(clients.map((client) => [client.id, client]));
  const shell = document.getElementById('admin-invoices');

  if (!invoices.length) {
    shell.innerHTML = options.isFiltered
      ? '<p class="muted-copy">No invoices match this search.</p>'
      : '<p class="muted-copy">No invoices yet.</p>';
    return;
  }

  shell.innerHTML = `
    <table class="portal-table">
      <thead>
        <tr>
          <th>Invoice</th>
          <th>Client</th>
          <th>Status</th>
          <th>Amount</th>
          <th>Due</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${invoices.map((invoice) => {
          const client = clientsById.get(invoice.client_id);
          return `
            <tr>
              <td>
                <strong>${invoice.invoice_number}</strong>
                <div class="table-subcopy">${formatInvoiceDescription(invoice.description)}</div>
              </td>
              <td>${client?.profile.company_name || 'Unknown client'}</td>
              <td><span class="status-pill status-${invoice.status}">${capitalize(invoice.status)}</span></td>
              <td>${formatCurrency(invoice.amount_dollars)}</td>
              <td>${invoice.due_date || 'N/A'}</td>
              <td>
                <div class="table-button-row">
                  <button type="button" class="btn btn-secondary btn-small admin-view-invoice-button" data-invoice-id="${invoice.id}">View Full Invoice</button>
                  ${invoice.status !== 'paid' ? `<button type="button" class="btn btn-secondary btn-small mark-paid-button" data-invoice-id="${invoice.id}">Mark Paid</button>` : '<span class="muted-copy">Settled</span>'}
                </div>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;

  shell.querySelectorAll('.mark-paid-button').forEach((button) => {
    button.addEventListener('click', async () => {
      const invoice = invoices.find((entry) => entry.id === button.dataset.invoiceId);
      try {
        await apiFetch(`/api/admin/invoices/${invoice.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            description: invoice.description,
            amountDollars: invoice.amount_dollars,
            currency: invoice.currency,
            dueDate: invoice.due_date,
            status: 'paid',
          }),
        });
        await loadAdminOverview();
      } catch (error) {
        alert(error.message);
      }
    });
  });

  shell.querySelectorAll('.admin-view-invoice-button').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await openProtectedPdf(`/api/invoices/${button.dataset.invoiceId}/pdf`);
      } catch (error) {
        alert(error.message);
      }
    });
  });
}

function renderAdminContracts(contracts, clients, options = {}) {
  const clientsById = new Map(clients.map((client) => [client.id, client]));
  const shell = document.getElementById('admin-contracts');

  if (!shell) {
    return;
  }

  if (!contracts.length) {
    shell.innerHTML = options.isFiltered
      ? '<p class="muted-copy">No contracts match this search.</p>'
      : '<p class="muted-copy">No contracts yet.</p>';
    return;
  }

  shell.innerHTML = `
    <table class="portal-table">
      <thead>
        <tr>
          <th>Contract</th>
          <th>Client</th>
          <th>Status</th>
          <th>Total</th>
          <th>Deductible Due</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${contracts.map((contract) => {
          const client = clientsById.get(contract.client_id);
          const contractStatus = contract.esign_status || contract.status;
          return `
            <tr>
              <td>
                <strong>${contract.contract_number}</strong>
                <div class="table-subcopy">${contract.project_title}</div>
              </td>
              <td>${client?.profile.company_name || 'Unknown client'}</td>
              <td><span class="status-pill status-${contractStatus}">${capitalize(contractStatus)}</span></td>
              <td>${formatCurrency(contract.total_cost_dollars)}</td>
              <td>${formatCurrency(contract.deductible_due_dollars)}</td>
              <td>
                <div class="table-button-row">
                  <button type="button" class="btn btn-secondary btn-small view-contract-pdf-button" data-contract-id="${contract.id}">View Contract</button>
                  ${contract.esign_signature_request_id ? `<button type="button" class="btn btn-secondary btn-small view-executed-contract-button" data-contract-id="${contract.id}">View Executed</button>` : ''}
                </div>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;

  shell.querySelectorAll('.view-contract-pdf-button').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await openProtectedPdf(`/api/contracts/${button.dataset.contractId}/pdf`);
      } catch (error) {
        alert(error.message);
      }
    });
  });

  shell.querySelectorAll('.view-executed-contract-button').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await openProtectedPdf(`/api/contracts/${button.dataset.contractId}/executed-pdf`);
      } catch (error) {
        alert(error.message);
      }
    });
  });
}

function renderRequestList(containerId, items, template) {
  const shell = document.getElementById(containerId);
  if (!items.length) {
    shell.innerHTML = '<p class="muted-copy">Nothing submitted yet.</p>';
    return;
  }

  shell.innerHTML = items.map((item) => `<article class="request-card">${template(item)}</article>`).join('');
}

function parsePositiveCount(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function buildInvoiceOptionTypeMarkup(options, selectedValue = '') {
  const optionRows = options
    .map((entry) => `<option value="${entry}" ${entry === selectedValue ? 'selected' : ''}>${entry}</option>`)
    .join('');

  return `<option value="">Select type</option>${optionRows}`;
}

function createInvoiceOptionRow(kind, selectedType = '', selectedCount = 1) {
  const wrapper = document.createElement('div');
  wrapper.className = 'multi-option-row';
  wrapper.dataset.kind = kind;

  const options = kind === 'pages' ? extraPageTypeOptions : extraFeatureTypeOptions;
  const typeMarkup = buildInvoiceOptionTypeMarkup(options, selectedType);
  wrapper.innerHTML = `
    <label>
      <span>${kind === 'pages' ? 'Page Type' : 'Feature Type'}</span>
      <select class="invoice-option-type">${typeMarkup}</select>
    </label>
    <label>
      <span>Count</span>
      <input type="number" class="invoice-option-count" min="1" value="${Math.max(1, parsePositiveCount(selectedCount) || 1)}" />
    </label>
    <button type="button" class="btn btn-secondary btn-small remove-option-row">Remove</button>
  `;

  return wrapper;
}

function collectInvoiceOptionSelections(container) {
  if (!container) {
    return [];
  }

  return Array.from(container.querySelectorAll('.multi-option-row'))
    .map((row) => {
      const type = row.querySelector('.invoice-option-type')?.value || '';
      const count = parsePositiveCount(row.querySelector('.invoice-option-count')?.value || 0);
      return { type: type.trim(), count };
    })
    .filter((entry) => entry.type && entry.count > 0);
}

function mergeInvoiceOptionSelections(selections) {
  if (!Array.isArray(selections) || !selections.length) {
    return [];
  }

  const totalsByType = new Map();

  selections.forEach((entry) => {
    const type = String(entry.type || '').trim();
    const count = parsePositiveCount(entry.count);
    if (!type || count <= 0) {
      return;
    }

    const current = totalsByType.get(type) || 0;
    totalsByType.set(type, current + count);
  });

  return Array.from(totalsByType.entries()).map(([type, count]) => ({ type, count }));
}

function summarizeInvoiceOptionSelections(label, selections) {
  const mergedSelections = mergeInvoiceOptionSelections(selections);
  if (!mergedSelections.length) {
    return null;
  }

  const summary = mergedSelections
    .map((entry) => `${entry.type} x${entry.count}`)
    .join(', ');
  return `${label}: ${summary}`;
}

function buildInvoiceLineItems(payload) {
  const lineItems = [];

  const siteBase = siteTypeBasePricing[payload.siteType] || 0;
  if (siteBase > 0) {
    lineItems.push({
      name: `${payload.siteType} base build`,
      quantity: 1,
      unitPrice: siteBase,
      total: siteBase,
    });
  }

  const maintenanceAmount = maintenanceTierAmounts[payload.maintenanceTier] || 0;
  if (maintenanceAmount > 0) {
    lineItems.push({
      name: `${payload.maintenanceTier} (monthly)`,
      quantity: 1,
      unitPrice: maintenanceAmount,
      total: maintenanceAmount,
    });
  }

  const pageSelections = mergeInvoiceOptionSelections(payload.extraPageSelections);
  if (pageSelections.length) {
    pageSelections.forEach((entry) => {
      const unit = extraPageTypePricing[entry.type] || 0;
      if (entry.count > 0 && unit > 0) {
        lineItems.push({
          name: `${entry.type} extra pages`,
          quantity: entry.count,
          unitPrice: unit,
          total: entry.count * unit,
        });
      }
    });
  } else {
    const extraPagesCount = Number(payload.extraPagesCount || 0);
    const pageUnit = extraPageTypePricing[payload.extraPagesType] || 0;
    if (extraPagesCount > 0 && pageUnit > 0) {
      lineItems.push({
        name: `${payload.extraPagesType} extra pages`,
        quantity: extraPagesCount,
        unitPrice: pageUnit,
        total: extraPagesCount * pageUnit,
      });
    }
  }

  const featureSelections = mergeInvoiceOptionSelections(payload.extraFeatureSelections);
  if (featureSelections.length) {
    featureSelections.forEach((entry) => {
      const unit = extraFeatureTypePricing[entry.type] || 0;
      if (entry.count > 0 && unit > 0) {
        lineItems.push({
          name: `${entry.type} feature work`,
          quantity: entry.count,
          unitPrice: unit,
          total: entry.count * unit,
        });
      }
    });
  } else {
    const extraFeaturesCount = Number(payload.extraFeaturesCount || 0);
    const featureUnit = extraFeatureTypePricing[payload.extraFeaturesType] || 0;
    if (extraFeaturesCount > 0 && featureUnit > 0) {
      lineItems.push({
        name: `${payload.extraFeaturesType} feature work`,
        quantity: extraFeaturesCount,
        unitPrice: featureUnit,
        total: extraFeaturesCount * featureUnit,
      });
    }
  }

  const additionalAmount = Number(payload.additionalAmountDollars || 0);
  if (additionalAmount > 0) {
    lineItems.push({
      name: 'Additional custom work',
      quantity: 1,
      unitPrice: additionalAmount,
      total: additionalAmount,
    });
  }

  return lineItems;
}

function calculateInvoiceTotals(payload) {
  const lineItems = buildInvoiceLineItems(payload);
  const subtotal = lineItems.reduce((sum, item) => sum + Number(item.total || 0), 0);
  const tax = Number(payload.taxDollars || 0);
  const total = subtotal + tax;

  return {
    lineItems,
    subtotal,
    tax,
    total,
  };
}

function parseMoneyInput(value) {
  const parsed = Number(String(value || '').replace(/[$,\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function renderInvoicePricingPreview(totals) {
  const preview = document.getElementById('invoice-pricing-preview');
  if (!preview) {
    return;
  }

  const rows = totals.lineItems.length
    ? totals.lineItems.map((item) => `
        <div class="invoice-pricing-row">
          <span>${item.name} x ${item.quantity}</span>
          <strong>${formatCurrency(item.total)}</strong>
        </div>
      `).join('')
    : '<p class="muted-copy">Select a maintenance tier and options to build the invoice price.</p>';

  preview.innerHTML = `
    <p class="invoice-pricing-title">Live Price Breakdown</p>
    ${rows}
    <div class="invoice-pricing-row total-row">
      <span>Subtotal</span>
      <strong>${formatCurrency(totals.subtotal)}</strong>
    </div>
    <div class="invoice-pricing-row total-row">
      <span>Tax</span>
      <strong>${formatCurrency(totals.tax)}</strong>
    </div>
    <div class="invoice-pricing-row grand-total-row">
      <span>Total</span>
      <strong>${formatCurrency(totals.total)}</strong>
    </div>
  `;
}

function applyManualInvoiceTotalPreview(totals, manualFinalTotal) {
  const adjustedTotals = {
    ...totals,
    lineItems: [...totals.lineItems],
    subtotal: totals.subtotal,
    total: manualFinalTotal,
  };

  const adjustment = Number((manualFinalTotal - totals.total).toFixed(2));
  if (Math.abs(adjustment) > 0.001) {
    adjustedTotals.lineItems.push({
      name: 'Manual final total adjustment',
      quantity: 1,
      total: adjustment,
    });
    adjustedTotals.subtotal = Number((totals.subtotal + adjustment).toFixed(2));
  }

  renderInvoicePricingPreview(adjustedTotals);
}

function bindAdminForms() {
  const clientForm = document.getElementById('client-form');
  const invoiceForm = document.getElementById('invoice-form');
  const contractForm = document.getElementById('contract-form');
  const resetButton = document.getElementById('client-form-reset');
  const extraPagesRows = document.getElementById('extra-pages-rows');
  const extraFeaturesRows = document.getElementById('extra-features-rows');
  const addExtraPageTypeButton = document.getElementById('add-extra-page-type');
  const addExtraFeatureTypeButton = document.getElementById('add-extra-feature-type');

  const recalcInvoiceTotal = () => {
    const payload = Object.fromEntries(new FormData(invoiceForm).entries());
    payload.extraPageSelections = collectInvoiceOptionSelections(extraPagesRows);
    payload.extraFeatureSelections = collectInvoiceOptionSelections(extraFeaturesRows);
    const totals = calculateInvoiceTotals(payload);
    const manualOverrideEnabled = Boolean(invoiceForm.elements.manualTotalOverride.checked);

    if (!manualOverrideEnabled) {
      invoiceForm.elements.computedTotal.value = formatCurrency(totals.total);
      invoiceForm.elements.finalTotalOverride.value = totals.total.toFixed(2);
      renderInvoicePricingPreview(totals);
      return;
    }

    const manualFinalTotal = parseMoneyInput(invoiceForm.elements.finalTotalOverride.value || totals.total);
    invoiceForm.elements.computedTotal.value = formatCurrency(manualFinalTotal);
    applyManualInvoiceTotalPreview(totals, manualFinalTotal);
  };

  const addInvoiceOptionRow = (kind) => {
    const container = kind === 'pages' ? extraPagesRows : extraFeaturesRows;
    if (!container) {
      return;
    }

    container.appendChild(createInvoiceOptionRow(kind));
    recalcInvoiceTotal();
  };

  const resetInvoiceOptionRows = () => {
    if (extraPagesRows) {
      extraPagesRows.innerHTML = '';
      extraPagesRows.appendChild(createInvoiceOptionRow('pages'));
    }

    if (extraFeaturesRows) {
      extraFeaturesRows.innerHTML = '';
      extraFeaturesRows.appendChild(createInvoiceOptionRow('features'));
    }
  };

  const toggleInvoiceManualOverride = () => {
    const manualOverrideEnabled = Boolean(invoiceForm.elements.manualTotalOverride.checked);
    invoiceForm.elements.finalTotalOverride.disabled = !manualOverrideEnabled;

    if (manualOverrideEnabled) {
      invoiceForm.elements.finalTotalOverride.focus();
      return;
    }

    recalcInvoiceTotal();
  };

  const recalcContractDeductible = () => {
    const totalCost = Number(contractForm.elements.totalCostDollars.value || 0);
    const deductiblePercent = Number(contractForm.elements.deductiblePercent.value || 25);
    const deductible = totalCost * (deductiblePercent / 100);
    contractForm.elements.deductibleDuePreview.value = formatCurrency(deductible);
  };

  [
    'siteType',
    'maintenanceTier',
    'additionalAmountDollars',
    'taxDollars',
  ].forEach((field) => {
    invoiceForm.elements[field].addEventListener('input', recalcInvoiceTotal);
    invoiceForm.elements[field].addEventListener('change', recalcInvoiceTotal);
  });

  [extraPagesRows, extraFeaturesRows].forEach((container) => {
    if (!container) {
      return;
    }

    container.addEventListener('input', recalcInvoiceTotal);
    container.addEventListener('change', recalcInvoiceTotal);
    container.addEventListener('click', (event) => {
      const removeButton = event.target.closest('.remove-option-row');
      if (!removeButton) {
        return;
      }

      const row = removeButton.closest('.multi-option-row');
      if (!row) {
        return;
      }

      const parent = row.parentElement;
      row.remove();

      if (parent && !parent.querySelector('.multi-option-row')) {
        parent.appendChild(createInvoiceOptionRow(parent.id === 'extra-pages-rows' ? 'pages' : 'features'));
      }

      recalcInvoiceTotal();
    });
  });

  if (addExtraPageTypeButton) {
    addExtraPageTypeButton.addEventListener('click', () => addInvoiceOptionRow('pages'));
  }

  if (addExtraFeatureTypeButton) {
    addExtraFeatureTypeButton.addEventListener('click', () => addInvoiceOptionRow('features'));
  }

  resetInvoiceOptionRows();

  invoiceForm.elements.manualTotalOverride.addEventListener('change', toggleInvoiceManualOverride);

  invoiceForm.elements.finalTotalOverride.addEventListener('input', () => {
    if (!invoiceForm.elements.manualTotalOverride.checked) {
      return;
    }

    recalcInvoiceTotal();
  });

  ['totalCostDollars', 'deductiblePercent'].forEach((field) => {
    contractForm.elements[field].addEventListener('input', recalcContractDeductible);
    contractForm.elements[field].addEventListener('change', recalcContractDeductible);
  });

  recalcInvoiceTotal();
  toggleInvoiceManualOverride();
  recalcContractDeductible();

  clientForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const messageNode = document.getElementById('client-form-message');
    setMessage(messageNode, 'Saving client...');
    const formData = new FormData(clientForm);
    const payload = Object.fromEntries(formData.entries());
    const clientId = payload.clientId;
    delete payload.clientId;

    try {
      const result = await apiFetch(clientId ? `/api/admin/clients/${clientId}` : '/api/admin/clients', {
        method: clientId ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });
      clientForm.reset();
      clientForm.elements.clientId.value = '';
      const extraMessage = result?.generatedPassword ? ` Temporary password: ${result.generatedPassword}` : '';
      setMessage(messageNode, `Client saved.${extraMessage}`);
      await loadAdminOverview();
    } catch (error) {
      setMessage(messageNode, error.message, true);
    }
  });

  resetButton.addEventListener('click', () => {
    clientForm.reset();
    clientForm.elements.clientId.value = '';
    setMessage(document.getElementById('client-form-message'), '');
  });

  invoiceForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const messageNode = document.getElementById('invoice-form-message');
    setMessage(messageNode, 'Creating invoice...');

    const payload = Object.fromEntries(new FormData(invoiceForm).entries());
    payload.extraPageSelections = collectInvoiceOptionSelections(extraPagesRows);
    payload.extraFeatureSelections = collectInvoiceOptionSelections(extraFeaturesRows);
    const totals = calculateInvoiceTotals(payload);
    const manualOverrideEnabled = Boolean(payload.manualTotalOverride);
    const finalTotal = manualOverrideEnabled ? parseMoneyInput(payload.finalTotalOverride) : totals.total;

    const extraPagesTotalCount = payload.extraPageSelections.reduce((sum, entry) => sum + entry.count, 0);
    const extraFeaturesTotalCount = payload.extraFeatureSelections.reduce((sum, entry) => sum + entry.count, 0);

    payload.extraPagesCount = extraPagesTotalCount;
    payload.extraPagesType = payload.extraPageSelections.length === 1 ? payload.extraPageSelections[0].type : null;
    payload.extraFeaturesCount = extraFeaturesTotalCount;
    payload.extraFeaturesType = payload.extraFeatureSelections.length === 1 ? payload.extraFeatureSelections[0].type : null;

    payload.description = buildInvoiceDescription(payload);
    payload.lineItems = totals.lineItems;
    payload.subtotalDollars = totals.subtotal.toFixed(2);
    payload.totalDollars = finalTotal.toFixed(2);
    payload.taxDollars = Number(payload.taxDollars || 0).toFixed(2);

    if (manualOverrideEnabled) {
      const adjustment = finalTotal - totals.total;
      if (Math.abs(adjustment) > 0.001) {
        payload.lineItems.push({
          name: 'Manual final total adjustment',
          quantity: 1,
          unitPrice: Number(adjustment.toFixed(2)),
          total: Number(adjustment.toFixed(2)),
        });
        payload.subtotalDollars = (totals.subtotal + adjustment).toFixed(2);
      }
    }

    delete payload.computedTotal;
    delete payload.manualTotalOverride;
    delete payload.finalTotalOverride;
    delete payload.invoiceDescription;

    try {
      const result = await apiFetch('/api/admin/invoices', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      invoiceForm.reset();
      invoiceForm.elements.additionalAmountDollars.value = '0.00';
      invoiceForm.elements.taxDollars.value = '0.00';
      invoiceForm.elements.computedTotal.value = '$0.00';
      invoiceForm.elements.manualTotalOverride.checked = false;
      invoiceForm.elements.finalTotalOverride.value = '';
      invoiceForm.elements.finalTotalOverride.disabled = true;
      resetInvoiceOptionRows();
      setMessage(messageNode, result.warning ? `Invoice created. ${result.warning}` : 'Invoice created, PDF generated, and sent to client.');
      await loadAdminOverview();
      recalcInvoiceTotal();
    } catch (error) {
      setMessage(messageNode, error.message, true);
    }
  });

  contractForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const messageNode = document.getElementById('contract-form-message');
    setMessage(messageNode, 'Creating contract...');

    const payload = Object.fromEntries(new FormData(contractForm).entries());
    delete payload.deductibleDuePreview;

    try {
      const result = await apiFetch('/api/admin/contracts', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      contractForm.reset();
      contractForm.elements.totalCostDollars.value = '1000.00';
      contractForm.elements.deductiblePercent.value = '25.00';
      recalcContractDeductible();
      setMessage(messageNode, result.warning ? `Contract created. ${result.warning}` : 'Contract created, PDF generated, and sent to client.');
      await loadAdminOverview();
    } catch (error) {
      setMessage(messageNode, error.message, true);
    }
  });
}

function populateClientForm(clientId) {
  const client = adminClientState.find((entry) => entry.id === clientId);
  if (!client) {
    return;
  }

  const form = document.getElementById('client-form');
  form.elements.clientId.value = client.id;
  form.elements.companyName.value = client.profile.company_name || '';
  form.elements.fullName.value = client.profile.full_name || '';
  form.elements.email.value = client.profile.email || '';
  form.elements.password.value = '';
  form.elements.websiteUrl.value = client.website_url || '';
  form.elements.websiteStatus.value = client.website_status || 'active';
  form.elements.subscriptionPlan.value = client.subscription_plan || 'Tier 1 - Basic Care';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function bindLogout() {
  const button = document.getElementById('logout-button');
  if (!button) {
    return;
  }

  button.addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    window.location.href = 'portal-login.html';
  });
}

function capitalize(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatMaintenanceTier(value) {
  return maintenanceTierLabels[value] || value || 'Unknown';
}

function formatInvoiceDescription(value) {
  return value || 'Website services';
}

function buildInvoiceDescription(payload) {
  const details = String(payload.invoiceDescription || '').trim();
  const optionSummaries = [
    summarizeInvoiceOptionSelections('Pages', payload.extraPageSelections),
    summarizeInvoiceOptionSelections('Features', payload.extraFeatureSelections),
  ].filter(Boolean);
  const labels = [payload.siteType, payload.maintenanceTier, ...optionSummaries]
    .filter(Boolean)
    .join(' | ');

  if (!details) {
    return labels || 'Website services';
  }

  return `${labels} | ${details}`;
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(Number(amount || 0));
}
