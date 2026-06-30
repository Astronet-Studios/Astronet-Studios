const crypto = require('crypto');
const path = require('path');

const dotenv = require('dotenv');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const clientDir = path.join(__dirname, '..', 'Client');
const publicAppUrl = process.env.PUBLIC_APP_URL || `http://localhost:${PORT}`;
const squareBaseUrl = process.env.SQUARE_ENVIRONMENT === 'production'
  ? 'https://connect.squareup.com'
  : 'https://connect.squareupsandbox.com';

const hasSupabaseConfig = Boolean(
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_ANON_KEY &&
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const supabaseAdmin = hasSupabaseConfig
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  : null;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(clientDir));

function ensureSupabase(res) {
  if (supabaseAdmin) {
    return true;
  }

  res.status(500).json({
    error: 'Supabase is not configured. Add SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY.',
  });
  return false;
}

function normalizeError(error, fallbackMessage) {
  if (!error) {
    return fallbackMessage;
  }

  if (typeof error === 'string') {
    return error;
  }

  return error.message || fallbackMessage;
}

function buildInvoiceNumber() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const shortId = Array.from(crypto.randomBytes(4))
    .map((byte) => (byte % 36).toString(36))
    .join('')
    .toUpperCase();
  return `INV-${stamp}-${shortId}`;
}

function parseInvoiceAmountDollars(body) {
  if (body.amountDollars !== undefined && body.amountDollars !== null && body.amountDollars !== '') {
    const normalizedAmount = String(body.amountDollars).replace(/[$,\s]/g, '');
    return Number(normalizedAmount);
  }

  if (body.amount_cents !== undefined && body.amount_cents !== null && body.amount_cents !== '') {
    return Number(body.amount_cents) / 100;
  }

  if (body.amountCents !== undefined && body.amountCents !== null && body.amountCents !== '') {
    return Number(body.amountCents) / 100;
  }

  return Number(body.amount_dollars);
}

function deriveRole(profile, email) {
  if (profile && profile.role) {
    return profile.role;
  }

  if (process.env.ADMIN_EMAIL && email && process.env.ADMIN_EMAIL.toLowerCase() === email.toLowerCase()) {
    return 'admin';
  }

  return 'client';
}

function getBearerToken(req) {
  const authHeader = req.headers.authorization || '';

  if (!authHeader.startsWith('Bearer ')) {
    return null;
  }

  return authHeader.slice(7).trim();
}

async function getProfileByUserId(userId) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function getClientAccountByProfileId(profileId) {
  const { data, error } = await supabaseAdmin
    .from('client_accounts')
    .select('*')
    .eq('profile_id', profileId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function authMiddleware(req, res, next) {
  if (!ensureSupabase(res)) {
    return;
  }

  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Missing bearer token.' });
    return;
  }

  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !data.user) {
      res.status(401).json({ error: normalizeError(error, 'Invalid session.') });
      return;
    }

    const profile = await getProfileByUserId(data.user.id);
    req.user = {
      id: data.user.id,
      email: data.user.email,
      profile: profile
        ? {
            ...profile,
            role: deriveRole(profile, data.user.email),
          }
        : {
            id: data.user.id,
            email: data.user.email,
            full_name: data.user.user_metadata?.full_name || '',
            company_name: data.user.user_metadata?.company_name || '',
            role: deriveRole(null, data.user.email),
          },
    };

    next();
  } catch (error) {
    res.status(500).json({ error: normalizeError(error, 'Unable to validate session.') });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.profile.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required.' });
    return;
  }

  next();
}

