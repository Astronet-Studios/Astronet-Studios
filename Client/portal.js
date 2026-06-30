let supabaseClient;
let authSession;
let currentMode = 'client';
let adminClientState = [];

document.addEventListener('DOMContentLoaded', async () => {
  const page = document.body.dataset.page;

  try {
    const config = await fetch('/api/config').then((response) => response.json());

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

async function apiFetch(path, options = {}) {
  const { data } = await supabaseClient.auth.getSession();
  authSession = data.session;

  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authSession?.access_token || ''}`,
      ...(options.headers || {}),
    },
  });

  if (response.status === 204) {
    return null;
  }

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Request failed.');
  }

  return payload;
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
  document.getElementById('subscription-plan').textContent = data.clientAccount.subscription_plan;

  const unpaidTotal = data.openInvoices.reduce((sum, invoice) => sum + invoice.amount_cents, 0) / 100;
  document.getElementById('invoice-balance').textContent = formatCurrency(unpaidTotal);
  document.getElementById('invoice-balance-caption').textContent = data.openInvoices.length
    ? `${data.openInvoices.length} unpaid invoice${data.openInvoices.length === 1 ? '' : 's'}`
    : 'No unpaid invoices.';

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
              <div class="table-subcopy">${invoice.description || 'Website services'}</div>
            </td>
            <td><span class="status-pill status-${invoice.status}">${capitalize(invoice.status)}</span></td>
            <td>${formatCurrency(invoice.amount_cents / 100)}</td>
            <td>${invoice.due_date || 'N/A'}</td>
            <td>
              ${invoice.square_payment_link_url ? `<a class="btn btn-secondary btn-small" href="${invoice.square_payment_link_url}" target="_blank" rel="noopener noreferrer">Pay Invoice</a>` : invoice.status !== 'paid' ? `<button type="button" class="btn btn-secondary btn-small pay-link-button" data-invoice-id="${invoice.id}">Pay Invoice</button>` : '<span class="muted-copy">Paid</span>'}
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
  bindAdminForms();
}

async function loadAdminOverview() {
  const data = await apiFetch('/api/admin/overview');
  adminClientState = data.clients;
  renderAdminClients(data.clients);
  renderAdminInvoices(data.invoices, data.clients);
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
    <h3>${item.requested_plan}</h3>
    <p>Current plan: ${item.current_plan || 'Unknown'}</p>
    <p>${item.notes || 'No extra notes.'}</p>
    <span class="status-pill status-${item.status}">${capitalize(item.status)}</span>
  `);

  const select = document.getElementById('invoice-client-select');
  select.innerHTML = adminClientState.map((client) => `<option value="${client.id}">${client.profile.company_name || client.profile.email}</option>`).join('');
}

function renderAdminClients(clients) {
  const shell = document.getElementById('admin-clients');

  if (!clients.length) {
    shell.innerHTML = '<p class="muted-copy">No clients yet.</p>';
    return;
  }

  shell.innerHTML = `
    <table class="portal-table">
      <thead>
        <tr>
          <th>Client</th>
          <th>Website</th>
          <th>Plan</th>
          <th>Invoices</th>
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
            <td>${client.subscription_plan}</td>
            <td>${client.invoice_count} total / ${formatCurrency(client.unpaid_total_cents / 100)} unpaid</td>
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

function renderAdminInvoices(invoices, clients) {
  const clientsById = new Map(clients.map((client) => [client.id, client]));
  const shell = document.getElementById('admin-invoices');

  if (!invoices.length) {
    shell.innerHTML = '<p class="muted-copy">No invoices yet.</p>';
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
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        ${invoices.map((invoice) => {
          const client = clientsById.get(invoice.client_id);
          return `
            <tr>
              <td>
                <strong>${invoice.invoice_number}</strong>
                <div class="table-subcopy">${invoice.description || 'Website services'}</div>
              </td>
              <td>${client?.profile.company_name || 'Unknown client'}</td>
              <td><span class="status-pill status-${invoice.status}">${capitalize(invoice.status)}</span></td>
              <td>${formatCurrency(invoice.amount_cents / 100)}</td>
              <td>${invoice.due_date || 'N/A'}</td>
              <td>
                ${invoice.status !== 'paid' ? `<button type="button" class="btn btn-secondary btn-small mark-paid-button" data-invoice-id="${invoice.id}">Mark Paid</button>` : '<span class="muted-copy">Settled</span>'}
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
            amountCents: invoice.amount_cents,
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
}

function renderRequestList(containerId, items, template) {
  const shell = document.getElementById(containerId);
  if (!items.length) {
    shell.innerHTML = '<p class="muted-copy">Nothing submitted yet.</p>';
    return;
  }

  shell.innerHTML = items.map((item) => `<article class="request-card">${template(item)}</article>`).join('');
}

function bindAdminForms() {
  const clientForm = document.getElementById('client-form');
  const invoiceForm = document.getElementById('invoice-form');
  const resetButton = document.getElementById('client-form-reset');

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

    const formData = new FormData(invoiceForm);
    const payload = Object.fromEntries(formData.entries());
    payload.amountCents = Math.round(Number(payload.amountDollars) * 100);
    delete payload.amountDollars;

    try {
      const result = await apiFetch('/api/admin/invoices', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      invoiceForm.reset();
      setMessage(messageNode, result.warning ? `Invoice created. ${result.warning}` : 'Invoice created and added to the client dashboard.');
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

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount || 0);
}