const crypto = require('crypto');
const path = require('path');

const dotenv = require('dotenv');
const express = require('express');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const { createClient } = require('@supabase/supabase-js');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const clientDir = path.join(__dirname, '..', 'Client');
const publicAppUrl = process.env.PUBLIC_APP_URL || `http://localhost:${PORT}`;
const squareBaseUrl = process.env.SQUARE_ENVIRONMENT === 'production'
  ? 'https://connect.squareup.com'
  : 'https://connect.squareupsandbox.com';
const pandadocBaseUrl = 'https://api.pandadoc.com/public/v1';
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
const defaultContractTerms = [
  '1. Project Scope: The scope of work is based on the approved proposal and signed contract.',
  '2. Deposit: A deductible equal to 25% of the total project cost is due before work begins.',
  '3. Timeline: Timeline estimates are based on timely client feedback and content delivery.',
  '4. Revisions: Two revision rounds are included unless otherwise documented in writing.',
  '5. Ownership: Final deliverables are transferred after full payment is received.',
  '6. Support: Post-launch support is available through active monthly maintenance plans.',
  '7. Termination: Either party may terminate with written notice; completed work remains billable.',
].join('\n');

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

app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf.toString('utf8');
  },
}));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(clientDir));

app.use((req, res, next) => {
  if (req.method === 'GET' && typeof req.query.challenge === 'string' && req.query.challenge) {
    res.type('text/plain').send(req.query.challenge);
    return;
  }

  next();
});

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

function buildContractNumber() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const shortId = Array.from(crypto.randomBytes(4))
    .map((byte) => (byte % 36).toString(36))
    .join('')
    .toUpperCase();
  return `CTR-${stamp}-${shortId}`;
}

function parseMoney(value, fallback = 0) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  const normalized = String(value).replace(/[$,\s]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseCount(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function toCurrencyAmount(value) {
  return Number(parseMoney(value, 0).toFixed(2));
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(parseMoney(value, 0));
}

function parseLineItems(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((entry) => ({
      name: String(entry.name || '').trim(),
      quantity: parseCount(entry.quantity) || 1,
      unit_price_dollars: toCurrencyAmount(entry.unitPrice || entry.unit_price_dollars || 0),
      total_dollars: toCurrencyAmount(entry.total || entry.total_dollars || 0),
    }))
    .filter((entry) => entry.name && entry.total_dollars > 0);
}

function buildInvoiceDetails(body) {
  const providedItems = parseLineItems(body.lineItems);
  const invoiceItems = [];

  if (providedItems.length) {
    invoiceItems.push(...providedItems);
  } else {
    const maintenanceTier = String(body.maintenanceTier || '').trim();
    const siteType = String(body.siteType || '').trim();
    const extraPagesCount = parseCount(body.extraPagesCount);
    const extraPagesType = String(body.extraPagesType || '').trim();
    const extraFeaturesCount = parseCount(body.extraFeaturesCount);
    const extraFeaturesType = String(body.extraFeaturesType || '').trim();
    const additionalAmount = toCurrencyAmount(body.additionalAmountDollars || body.amountDollars || 0);

    if (siteType && siteTypeBasePricing[siteType]) {
      invoiceItems.push({
        name: `${siteType} base build`,
        quantity: 1,
        unit_price_dollars: siteTypeBasePricing[siteType],
        total_dollars: siteTypeBasePricing[siteType],
      });
    }

    if (maintenanceTier && maintenanceTierAmounts[maintenanceTier]) {
      invoiceItems.push({
        name: `${maintenanceTier} (monthly)` ,
        quantity: 1,
        unit_price_dollars: maintenanceTierAmounts[maintenanceTier],
        total_dollars: maintenanceTierAmounts[maintenanceTier],
      });
    }

    if (extraPagesCount > 0 && extraPagesType && extraPageTypePricing[extraPagesType]) {
      const unit = extraPageTypePricing[extraPagesType];
      invoiceItems.push({
        name: `${extraPagesType} extra pages`,
        quantity: extraPagesCount,
        unit_price_dollars: unit,
        total_dollars: toCurrencyAmount(unit * extraPagesCount),
      });
    }

    if (extraFeaturesCount > 0 && extraFeaturesType && extraFeatureTypePricing[extraFeaturesType]) {
      const unit = extraFeatureTypePricing[extraFeaturesType];
      invoiceItems.push({
        name: `${extraFeaturesType} feature work`,
        quantity: extraFeaturesCount,
        unit_price_dollars: unit,
        total_dollars: toCurrencyAmount(unit * extraFeaturesCount),
      });
    }

    if (additionalAmount > 0) {
      invoiceItems.push({
        name: 'Additional custom work',
        quantity: 1,
        unit_price_dollars: additionalAmount,
        total_dollars: additionalAmount,
      });
    }
  }

  const subtotal = toCurrencyAmount(invoiceItems.reduce((sum, entry) => sum + parseMoney(entry.total_dollars, 0), 0));
  const taxDollars = toCurrencyAmount(body.taxDollars || 0);
  const total = toCurrencyAmount(body.totalDollars || subtotal + taxDollars);

  return {
    maintenanceTier: String(body.maintenanceTier || '').trim(),
    siteType: String(body.siteType || '').trim(),
    extraPagesCount: parseCount(body.extraPagesCount),
    extraPagesType: String(body.extraPagesType || '').trim(),
    extraFeaturesCount: parseCount(body.extraFeaturesCount),
    extraFeaturesType: String(body.extraFeaturesType || '').trim(),
    lineItems: invoiceItems,
    subtotalDollars: subtotal,
    taxDollars,
    totalDollars: total,
  };
}

function buildPdfBuffer(draw) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    draw(doc);
    doc.end();
  });
}