async function createSquarePaymentLink(invoice, clientAccount, profile) {
  if (!process.env.SQUARE_ACCESS_TOKEN || !process.env.SQUARE_LOCATION_ID) {
    return {
      id: null,
      url: null,
      warning: 'Square is not configured yet.',
    };
  }

  const response = await fetch(`${squareBaseUrl}/v2/online-checkout/payment-links`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'Square-Version': '2025-05-21',
    },
    body: JSON.stringify({
      idempotency_key: crypto.randomUUID(),
      quick_pay: {
        name: `${invoice.invoice_number} for ${profile.company_name || profile.full_name || profile.email}`,
        price_money: {
          amount: Math.round(Number(invoice.amount_dollars) * 100),
          currency: invoice.currency || 'USD',
        },
        location_id: process.env.SQUARE_LOCATION_ID,
      },
      checkout_options: {
        redirect_url: `${publicAppUrl}/dashboard.html?invoice=${invoice.id}`,
      },
      pre_populated_data: {
        buyer_email: profile.email,
      },
      description: [
        invoice.description || 'Website services invoice',
        clientAccount.website_url ? `Website: ${clientAccount.website_url}` : null,
      ].filter(Boolean).join(' | '),
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    const detail = payload.errors?.map((entry) => entry.detail).join(', ');
    throw new Error(detail || 'Square payment link creation failed.');
  }

  return {
    id: payload.payment_link?.id || null,
    url: payload.payment_link?.url || null,
    warning: null,
  };
}

async function fetchClientInvoices(clientId) {
  const { data, error } = await supabaseAdmin
    .from('invoices')
    .select('*')
    .eq('client_id', clientId)
    .order('issued_at', { ascending: false });

  if (error) {
    throw error;
  }

  return data || [];
}

async function enrichClients(clientAccounts) {
  const profileIds = clientAccounts.map((entry) => entry.profile_id);
  const clientIds = clientAccounts.map((entry) => entry.id);

  const [{ data: profiles, error: profilesError }, { data: invoices, error: invoicesError }] = await Promise.all([
    supabaseAdmin.from('profiles').select('*').in('id', profileIds),
    supabaseAdmin.from('invoices').select('*').in('client_id', clientIds),
  ]);

  if (profilesError) {
    throw profilesError;
  }

  if (invoicesError) {
    throw invoicesError;
  }

  const profilesById = new Map((profiles || []).map((entry) => [entry.id, entry]));
  const invoicesByClientId = new Map();

  for (const invoice of invoices || []) {
    const list = invoicesByClientId.get(invoice.client_id) || [];
    list.push(invoice);
    invoicesByClientId.set(invoice.client_id, list);
  }

  return clientAccounts.map((account) => {
    const profile = profilesById.get(account.profile_id) || {};
    const clientInvoices = invoicesByClientId.get(account.id) || [];
    const unpaidTotal = clientInvoices
      .filter((invoice) => invoice.status !== 'paid')
      .reduce((sum, invoice) => sum + Number(invoice.amount_dollars || 0), 0);

    return {
      ...account,
      profile,
      invoice_count: clientInvoices.length,
      unpaid_total_dollars: unpaidTotal,
    };
  });
}

app.get('/api/config', (_req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    publicAppUrl,
  });
});

app.get('/api/me', authMiddleware, async (req, res) => {
  try {
    const account = req.user.profile.role === 'client'
      ? await getClientAccountByProfileId(req.user.id)
      : null;

    res.json({
      user: {
        id: req.user.id,
        email: req.user.email,
        profile: req.user.profile,
      },
      clientAccount: account,
    });
  } catch (error) {
    res.status(500).json({ error: normalizeError(error, 'Unable to load account.') });
  }
});

app.get('/api/me/dashboard', authMiddleware, async (req, res) => {
  if (req.user.profile.role !== 'client') {
    res.status(403).json({ error: 'Client access required.' });
    return;
  }

  try {
    const account = await getClientAccountByProfileId(req.user.id);
    if (!account) {
      res.status(404).json({ error: 'No client account found for this user.' });
      return;
    }

    const [invoices, changeRequests, supportQuestions, subscriptionRequests] = await Promise.all([
      fetchClientInvoices(account.id),
      supabaseAdmin.from('change_requests').select('*').eq('client_id', account.id).order('created_at', { ascending: false }),
      supabaseAdmin.from('support_questions').select('*').eq('client_id', account.id).order('created_at', { ascending: false }),
      supabaseAdmin.from('subscription_change_requests').select('*').eq('client_id', account.id).order('created_at', { ascending: false }),
    ]);

    if (changeRequests.error) {
      throw changeRequests.error;
    }

    if (supportQuestions.error) {
      throw supportQuestions.error;
    }

    if (subscriptionRequests.error) {
      throw subscriptionRequests.error;
    }

    res.json({
      profile: req.user.profile,
      clientAccount: account,
      invoices,
      previousInvoices: invoices.filter((invoice) => invoice.status === 'paid'),
      openInvoices: invoices.filter((invoice) => invoice.status !== 'paid'),
      changeRequests: changeRequests.data || [],
      supportQuestions: supportQuestions.data || [],
      subscriptionRequests: subscriptionRequests.data || [],
    });
  } catch (error) {
    res.status(500).json({ error: normalizeError(error, 'Unable to load dashboard.') });
  }
});

app.post('/api/me/change-requests', authMiddleware, async (req, res) => {
  if (req.user.profile.role !== 'client') {
    res.status(403).json({ error: 'Client access required.' });
    return;
  }

  try {
    const account = await getClientAccountByProfileId(req.user.id);
    const payload = {
      client_id: account.id,
      title: req.body.title,
      description: req.body.description,
      priority: req.body.priority || 'normal',
      status: 'submitted',
    };

    const { data, error } = await supabaseAdmin
      .from('change_requests')
      .insert(payload)
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: normalizeError(error, 'Unable to submit change request.') });
  }
});

app.post('/api/me/questions', authMiddleware, async (req, res) => {
  if (req.user.profile.role !== 'client') {
    res.status(403).json({ error: 'Client access required.' });
    return;
  }

  try {
    const account = await getClientAccountByProfileId(req.user.id);
    const payload = {
      client_id: account.id,
      subject: req.body.subject,
      message: req.body.message,
      status: 'open',
    };

    const { data, error } = await supabaseAdmin
      .from('support_questions')
      .insert(payload)
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: normalizeError(error, 'Unable to submit question.') });
  }
});

app.post('/api/me/subscription-change', authMiddleware, async (req, res) => {
  if (req.user.profile.role !== 'client') {
    res.status(403).json({ error: 'Client access required.' });
    return;
  }

  try {
    const account = await getClientAccountByProfileId(req.user.id);
    const payload = {
      client_id: account.id,
      current_plan: account.subscription_plan,
      requested_plan: req.body.requestedPlan,
      notes: req.body.notes,
      status: 'submitted',
    };

    const { data, error } = await supabaseAdmin
      .from('subscription_change_requests')
      .insert(payload)
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: normalizeError(error, 'Unable to submit subscription change.') });
  }
});

app.post('/api/me/invoices/:invoiceId/payment-link', authMiddleware, async (req, res) => {
  if (req.user.profile.role !== 'client') {
    res.status(403).json({ error: 'Client access required.' });
    return;
  }

  try {
    const account = await getClientAccountByProfileId(req.user.id);
    const { data: invoice, error } = await supabaseAdmin
      .from('invoices')
      .select('*')
      .eq('id', req.params.invoiceId)
      .eq('client_id', account.id)
      .single();

    if (error) {
      throw error;
    }

    if (invoice.square_payment_link_url) {
      res.json({
        url: invoice.square_payment_link_url,
        warning: null,
      });
      return;
    }

    const paymentLink = await createSquarePaymentLink(invoice, account, req.user.profile);

    if (paymentLink.url) {
      const { error: updateError } = await supabaseAdmin
        .from('invoices')
        .update({
          square_payment_link_id: paymentLink.id,
          square_payment_link_url: paymentLink.url,
        })
        .eq('id', invoice.id);

      if (updateError) {
        throw updateError;
      }
    }

    res.json({
      url: paymentLink.url,
      warning: paymentLink.warning,
    });
  } catch (error) {
    res.status(500).json({ error: normalizeError(error, 'Unable to prepare payment link.') });
  }
});