function drawLineItemsTable(doc, lineItems) {
  let y = doc.y;
  doc.fontSize(11).fillColor('#1f2937').text('Line Items', 50, y);
  y += 18;
  doc.moveTo(50, y).lineTo(545, y).strokeColor('#cbd5e1').stroke();
  y += 10;

  doc.fontSize(10).fillColor('#111827').text('Description', 50, y);
  doc.text('Qty', 330, y, { width: 40, align: 'right' });
  doc.text('Unit', 390, y, { width: 70, align: 'right' });
  doc.text('Total', 470, y, { width: 75, align: 'right' });
  y += 15;
  doc.moveTo(50, y).lineTo(545, y).strokeColor('#e2e8f0').stroke();
  y += 8;

  for (const entry of lineItems) {
    if (y > 710) {
      doc.addPage();
      y = 50;
    }

    doc.fillColor('#0f172a').text(entry.name, 50, y, { width: 265 });
    doc.text(String(entry.quantity || 1), 330, y, { width: 40, align: 'right' });
    doc.text(formatCurrency(entry.unit_price_dollars), 390, y, { width: 70, align: 'right' });
    doc.text(formatCurrency(entry.total_dollars), 470, y, { width: 75, align: 'right' });
    y += 18;
  }

  doc.moveTo(50, y).lineTo(545, y).strokeColor('#e2e8f0').stroke();
  doc.y = y + 14;
}

function generateInvoicePdf(invoice, clientAccount, profile) {
  return buildPdfBuffer((doc) => {
    const issueDate = invoice.issued_at ? new Date(invoice.issued_at).toLocaleDateString('en-US') : new Date().toLocaleDateString('en-US');
    doc.fontSize(22).fillColor('#0f172a').text('Astronet Studios Invoice', { align: 'left' });
    doc.moveDown(0.4);
    doc.fontSize(10).fillColor('#334155').text(`Invoice #: ${invoice.invoice_number}`);
    doc.text(`Issue Date: ${issueDate}`);
    doc.text(`Due Date: ${invoice.due_date || 'N/A'}`);
    doc.text(`Status: ${String(invoice.status || '').toUpperCase()}`);
    doc.moveDown(0.8);

    doc.fontSize(11).fillColor('#0f172a').text('Bill To');
    doc.fontSize(10).fillColor('#334155').text(profile.company_name || profile.full_name || profile.email);
    doc.text(profile.email || '');
    if (clientAccount.website_url) {
      doc.text(clientAccount.website_url);
    }

    if (invoice.description) {
      doc.moveDown(0.8);
      doc.fontSize(10).fillColor('#0f172a').text('Project Summary');
      doc.fontSize(10).fillColor('#334155').text(invoice.description);
    }

    doc.moveDown(1);
    drawLineItemsTable(doc, Array.isArray(invoice.line_items) ? invoice.line_items : []);

    const subtotal = parseMoney(invoice.subtotal_dollars || invoice.amount_dollars, 0);
    const tax = parseMoney(invoice.tax_dollars, 0);
    const total = parseMoney(invoice.total_dollars || invoice.amount_dollars, 0);

    doc.fontSize(10).fillColor('#334155').text(`Subtotal: ${formatCurrency(subtotal)}`, { align: 'right' });
    doc.text(`Tax: ${formatCurrency(tax)}`, { align: 'right' });
    doc.fontSize(12).fillColor('#0f172a').text(`Total Due: ${formatCurrency(total)}`, { align: 'right' });
    doc.moveDown(1);
    doc.fontSize(9).fillColor('#64748b').text('Thank you for choosing Astronet Studios.', { align: 'left' });
  });
}

function generateContractPdf(contract, clientAccount, profile) {
  return buildPdfBuffer((doc) => {
    doc.fontSize(22).fillColor('#0f172a').text('Astronet Studios Project Contract');
    doc.moveDown(0.4);
    doc.fontSize(10).fillColor('#334155').text(`Contract #: ${contract.contract_number}`);
    doc.text(`Created: ${new Date(contract.created_at || Date.now()).toLocaleDateString('en-US')}`);
    doc.text(`Status: ${String(contract.status || '').toUpperCase()}`);
    doc.moveDown(0.8);

    doc.fontSize(11).fillColor('#0f172a').text('Client Information');
    doc.fontSize(10).fillColor('#334155').text(profile.company_name || profile.full_name || profile.email);
    doc.text(profile.email || '');
    if (clientAccount.website_url) {
      doc.text(clientAccount.website_url);
    }
    doc.moveDown(0.8);

    doc.fontSize(11).fillColor('#0f172a').text('Project Details');
    doc.fontSize(10).fillColor('#334155').text(`Project: ${contract.project_title}`);
    doc.text(`Site Type: ${contract.site_type || 'Not specified'}`);
    doc.text(`Timeline: ${contract.timeline || 'Not specified'}`);
    doc.text(`Total Cost: ${formatCurrency(contract.total_cost_dollars)}`);
    doc.text(`Due Before Project Start (${contract.deductible_percent}%): ${formatCurrency(contract.deductible_due_dollars)}`);
    doc.text(`Remaining Balance: ${formatCurrency(contract.remaining_balance_dollars)}`);
    doc.moveDown(1);

    doc.fontSize(11).fillColor('#0f172a').text('Terms & Conditions');
    doc.moveDown(0.5);
    doc.fontSize(9.5).fillColor('#334155').text(contract.terms_text || defaultContractTerms, {
      width: 500,
      align: 'left',
      lineGap: 3,
    });

    doc.moveDown(1.4);
    doc.fontSize(10).fillColor('#0f172a').text('Client Signature: ____________________________');
    doc.text('Date: ____________________________');
  });
}

async function sendEmailWithAttachment({ to, subject, text, html, attachmentName, attachmentBuffer }) {
  const hasEmailConfig = Boolean(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_FROM);
  if (!hasEmailConfig) {
    return 'Email not sent because SMTP_HOST, SMTP_PORT, and SMTP_FROM are not configured.';
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
    auth: process.env.SMTP_USER
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS || '',
        }
      : undefined,
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject,
    text,
    html,
    attachments: attachmentBuffer
      ? [
          {
            filename: attachmentName,
            content: attachmentBuffer,
          },
        ]
      : [],
  });

  return null;
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