app.get('/api/admin/overview', authMiddleware, requireAdmin, async (_req, res) => {
  try {
    const [{ data: clientAccounts, error: clientsError }, changeRequests, supportQuestions, subscriptionRequests] = await Promise.all([
      supabaseAdmin.from('client_accounts').select('*').order('created_at', { ascending: false }),
      supabaseAdmin.from('change_requests').select('*').order('created_at', { ascending: false }),
      supabaseAdmin.from('support_questions').select('*').order('created_at', { ascending: false }),
      supabaseAdmin.from('subscription_change_requests').select('*').order('created_at', { ascending: false }),
    ]);

    if (clientsError) {
      throw clientsError;
    }

    if (changeRequests.error) {
      throw changeRequests.error;
    }

    if (supportQuestions.error) {
      throw supportQuestions.error;
    }

    if (subscriptionRequests.error) {
      throw subscriptionRequests.error;
    }

    const clients = await enrichClients(clientAccounts || []);

    const { data: invoices, error: invoicesError } = await supabaseAdmin
      .from('invoices')
      .select('*')
      .order('issued_at', { ascending: false });

    if (invoicesError) {
      throw invoicesError;
    }

    res.json({
      clients,
      invoices: invoices || [],
      changeRequests: changeRequests.data || [],
      supportQuestions: supportQuestions.data || [],
      subscriptionRequests: subscriptionRequests.data || [],
    });
  } catch (error) {
    res.status(500).json({ error: normalizeError(error, 'Unable to load admin overview.') });
  }
});

app.get('/api/admin/clients', authMiddleware, requireAdmin, async (_req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('client_accounts')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    const clients = await enrichClients(data || []);
    res.json(clients);
  } catch (error) {
    res.status(500).json({ error: normalizeError(error, 'Unable to load clients.') });
  }
});

app.post('/api/admin/clients', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const password = req.body.password || crypto.randomBytes(6).toString('base64url');
    const { data: createdUser, error: createUserError } = await supabaseAdmin.auth.admin.createUser({
      email: req.body.email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: req.body.fullName,
        company_name: req.body.companyName,
      },
    });

    if (createUserError) {
      throw createUserError;
    }

    const profilePayload = {
      id: createdUser.user.id,
      email: req.body.email,
      full_name: req.body.fullName,
      company_name: req.body.companyName,
      role: 'client',
    };

    const { error: profileError } = await supabaseAdmin.from('profiles').upsert(profilePayload);
    if (profileError) {
      throw profileError;
    }

    const { data: clientAccount, error: accountError } = await supabaseAdmin
      .from('client_accounts')
      .insert({
        profile_id: createdUser.user.id,
        website_url: req.body.websiteUrl,
        website_status: req.body.websiteStatus || 'active',
        subscription_plan: req.body.subscriptionPlan || 'Tier 1 - Basic Care',
      })
      .select('*')
      .single();

    if (accountError) {
      throw accountError;
    }

    res.status(201).json({
      client: {
        ...clientAccount,
        profile: profilePayload,
      },
      generatedPassword: req.body.password ? null : password,
    });
  } catch (error) {
    res.status(500).json({ error: normalizeError(error, 'Unable to create client.') });
  }
});

app.put('/api/admin/clients/:clientId', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { data: currentAccount, error: currentError } = await supabaseAdmin
      .from('client_accounts')
      .select('*')
      .eq('id', req.params.clientId)
      .single();

    if (currentError) {
      throw currentError;
    }

    const profilePayload = {
      email: req.body.email,
      full_name: req.body.fullName,
      company_name: req.body.companyName,
    };

    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update(profilePayload)
      .eq('id', currentAccount.profile_id);

    if (profileError) {
      throw profileError;
    }

    const { data, error } = await supabaseAdmin
      .from('client_accounts')
      .update({
        website_url: req.body.websiteUrl,
        website_status: req.body.websiteStatus,
        subscription_plan: req.body.subscriptionPlan,
      })
      .eq('id', req.params.clientId)
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: normalizeError(error, 'Unable to update client.') });
  }
});

app.delete('/api/admin/clients/:clientId', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { data: account, error: accountError } = await supabaseAdmin
      .from('client_accounts')
      .select('*')
      .eq('id', req.params.clientId)
      .single();

    if (accountError) {
      throw accountError;
    }

    const { error: deleteAccountError } = await supabaseAdmin
      .from('client_accounts')
      .delete()
      .eq('id', req.params.clientId);

    if (deleteAccountError) {
      throw deleteAccountError;
    }

    const { error: deleteProfileError } = await supabaseAdmin
      .from('profiles')
      .delete()
      .eq('id', account.profile_id);

    if (deleteProfileError) {
      throw deleteProfileError;
    }

    const { error: deleteUserError } = await supabaseAdmin.auth.admin.deleteUser(account.profile_id);
    if (deleteUserError) {
      throw deleteUserError;
    }

    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: normalizeError(error, 'Unable to delete client.') });
  }
});

app.get('/api/admin/invoices', authMiddleware, requireAdmin, async (_req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('invoices')
      .select('*')
      .order('issued_at', { ascending: false });

    if (error) {
      throw error;
    }

    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: normalizeError(error, 'Unable to load invoices.') });
  }
});

app.post('/api/admin/invoices', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { data: account, error: accountError } = await supabaseAdmin
      .from('client_accounts')
      .select('*')
      .eq('id', req.body.clientId)
      .single();

    if (accountError) {
      throw accountError;
    }

    const profile = await getProfileByUserId(account.profile_id);
    const invoicePayload = {
      client_id: req.body.clientId,
      invoice_number: buildInvoiceNumber(),
      description: req.body.description,
      amount_dollars: parseInvoiceAmountDollars(req.body),
      currency: req.body.currency || 'USD',
      due_date: req.body.dueDate,
      status: req.body.status || 'unpaid',
    };

    const { data: invoice, error: invoiceError } = await supabaseAdmin
      .from('invoices')
      .insert(invoicePayload)
      .select('*')
      .single();

    if (invoiceError) {
      throw invoiceError;
    }

    const paymentLink = await createSquarePaymentLink(invoice, account, profile);
    let responseInvoice = invoice;

    if (paymentLink.url) {
      const { data: updatedInvoice, error: updateError } = await supabaseAdmin
        .from('invoices')
        .update({
          square_payment_link_id: paymentLink.id,
          square_payment_link_url: paymentLink.url,
        })
        .eq('id', invoice.id)
        .select('*')
        .single();

      if (updateError) {
        throw updateError;
      }

      responseInvoice = updatedInvoice;
    }

    res.status(201).json({
      invoice: responseInvoice,
      warning: paymentLink.warning,
    });
  } catch (error) {
    res.status(500).json({ error: normalizeError(error, 'Unable to create invoice.') });
  }
});

app.put('/api/admin/invoices/:invoiceId', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const payload = {
      description: req.body.description,
      amount_dollars: parseInvoiceAmountDollars(req.body),
      currency: req.body.currency || 'USD',
      due_date: req.body.dueDate,
      status: req.body.status,
      paid_at: req.body.status === 'paid' ? new Date().toISOString() : null,
    };

    const { data, error } = await supabaseAdmin
      .from('invoices')
      .update(payload)
      .eq('id', req.params.invoiceId)
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: normalizeError(error, 'Unable to update invoice.') });
  }
});

app.get('/api/admin/requests', authMiddleware, requireAdmin, async (_req, res) => {
  try {
    const [changeRequests, supportQuestions, subscriptionRequests] = await Promise.all([
      supabaseAdmin.from('change_requests').select('*').order('created_at', { ascending: false }),
      supabaseAdmin.from('support_questions').select('*').order('created_at', { ascending: false }),
      supabaseAdmin.from('subscription_change_requests').select('*').order('created_at', { ascending: false }),
    ]);

    if (changeRequests.error) {
      throw changeRequests.error;
    }

    if (supportQuestions.error) {
      throw supportQuestions.error;
    }

    if (subscriptionRequests.error) {
      throw subscriptionRequests.error;
    }

    res.json({
      changeRequests: changeRequests.data || [],
      supportQuestions: supportQuestions.data || [],
      subscriptionRequests: subscriptionRequests.data || [],
    });
  } catch (error) {
    res.status(500).json({ error: normalizeError(error, 'Unable to load requests.') });
  }
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('*', (req, res) => {
  const requestPath = req.path.toLowerCase();

  if (requestPath === '/admin' || requestPath === '/admin.html') {
    res.sendFile(path.join(clientDir, 'admin.html'));
    return;
  }

  if (requestPath === '/dashboard' || requestPath === '/dashboard.html') {
    res.sendFile(path.join(clientDir, 'dashboard.html'));
    return;
  }

  if (requestPath === '/portal' || requestPath === '/portal-login.html') {
    res.sendFile(path.join(clientDir, 'portal-login.html'));
    return;
  }

  res.sendFile(path.join(clientDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Astronet Studios app running on port ${PORT}`);
});