async function fetchClientContracts(clientId) {
  const { data, error } = await supabaseAdmin
    .from('contracts')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return data || [];
}

async function resolveInvoiceByIdForUser(invoiceId, user) {
  if (user.profile.role === 'admin') {
    const { data: invoice, error } = await supabaseAdmin
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .single();

    if (error) {
      throw error;
    }

    return invoice;
  }

  const account = await getClientAccountByProfileId(user.id);
  const { data: invoice, error } = await supabaseAdmin
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .eq('client_id', account.id)
    .single();

  if (error) {
    throw error;
  }

  return invoice;
}

async function resolveContractByIdForUser(contractId, user) {
  if (user.profile.role === 'admin') {
    const { data: contract, error } = await supabaseAdmin
      .from('contracts')
      .select('*')
      .eq('id', contractId)
      .single();

    if (error) {
      throw error;
    }

    return contract;
  }

  const account = await getClientAccountByProfileId(user.id);
  const { data: contract, error } = await supabaseAdmin
    .from('contracts')
    .select('*')
    .eq('id', contractId)
    .eq('client_id', account.id)
    .single();

  if (error) {
    throw error;
  }

  return contract;
}

async function sendInvoiceEmail(invoice, clientAccount, profile) {
  const pdfBuffer = await generateInvoicePdf(invoice, clientAccount, profile);
  const paymentLinkText = invoice.square_payment_link_url
    ? `\nPay invoice: ${invoice.square_payment_link_url}`
    : '\nSquare payment link will appear as soon as the integration is fully active.';
  const paymentLinkHtml = invoice.square_payment_link_url
    ? `<p><a href="${invoice.square_payment_link_url}">Pay this invoice securely</a></p>`
    : '<p>Square payment link will appear as soon as the integration is fully active.</p>';

  return sendEmailWithAttachment({
    to: profile.email,
    subject: `Invoice ${invoice.invoice_number} from Astronet Studios`,
    text: `Hello ${profile.full_name || profile.company_name || 'Client'},\n\nYour invoice is attached as a PDF.${paymentLinkText}\n\nThank you,\nAstronet Studios`,
    html: `<p>Hello ${profile.full_name || profile.company_name || 'Client'},</p><p>Your invoice is attached as a PDF.</p>${paymentLinkHtml}<p>Thank you,<br/>Astronet Studios</p>`,
    attachmentName: `${invoice.invoice_number}.pdf`,
    attachmentBuffer: pdfBuffer,
  });
}

async function sendContractEmail(contract, clientAccount, profile) {
  const pdfBuffer = await generateContractPdf(contract, clientAccount, profile);
  return sendEmailWithAttachment({
    to: profile.email,
    subject: `Contract ${contract.contract_number} from Astronet Studios`,
    text: `Hello ${profile.full_name || profile.company_name || 'Client'},\n\nYour project contract is attached as a PDF. Please review and sign.\n\nThank you,\nAstronet Studios`,
    html: `<p>Hello ${profile.full_name || profile.company_name || 'Client'},</p><p>Your project contract is attached as a PDF.</p><p>Please review and sign, then reply with confirmation.</p><p>Thank you,<br/>Astronet Studios</p>`,
    attachmentName: `${contract.contract_number}.pdf`,
    attachmentBuffer: pdfBuffer,
  });
}

function mapPandaDocStatusToEsignStatus(documentStatus, eventType) {
  if (typeof documentStatus === 'string' && documentStatus.trim()) {
    return documentStatus.replace(/^document\./, '');
  }

  if (typeof eventType === 'string' && eventType.trim()) {
    return eventType;
  }

  return 'unknown';
}

function mapPandaDocStatusToContractState(documentStatus, eventType) {
  const normalizedStatus = String(documentStatus || '').toLowerCase();
  const normalizedEvent = String(eventType || '').toLowerCase();

  if (normalizedStatus === 'document.completed' || normalizedEvent === 'recipient_completed') {
    return 'signed';
  }

  if (normalizedStatus === 'document.declined' || normalizedStatus === 'document.voided') {
    return 'cancelled';
  }

  if (normalizedStatus === 'document.sent' || normalizedStatus === 'document.viewed') {
    return 'sent';
  }

  return null;
}

function verifyPandaDocWebhook(req) {
  const sharedKey = process.env.PANDADOC_WEBHOOK_SHARED_KEY;
  if (!sharedKey) {
    return true;
  }

  const signatureHeader = req.headers['pandadoc-signature'] || req.headers['x-pandadoc-signature'];
  if (!signatureHeader) {
    return false;
  }

  const providedSignature = String(signatureHeader).replace(/^sha256=/i, '').trim();
  const rawBody = req.rawBody || JSON.stringify(req.body || {});
  const expectedSignature = crypto
    .createHmac('sha256', sharedKey)
    .update(rawBody)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(providedSignature), Buffer.from(expectedSignature));
  } catch {
    return false;
  }
}

async function fetchPandaDocDocumentStatus(documentId, apiKey) {
  const response = await fetch(`${pandadocBaseUrl}/documents/${documentId}`, {
    method: 'GET',
    headers: {
      Authorization: `API-Key ${apiKey}`,
      Accept: 'application/json',
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.detail || payload?.error || 'PandaDoc document status request failed.';
    throw new Error(detail);
  }

  return payload;
}

async function sendContractForESign(contract, clientAccount, profile) {
  const apiKey = process.env.PANDADOC_API_KEY;
  if (!apiKey) {
    return {
      warning: 'PandaDoc is not configured. Contract was emailed as a PDF instead.',
      signatureRequestId: null,
      providerStatus: null,
    };
  }

  const pdfBuffer = await generateContractPdf(contract, clientAccount, profile);
  const signerName = profile.full_name || profile.company_name || profile.email || 'Client';
  const [firstName, ...lastNameParts] = signerName.split(' ');
  const createPayload = {
    name: `Astronet Contract ${contract.contract_number}`,
    recipients: [
      {
        email: profile.email,
        first_name: firstName || signerName,
        last_name: lastNameParts.join(' ') || '-',
      },
    ],
    metadata: {
      contract_id: contract.id,
      contract_number: contract.contract_number,
      client_id: contract.client_id,
    },
    parse_form_fields: true,
  };

  const form = new FormData();
  form.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), `${contract.contract_number}.pdf`);
  form.append('data', JSON.stringify(createPayload));

  const createResponse = await fetch(`${pandadocBaseUrl}/documents?upload`, {
    method: 'POST',
    headers: {
      Authorization: `API-Key ${apiKey}`,
      Accept: 'application/json',
    },
    body: form,
  });

  const createResult = await createResponse.json().catch(() => ({}));
  if (!createResponse.ok) {
    const detail = createResult?.detail || createResult?.error || 'PandaDoc create document failed.';
    throw new Error(detail);
  }

  const documentId = createResult?.id;
  if (!documentId) {
    throw new Error('PandaDoc did not return a document ID.');
  }

  let documentStatus = createResult?.status || 'document.uploaded';
  for (let attempt = 0; attempt < 8 && documentStatus === 'document.uploaded'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const statusResult = await fetchPandaDocDocumentStatus(documentId, apiKey);
    documentStatus = statusResult?.status || documentStatus;
  }

  if (documentStatus === 'document.draft') {
    const sendResponse = await fetch(`${pandadocBaseUrl}/documents/${documentId}/send`, {
      method: 'POST',
      headers: {
        Authorization: `API-Key ${apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        subject: `Please sign contract ${contract.contract_number}`,
        message: `Please review and sign this contract for ${contract.project_title}.`,
        silent: false,
      }),
    });

    const sendPayload = await sendResponse.json().catch(() => ({}));
    if (!sendResponse.ok) {
      const detail = sendPayload?.detail || sendPayload?.error || 'PandaDoc send document failed.';
      throw new Error(detail);
    }

    documentStatus = sendPayload?.status || 'document.sent';
  }

  return {
    warning: null,
    signatureRequestId: documentId,
    providerStatus: mapPandaDocStatusToEsignStatus(documentStatus),
  };
}

async function enrichClients(clientAccounts) {
  const profileIds = clientAccounts.map((entry) => entry.profile_id);
  const clientIds = clientAccounts.map((entry) => entry.id);

  const [{ data: profiles, error: profilesError }, { data: invoices, error: invoicesError }, { data: contracts, error: contractsError }] = await Promise.all([
    supabaseAdmin.from('profiles').select('*').in('id', profileIds),
    supabaseAdmin.from('invoices').select('*').in('client_id', clientIds),
    supabaseAdmin.from('contracts').select('*').in('client_id', clientIds),
  ]);

  if (profilesError) {
    throw profilesError;
  }

  if (invoicesError) {
    throw invoicesError;
  }

  if (contractsError) {
    throw contractsError;
  }

  const profilesById = new Map((profiles || []).map((entry) => [entry.id, entry]));
  const invoicesByClientId = new Map();
  const contractsByClientId = new Map();

  for (const invoice of invoices || []) {
    const list = invoicesByClientId.get(invoice.client_id) || [];
    list.push(invoice);
    invoicesByClientId.set(invoice.client_id, list);
  }

  for (const contract of contracts || []) {
    const list = contractsByClientId.get(contract.client_id) || [];
    list.push(contract);
    contractsByClientId.set(contract.client_id, list);
  }

  return clientAccounts.map((account) => {
    const profile = profilesById.get(account.profile_id) || {};
    const clientInvoices = invoicesByClientId.get(account.id) || [];
    const clientContracts = contractsByClientId.get(account.id) || [];
    const unpaidTotal = clientInvoices
      .filter((invoice) => invoice.status !== 'paid')
      .reduce((sum, invoice) => sum + Number(invoice.amount_dollars || 0), 0);

    return {
      ...account,
      profile,
      invoice_count: clientInvoices.length,
      contract_count: clientContracts.length,
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

    const [invoices, contracts, changeRequests, supportQuestions, subscriptionRequests] = await Promise.all([
      fetchClientInvoices(account.id),
      fetchClientContracts(account.id),
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
      contracts,
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

    const { data: contracts, error: contractsError } = await supabaseAdmin
      .from('contracts')
      .select('*')
      .order('created_at', { ascending: false });

    if (invoicesError) {
      throw invoicesError;
    }

    if (contractsError) {
      throw contractsError;
    }

    res.json({
      clients,
      invoices: invoices || [],
      contracts: contracts || [],
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
    const invoiceDetails = buildInvoiceDetails(req.body);
    const invoicePayload = {
      client_id: req.body.clientId,
      invoice_number: buildInvoiceNumber(),
      description: req.body.description,
      site_type: invoiceDetails.siteType || null,
      extra_pages_count: invoiceDetails.extraPagesCount,
      extra_pages_type: invoiceDetails.extraPagesType || null,
      extra_features_count: invoiceDetails.extraFeaturesCount,
      extra_features_type: invoiceDetails.extraFeaturesType || null,
      line_items: invoiceDetails.lineItems,
      subtotal_dollars: invoiceDetails.subtotalDollars,
      tax_dollars: invoiceDetails.taxDollars,
      total_dollars: invoiceDetails.totalDollars,
      amount_dollars: invoiceDetails.totalDollars,
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

    const warnings = [];
    if (paymentLink.warning) {
      warnings.push(paymentLink.warning);
    }

    try {
      const emailWarning = await sendInvoiceEmail(responseInvoice, account, profile);
      if (emailWarning) {
        warnings.push(emailWarning);
      }
    } catch (emailError) {
      warnings.push(`Invoice email failed: ${normalizeError(emailError, 'Unknown email error.')}`);
    }

    res.status(201).json({
      invoice: responseInvoice,
      warning: warnings.length ? warnings.join(' ') : null,
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

app.get('/api/admin/contracts', authMiddleware, requireAdmin, async (_req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('contracts')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: normalizeError(error, 'Unable to load contracts.') });
  }
});

app.post('/api/admin/contracts', authMiddleware, requireAdmin, async (req, res) => {
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
    const totalCost = toCurrencyAmount(req.body.totalCostDollars);
    const deductiblePercent = toCurrencyAmount(req.body.deductiblePercent || 25);
    const deductibleDue = toCurrencyAmount((totalCost * deductiblePercent) / 100);
    const remainingBalance = toCurrencyAmount(totalCost - deductibleDue);

    const contractPayload = {
      client_id: req.body.clientId,
      contract_number: buildContractNumber(),
      project_title: req.body.projectTitle,
      site_type: req.body.siteType || null,
      timeline: req.body.timeline || null,
      total_cost_dollars: totalCost,
      deductible_percent: deductiblePercent,
      deductible_due_dollars: deductibleDue,
      remaining_balance_dollars: remainingBalance,
      terms_text: req.body.termsText || defaultContractTerms,
      status: req.body.status || 'sent',
      esign_provider: process.env.PANDADOC_API_KEY ? 'pandadoc' : null,
      esign_status: null,
    };

    const { data: contract, error: contractError } = await supabaseAdmin
      .from('contracts')
      .insert(contractPayload)
      .select('*')
      .single();

    if (contractError) {
      throw contractError;
    }

    const warnings = [];
    try {
      const esignResult = await sendContractForESign(contract, account, profile);

      if (esignResult.signatureRequestId) {
        const { data: updatedContract, error: updateError } = await supabaseAdmin
          .from('contracts')
          .update({
            esign_provider: 'pandadoc',
            esign_signature_request_id: esignResult.signatureRequestId,
            esign_status: esignResult.providerStatus,
            esign_last_event_at: new Date().toISOString(),
          })
          .eq('id', contract.id)
          .select('*')
          .single();

        if (updateError) {
          throw updateError;
        }

        if (esignResult.warning) {
          warnings.push(esignResult.warning);
        }

        res.status(201).json({
          contract: updatedContract,
          warning: warnings.length ? warnings.join(' ') : null,
        });
        return;
      }

      if (esignResult.warning) {
        warnings.push(esignResult.warning);
      }

      const emailWarning = await sendContractEmail(contract, account, profile);
      if (emailWarning) {
        warnings.push(emailWarning);
      }
    } catch (emailError) {
      warnings.push(`E-sign dispatch failed: ${normalizeError(emailError, 'Unknown e-sign error.')}`);
      try {
        const fallbackEmailWarning = await sendContractEmail(contract, account, profile);
        if (fallbackEmailWarning) {
          warnings.push(fallbackEmailWarning);
        }
      } catch (fallbackError) {
        warnings.push(`Contract email fallback failed: ${normalizeError(fallbackError, 'Unknown email error.')}`);
      }
    }

    res.status(201).json({
      contract,
      warning: warnings.length ? warnings.join(' ') : null,
    });
  } catch (error) {
    res.status(500).json({ error: normalizeError(error, 'Unable to create contract.') });
  }
});

app.get('/api/invoices/:invoiceId/pdf', authMiddleware, async (req, res) => {
  try {
    const invoice = await resolveInvoiceByIdForUser(req.params.invoiceId, req.user);
    const { data: account, error: accountError } = await supabaseAdmin
      .from('client_accounts')
      .select('*')
      .eq('id', invoice.client_id)
      .single();

    if (accountError) {
      throw accountError;
    }

    const profile = await getProfileByUserId(account.profile_id);
    const pdfBuffer = await generateInvoicePdf(invoice, account, profile);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${invoice.invoice_number}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    res.status(500).json({ error: normalizeError(error, 'Unable to render invoice PDF.') });
  }
});

app.get('/api/contracts/:contractId/pdf', authMiddleware, async (req, res) => {
  try {
    const contract = await resolveContractByIdForUser(req.params.contractId, req.user);
    const { data: account, error: accountError } = await supabaseAdmin
      .from('client_accounts')
      .select('*')
      .eq('id', contract.client_id)
      .single();

    if (accountError) {
      throw accountError;
    }

    const profile = await getProfileByUserId(account.profile_id);
    const pdfBuffer = await generateContractPdf(contract, account, profile);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${contract.contract_number}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    res.status(500).json({ error: normalizeError(error, 'Unable to render contract PDF.') });
  }
});

app.get('/api/contracts/:contractId/executed-pdf', authMiddleware, async (req, res) => {
  try {
    const contract = await resolveContractByIdForUser(req.params.contractId, req.user);

    if (!contract.esign_signature_request_id) {
      res.status(404).json({ error: 'No e-signature request is linked to this contract yet.' });
      return;
    }

    const apiKey = process.env.PANDADOC_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: 'PandaDoc is not configured on the server.' });
      return;
    }

    let response = await fetch(`${pandadocBaseUrl}/documents/${contract.esign_signature_request_id}/download-protected`, {
      method: 'GET',
      headers: {
        Authorization: `API-Key ${apiKey}`,
        Accept: 'application/pdf',
      },
    });

    // Sandbox keys cannot access download-protected, so fall back to download.
    if (response.status === 401) {
      response = await fetch(`${pandadocBaseUrl}/documents/${contract.esign_signature_request_id}/download`, {
        method: 'GET',
        headers: {
          Authorization: `API-Key ${apiKey}`,
          Accept: 'application/pdf',
        },
      });
    }

    if (response.status === 202) {
      res.status(409).json({ error: 'Signed PDF is still being prepared. Please retry in a moment.' });
      return;
    }

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      const detail = errorPayload?.detail || errorPayload?.error || 'Unable to fetch executed contract from PandaDoc.';
      throw new Error(detail);
    }

    const pdfBuffer = Buffer.from(await response.arrayBuffer());
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${contract.contract_number}-executed.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    res.status(500).json({ error: normalizeError(error, 'Unable to render executed contract PDF.') });
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

app.post('/api/webhooks/pandadoc', async (req, res) => {
  const acknowledge = () => res.status(200).send('PandaDoc webhook received');

  try {
    if (!verifyPandaDocWebhook(req)) {
      res.status(401).json({ error: 'Invalid PandaDoc webhook signature.' });
      return;
    }

    const payload = req.body || {};
    const eventType = payload.event_type || payload.type || payload.event || null;
    const documentInfo = payload?.data?.document || payload?.data || payload?.document || {};
    const signatureRequestId = documentInfo.id || payload.document_id || null;

    if (!signatureRequestId) {
      acknowledge();
      return;
    }

    const documentStatus = documentInfo.status || payload?.data?.status || payload.status || null;
    const contractState = mapPandaDocStatusToContractState(documentStatus, eventType);

    const updatePayload = {
      esign_status: mapPandaDocStatusToEsignStatus(documentStatus, eventType),
      esign_last_event_at: new Date().toISOString(),
    };

    if (contractState) {
      updatePayload.status = contractState;
    }

    if (contractState === 'signed') {
      updatePayload.signed_at = new Date().toISOString();
    }

    const contractMetadataId = payload?.data?.metadata?.contract_id;
    let updateQuery = supabaseAdmin
      .from('contracts')
      .update(updatePayload)
      .eq('esign_signature_request_id', signatureRequestId);

    if (contractMetadataId) {
      updateQuery = updateQuery.eq('id', contractMetadataId);
    }

    const { error } = await updateQuery;

    if (error) {
      throw error;
    }

    acknowledge();
  } catch (error) {
    console.error('PandaDoc webhook error:', error);
    acknowledge();
  }
});

app.get('/api/webhooks/pandadoc', (_req, res) => {
  res.status(200).type('text/plain').send('PandaDoc webhook endpoint is online.');
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