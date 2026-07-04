const crypto = require('crypto');
const fs = require('fs');
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
  'ASTRONET STUDIOS Website Design & Development Agreement',
  '',
  'This Agreement is entered into between Astronet Studios (Developer) and the Client listed in this contract.',
  '',
  '1. Project',
  'Developer agrees to design and develop the website project described in this contract.',
  '',
  '2. Project Price and Deposit',
  'A 25% deposit is required before work begins. The remaining balance is due before the website is published or transferred to production.',
  '',
  '3. Payment Terms',
  'Invoices are due within 14 days unless otherwise agreed. Late invoices may incur a late fee of $25 or 1.5% per month, whichever is permitted by applicable law.',
  '',
  '4. Scope of Work',
  'Only services listed in the approved proposal are included. Additional work outside the original scope requires written approval and may incur added charges.',
  '',
  '5. Revisions',
  'Two revision rounds are included unless otherwise specified in writing.',
  '',
  '6. Client Responsibilities',
  'Client agrees to provide content, branding, access, and approvals promptly. Delays may extend project timeline.',
  '',
  '7. Timeline',
  'Delivery dates are estimates and may change due to client delays, third-party outages, hosting issues, or scope changes.',
  '',
  '8. Intellectual Property',
  'Client retains ownership of their logos, images, written content, trademarks, and branding. Astronet Studios retains ownership of proprietary frameworks, source code, templates, components, internal tools, reusable libraries, backend systems, and custom CMS software unless otherwise agreed in writing. Upon full payment, Client receives a perpetual license to use the completed website for business purposes.',
  '',
  '9. Domain and Hosting',
  'Unless otherwise agreed, Client owns domain name, Cloudflare account, and business email accounts. Astronet Studios may manage these with authorization. If Astronet Studios provides hosting, the website remains on Astronet Studios infrastructure while hosting services remain active.',
  '',
  '10. Maintenance',
  'Maintenance is optional and billed separately from project cost.',
  '',
  '11. Launch',
  'Website launch requires final approval, final payment, and required account access.',
  '',
  '12. Cancellation',
  'Either party may terminate this Agreement in writing. Initial deposit is non-refundable once work has begun. Client remains responsible for completed work performed prior to termination.',
  '',
  '13. Warranty',
  'Astronet Studios warrants substantial functionality as described upon delivery for 30 days after launch. Warranty excludes third-party software changes, hosting issues outside our control, client modifications, and browser updates released after delivery.',
  '',
  '14. Limitation of Liability',
  'Astronet Studios is not liable for indirect, incidental, consequential, or lost-profit damages. Total liability will not exceed the amount paid under this Agreement.',
  '',
  '15. Portfolio Rights',
  'Unless otherwise agreed, Astronet Studios may display completed work in portfolio and marketing materials without disclosing confidential information.',
  '',
  '16. Governing Law',
  'This Agreement is governed by the laws of the State of New York.',
  '',
  '17. Entire Agreement',
  'This document is the complete agreement between both parties. Changes must be in writing and signed by both parties.',
].join('\n');
const contractBusinessName = process.env.CONTRACT_BUSINESS_NAME || 'Astronet Studios';
const contractBusinessSigner = process.env.CONTRACT_SIGNER_NAME || 'Joseph Kadet';
const contractBusinessSignatureDisplay = process.env.CONTRACT_SIGNATURE_DISPLAY_NAME || contractBusinessSigner;
const contractBusinessRole = process.env.CONTRACT_SIGNER_ROLE || 'Owner|Partner';
const contractSignatureFontPath = process.env.CONTRACT_SIGNATURE_FONT_PATH || '';
const fixedContractDeductiblePercent = 25;
const fixedContractPaymentDueDays = 14;
const fixedContractRevisionHourlyRate = 25;
const fixedContractRevisionPerRevisionRate = 100;
const fixedContractLateFeeFlatDollars = 25;
const fixedContractLateFeePercentMonthly = 1.5;
const fixedContractWarrantyDays = 30;
const standardNySalesTaxRate = 0.04;
const standardNySalesTaxLabel = `${(standardNySalesTaxRate * 100).toFixed(0)}%`;
const adminContractSelectFields = [
  'id',
  'client_id',
  'contract_number',
  'project_title',
  'status',
  'esign_status',
  'esign_signature_request_id',
  'total_cost_dollars',
  'deductible_due_dollars',
  'created_at',
].join(',');
const parsedContractSignatureLetterSpacing = Number(process.env.CONTRACT_SIGNATURE_LETTER_SPACING);
const contractSignatureLetterSpacing = Number.isFinite(parsedContractSignatureLetterSpacing)
  ? parsedContractSignatureLetterSpacing
  : -1.25;

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

function cleanContractValue(value, fallback = '') {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

function buildContractAgreementText(contract, clientAccount, profile) {
  const projectName = cleanContractValue(contract.project_name, cleanContractValue(contract.project_title, 'Website Project'));
  const packageName = cleanContractValue(contract.package_name, cleanContractValue(contract.site_type, 'Not specified'));
  const projectDescription = cleanContractValue(contract.project_description, 'See approved proposal and project notes.');
  const clientName = cleanContractValue(profile.full_name, profile.company_name || profile.email || 'Client');
  const clientBusinessName = cleanContractValue(profile.company_name, 'Not provided');
  const clientPhone = cleanContractValue(clientAccount.phone_number, cleanContractValue(profile.phone, 'Not provided'));
  const clientEmail = cleanContractValue(profile.email, 'Not provided');
  const revisionRounds = 2;
  const revisionHourlyRate = fixedContractRevisionHourlyRate;
  const revisionPerRevisionRate = fixedContractRevisionPerRevisionRate;
  const paymentDueDays = fixedContractPaymentDueDays;
  const lateFeeFlat = fixedContractLateFeeFlatDollars;
  const lateFeePercent = fixedContractLateFeePercentMonthly;
  const governingLawState = 'New York';
  const warrantyDays = fixedContractWarrantyDays;
  const completionText = cleanContractValue(contract.timeline, 'Not specified');

  return [
    'ASTRONET STUDIOS Website Design & Development Agreement',
    `Contract #: ${cleanContractValue(contract.contract_number)}`,
    `Date: ${new Date(contract.created_at || Date.now()).toLocaleDateString('en-US')}`,
    '',
    '1. Parties',
    'This Website Design & Development Agreement ("Agreement") is entered into between:',
    `Astronet Studios ("Developer") and Client Name: ${clientName}`,
    `Business Name: ${clientBusinessName}`,
    `Phone: ${clientPhone}`,
    `Email: ${clientEmail}`,
    '',
    '2. Project',
    'Developer agrees to design and develop the following:',
    `Project Name: ${projectName}`,
    `Package: ${packageName}`,
    `Project Description: ${projectDescription}`,
    '',
    '3. Project Price',
    `Total Project Cost: ${formatCurrency(contract.total_cost_dollars)}`,
    `Deposit Required (${contract.deductible_percent}%): ${formatCurrency(contract.deductible_due_dollars)}`,
    `Balance Due: ${formatCurrency(contract.remaining_balance_dollars)}`,
    'Work begins after the deposit has been received. Remaining balance is due before website publication or production transfer.',
    '',
    '4. Payment Terms',
    'Payments may be made by Square, Check, Credit Card, or other approved payment methods.',
    `Invoices are due within ${paymentDueDays} days unless otherwise agreed.`,
    'Astronet Studios may suspend work until overdue invoices are paid.',
    `Late invoices may incur a late fee of ${formatCurrency(lateFeeFlat)} or ${lateFeePercent}% per month, whichever is permitted by applicable law.`,
    '',
    '5. Scope of Work',
    'This agreement includes only services listed in the approved proposal. Additional work outside the original scope requires written approval and may incur additional charges.',
    '',
    '6. Revisions',
    `Included revision rounds: ${revisionRounds}.`,
    `Additional revisions are billed at ${formatCurrency(revisionHourlyRate)} per hour or ${formatCurrency(revisionPerRevisionRate)} per revision.`,
    '',
    '7. Client Responsibilities',
    'Client agrees to provide logos, images, written content, branding, account access, feedback, and required approvals.',
    'Project timelines may be extended if required information is not provided promptly.',
    '',
    '8. Timeline',
    `Estimated completion: ${completionText}.`,
    'Delivery dates are estimates and may change due to client delays, third-party outages, hosting issues, or scope changes.',
    '',
    '9. Intellectual Property',
    'Client retains ownership of logos, images provided by client, written content, trademarks, and business branding.',
    'Astronet Studios retains ownership of source code, proprietary frameworks, templates, components, internal software, development tools, reusable libraries, backend systems, and custom CMS software unless otherwise agreed in writing.',
    'This Agreement does not transfer ownership of Astronet Studios proprietary software or development framework.',
    '',
    '10. Domain & Hosting',
    'Unless otherwise agreed, Client owns domain name, Cloudflare account, and business email accounts.',
    'Astronet Studios may manage these accounts with Client authorization.',
    'If Astronet Studios provides hosting, website remains hosted on Astronet Studios infrastructure while hosting services remain active.',
    '',
    '11. Maintenance',
    'Maintenance is optional and separate from project cost. Plans may include security updates, backups, bug fixes, content updates, technical support, and performance monitoring.',
    '',
    '12. Launch',
    'Website will be published after final approval, final payment, and required account access are provided.',
    '',
    '13. Cancellation',
    'Either party may terminate this Agreement in writing.',
    'Initial deposit is non-refundable once work has begun.',
    '',
    '14. Warranty',
    `Astronet Studios warrants substantial functionality as described upon delivery for ${warrantyDays} days after launch.`,
    'Warranty does not cover third-party software changes, hosting issues outside our control, client modifications, or browser updates released after delivery.',
    '',
    '15. Limitation of Liability',
    'Astronet Studios shall not be liable for indirect, incidental, consequential, or lost-profit damages arising from website use.',
    '',
    '16. Portfolio Rights',
    'Unless otherwise agreed, Astronet Studios may display the completed project in portfolio and marketing materials. Confidential information will never be disclosed.',
    '',
    '17. Governing Law',
    `This Agreement is governed by the laws of the State of ${governingLawState}.`,
    '',
    '18. Entire Agreement',
    'This document represents the complete agreement between both parties. Any changes must be made in writing and signed by both parties.',
  ].join('\n');
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
  const taxDollars = toCurrencyAmount(subtotal * standardNySalesTaxRate);
  const total = toCurrencyAmount(subtotal + taxDollars);

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

function mergeContractOptionSelections(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  const totalsByType = new Map();

  input.forEach((entry) => {
    const type = String(entry.type || '').trim();
    const count = parseCount(entry.count);

    if (!type || count <= 0) {
      return;
    }

    const existing = totalsByType.get(type) || 0;
    totalsByType.set(type, existing + count);
  });

  return Array.from(totalsByType.entries()).map(([type, count]) => ({ type, count }));
}

function buildContractPricingDetails(body) {
  const packageName = String(body.packageName || body.siteType || '').trim();
  const pageSelections = mergeContractOptionSelections(body.extraPageSelections);
  const featureSelections = mergeContractOptionSelections(body.extraFeatureSelections);
  const pageSummary = pageSelections.map((entry) => `${entry.type} x${entry.count}`).join(', ');
  const featureSummary = featureSelections.map((entry) => `${entry.type} x${entry.count}`).join(', ');

  let subtotal = siteTypeBasePricing[packageName] || 0;

  pageSelections.forEach((entry) => {
    const unit = extraPageTypePricing[entry.type] || 0;
    subtotal += unit * entry.count;
  });

  featureSelections.forEach((entry) => {
    const unit = extraFeatureTypePricing[entry.type] || 0;
    subtotal += unit * entry.count;
  });

  const taxDollars = toCurrencyAmount(subtotal * standardNySalesTaxRate);
  const total = toCurrencyAmount(subtotal + taxDollars);

  return {
    packageName,
    subtotalDollars: toCurrencyAmount(subtotal),
    taxDollars,
    totalCostDollars: toCurrencyAmount(total),
    extraPagesCount: pageSelections.reduce((sum, entry) => sum + entry.count, 0),
    extraPagesType: pageSummary || null,
    extraFeaturesCount: featureSelections.reduce((sum, entry) => sum + entry.count, 0),
    extraFeaturesType: featureSummary || null,
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

function renderContractTermsWithPageBreaks(doc, text, options = {}) {
  const width = options.width || 500;
  const left = options.left || 50;
  const bottomMargin = options.bottomMargin || 72;
  const headingPattern = /^\d+\.\s+/;
  const lines = String(text || '').split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      doc.moveDown(0.34);
      continue;
    }

    const isHeading = headingPattern.test(line);
    const fontSize = isHeading ? 10.5 : 9.5;
    const estimatedHeight = doc.fontSize(fontSize).heightOfString(line, {
      width,
      lineGap: 3,
      align: 'left',
    });

    const minimumRoom = isHeading ? 90 : 40;
    if ((doc.y + estimatedHeight > doc.page.height - bottomMargin) || (isHeading && doc.y > doc.page.height - minimumRoom)) {
      doc.addPage();
    }

    doc
      .fontSize(fontSize)
      .fillColor(isHeading ? '#0f172a' : '#334155')
      .text(line, left, doc.y, {
        width,
        align: 'left',
        lineGap: 3,
      });
  }

  doc.fontSize(10).fillColor('#334155');
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
    const businessDate = new Date(contract.created_at || Date.now()).toLocaleDateString('en-US');
    doc.fontSize(20).fillColor('#0f172a').text('ASTRONET STUDIOS Website Design & Development Agreement');
    doc.moveDown(0.4);
    doc.fontSize(10).fillColor('#334155').text(`Contract #: ${contract.contract_number}`);
    doc.text(`Created: ${new Date(contract.created_at || Date.now()).toLocaleDateString('en-US')}`);
    doc.moveDown(0.8);

    doc.fontSize(11).fillColor('#0f172a').text('Client Information');
    doc.fontSize(10).fillColor('#334155').text(profile.company_name || profile.full_name || profile.email);
    doc.text(profile.email || '');
    if (clientAccount.phone_number || profile.phone) {
      doc.text(clientAccount.phone_number || profile.phone);
    }
    if (clientAccount.website_url) {
      doc.text(clientAccount.website_url);
    }
    doc.moveDown(0.8);

    doc.fontSize(11).fillColor('#0f172a').text('Project Details');
    doc.fontSize(10).fillColor('#334155').text(`Project: ${contract.project_title}`);
    doc.text(`Package: ${contract.package_name || contract.site_type || 'Not specified'}`);
    doc.text(`Extra pages: ${Number(contract.extra_pages_count || 0)}`);
    doc.text(`Page Type: ${contract.extra_pages_type || 'None'}`);
    doc.text(`Extra features: ${Number(contract.extra_features_count || 0)}`);
    doc.text(`Feature Type: ${contract.extra_features_type || 'None'}`);
    if (contract.project_description) {
      doc.text(`Description: ${contract.project_description}`);
    }
    doc.text(`Timeline: ${contract.timeline || 'Not specified'}`);
    doc.text(`Subtotal: ${formatCurrency(contract.subtotal_dollars || contract.total_cost_dollars)}`);
    doc.text(`Sales Tax (NY ${standardNySalesTaxLabel}): ${formatCurrency(contract.tax_dollars || 0)}`);
    doc.text(`Total Cost: ${formatCurrency(contract.total_cost_dollars)}`);
    doc.text(`Due Before Project Start (${contract.deductible_percent}%): ${formatCurrency(contract.deductible_due_dollars)}`);
    doc.text(`Remaining Balance: ${formatCurrency(contract.remaining_balance_dollars)}`);
    doc.moveDown(1);

    doc.fontSize(11).fillColor('#0f172a').text('Agreement Terms');
    doc.moveDown(0.5);
    const contractTerms = cleanContractValue(contract.terms_text)
      ? contract.terms_text
      : buildContractAgreementText(contract, clientAccount, profile) || defaultContractTerms;
    renderContractTermsWithPageBreaks(doc, contractTerms, {
      width: 500,
      left: 50,
      bottomMargin: 72,
    });

    const minRoomForSignatures = 220;
    if (doc.y > doc.page.height - minRoomForSignatures) {
      doc.addPage();
    }

    const left = 72;
    const right = 520;
    const panelTop = doc.y + 8;
    const panelHeight = 126;
    doc.roundedRect(left, panelTop, right - left, panelHeight, 8)
      .fillAndStroke('#f8fafc', '#cbd5e1');

    const resolvedSignatureFontPath = contractSignatureFontPath
      ? (path.isAbsolute(contractSignatureFontPath)
        ? contractSignatureFontPath
        : path.join(__dirname, '..', contractSignatureFontPath))
      : null;
    const canUseCustomSignatureFont = Boolean(
      resolvedSignatureFontPath && fs.existsSync(resolvedSignatureFontPath)
    );
    if (canUseCustomSignatureFont) {
      doc.registerFont('contract-signature-font', resolvedSignatureFontPath);
    }

    doc.fillColor('#0f172a').fontSize(11).text('Developer Signature', left + 12, panelTop + 10);
    doc.fillColor('#334155').fontSize(10).text(`Business Name: ${contractBusinessName}`, left + 12, panelTop + 30);
    doc.text('Signature:', left + 12, panelTop + 52);
    doc.font(canUseCustomSignatureFont ? 'contract-signature-font' : 'Times-Italic')
      .fontSize(canUseCustomSignatureFont ? 21 : 18)
      .fillColor('#0f172a')
      .text(contractBusinessSignatureDisplay, left + 74, panelTop + 44, {
        characterSpacing: canUseCustomSignatureFont ? contractSignatureLetterSpacing : 0,
        features: ['liga', 'clig', 'calt', 'kern'],
      });
    doc.font('Helvetica').fillColor('#334155').fontSize(10).text(`Printed Name: ${contractBusinessSigner}`, left + 12, panelTop + 68);
    doc.text(`Date: ${businessDate}`, left + 12, panelTop + 82);
    doc.text(`Role: ${contractBusinessRole}`, left + 12, panelTop + 96);

    const clientTop = panelTop + panelHeight + 18;
    doc.fillColor('#0f172a').fontSize(11).text('Client Signature', left, clientTop);

    const clientSigLabelY = clientTop + 20;
    const clientSigLineY = clientSigLabelY + 13;
    doc.fontSize(10).fillColor('#0f172a').text('Client Signature:', left, clientSigLabelY);
    doc.moveTo(left + 95, clientSigLineY)
      .lineTo(right - 12, clientSigLineY)
      .lineWidth(1)
      .strokeColor('#475569')
      .stroke();

    const clientDateLabelY = clientSigLabelY + 24;
    const clientDateLineY = clientDateLabelY + 13;
    doc.fillColor('#0f172a').text('Date:', left, clientDateLabelY);
    doc.moveTo(left + 35, clientDateLineY)
      .lineTo(left + 220, clientDateLineY)
      .lineWidth(1)
      .strokeColor('#475569')
      .stroke();

    const clientNameLabelY = clientDateLabelY + 24;
    const clientNameLineY = clientNameLabelY + 13;
    doc.fillColor('#0f172a').text('Client Name:', left, clientNameLabelY);
    doc.moveTo(left + 68, clientNameLineY)
      .lineTo(right - 12, clientNameLineY)
      .lineWidth(1)
      .strokeColor('#475569')
      .stroke();
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

async function createSquareContractDepositPaymentLink(contract, clientAccount, profile) {
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
        name: `Deposit for ${contract.contract_number} (${profile.company_name || profile.full_name || profile.email})`,
        price_money: {
          amount: Math.round(Number(contract.deductible_due_dollars) * 100),
          currency: 'USD',
        },
        location_id: process.env.SQUARE_LOCATION_ID,
      },
      checkout_options: {
        redirect_url: `${publicAppUrl}/dashboard.html?contract=${contract.id}`,
      },
      pre_populated_data: {
        buyer_email: profile.email,
      },
      description: [
        `Contract deposit for ${contract.contract_number}`,
        contract.project_title ? `Project: ${contract.project_title}` : null,
        clientAccount.website_url ? `Website: ${clientAccount.website_url}` : null,
      ].filter(Boolean).join(' | '),
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    const detail = payload.errors?.map((entry) => entry.detail).join(', ');
    throw new Error(detail || 'Square contract deposit link creation failed.');
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
  const depositLinkText = contract.square_payment_link_url
    ? `\nAfter you sign, use this link to pay your 25% security deposit: ${contract.square_payment_link_url}`
    : '\nAfter you sign, use the deposit payment link we send to pay your 25% security deposit.';
  const depositLinkHtml = contract.square_payment_link_url
    ? `<p>After you sign, use this link to pay your 25% security deposit: <a href="${contract.square_payment_link_url}">Pay 25% deposit</a></p>`
    : '<p>After you sign, use the deposit payment link we send to pay your 25% security deposit.</p>';

  return sendEmailWithAttachment({
    to: profile.email,
    subject: `Contract ${contract.contract_number} from Astronet Studios`,
    text: `Hello ${profile.full_name || profile.company_name || 'Client'},\n\nYour project contract is attached as a PDF. Please review, sign, and send the signed contract back by replying to this email.${depositLinkText}\n\nThank you,\nAstronet Studios`,
    html: `<p>Hello ${profile.full_name || profile.company_name || 'Client'},</p><p>Your project contract is attached as a PDF.</p><p>Please review, sign, and send the signed contract back by replying to this email.</p>${depositLinkHtml}<p>Thank you,<br/>Astronet Studios</p>`,
    attachmentName: `${contract.contract_number}.pdf`,
    attachmentBuffer: pdfBuffer,
  });
}

async function enrichClients(clientAccounts) {
  const profileIds = clientAccounts.map((entry) => entry.profile_id);
  const clientIds = clientAccounts.map((entry) => entry.id);

  const [{ data: profiles, error: profilesError }, { data: invoices, error: invoicesError }, { data: contracts, error: contractsError }] = await Promise.all([
    supabaseAdmin.from('profiles').select('*').in('id', profileIds),
    supabaseAdmin.from('invoices').select('*').in('client_id', clientIds),
    supabaseAdmin.from('contracts').select('id,client_id').in('client_id', clientIds),
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

app.post('/api/contact', async (req, res) => {
  try {
    const fullName = String(req.body.fullName || '').trim();
    const email = String(req.body.email || '').trim();
    const phone = String(req.body.phone || '').trim();
    const company = String(req.body.company || '').trim();
    const budget = String(req.body.budget || '').trim();
    const timeline = String(req.body.timeline || '').trim();
    const message = String(req.body.message || '').trim();
    const website = String(req.body.website || '').trim();

    if (website) {
      res.status(200).json({
        success: true,
        message: 'Thanks! Your request has been received.',
      });
      return;
    }

    if (!fullName || !email || !message) {
      res.status(400).json({ error: 'Full name, email, and message are required.' });
      return;
    }

    const recipient = process.env.CONTACT_FORM_TO || 'astronetstudios@gmail.com';
    const subject = `New website inquiry from ${fullName}`;
    const text = [
      'New contact form submission',
      '',
      `Name: ${fullName}`,
      `Email: ${email}`,
      `Phone: ${phone || 'Not provided'}`,
      `Company: ${company || 'Not provided'}`,
      `Budget: ${budget || 'Not provided'}`,
      `Timeline: ${timeline || 'Not provided'}`,
      '',
      'Message:',
      message,
      '',
      `Submitted at: ${new Date().toISOString()}`,
    ].join('\n');
    const html = `
      <p><strong>New contact form submission</strong></p>
      <p><strong>Name:</strong> ${fullName}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Phone:</strong> ${phone || 'Not provided'}</p>
      <p><strong>Company:</strong> ${company || 'Not provided'}</p>
      <p><strong>Budget:</strong> ${budget || 'Not provided'}</p>
      <p><strong>Timeline:</strong> ${timeline || 'Not provided'}</p>
      <p><strong>Message:</strong></p>
      <p>${message.replace(/\n/g, '<br/>')}</p>
      <p><em>Submitted at: ${new Date().toISOString()}</em></p>
    `;

    const warning = await sendEmailWithAttachment({
      to: recipient,
      subject,
      text,
      html,
      attachmentName: null,
      attachmentBuffer: null,
    });

    if (warning) {
      res.status(503).json({ error: warning });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Thank you. Your message has been sent successfully.',
    });
  } catch (error) {
    res.status(500).json({ error: normalizeError(error, 'Unable to send your message right now.') });
  }
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
      .select(adminContractSelectFields)
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
        phone_number: req.body.phoneNumber || null,
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
        phone_number: req.body.phoneNumber || null,
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
      .select(adminContractSelectFields)
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
    const pricing = buildContractPricingDetails(req.body);
    const totalCost = pricing.totalCostDollars;
    const deductiblePercent = fixedContractDeductiblePercent;
    const deductibleDue = toCurrencyAmount((totalCost * deductiblePercent) / 100);
    const remainingBalance = toCurrencyAmount(totalCost - deductibleDue);
    const packageName = pricing.packageName || null;

    const contractPayload = {
      client_id: req.body.clientId,
      contract_number: buildContractNumber(),
      project_title: req.body.projectTitle,
      project_name: req.body.projectTitle,
      package_name: packageName,
      project_description: req.body.projectDescription || null,
      site_type: packageName,
      timeline: req.body.timeline || null,
      estimated_completion_weeks: null,
      extra_pages_count: pricing.extraPagesCount,
      extra_pages_type: pricing.extraPagesType,
      extra_features_count: pricing.extraFeaturesCount,
      extra_features_type: pricing.extraFeaturesType,
      subtotal_dollars: pricing.subtotalDollars,
      tax_dollars: pricing.taxDollars,
      total_cost_dollars: totalCost,
      deductible_percent: deductiblePercent,
      deductible_due_dollars: deductibleDue,
      remaining_balance_dollars: remainingBalance,
      payment_due_days: fixedContractPaymentDueDays,
      late_fee_flat_dollars: fixedContractLateFeeFlatDollars,
      late_fee_percent_monthly: fixedContractLateFeePercentMonthly,
      revision_rounds: 2,
      additional_revision_hourly_rate: fixedContractRevisionHourlyRate,
      additional_revision_per_revision_rate: fixedContractRevisionPerRevisionRate,
      client_business_name: profile.company_name || null,
      client_address: profile.address || null,
      client_phone: profile.phone || null,
      client_email: profile.email || null,
      governing_law_state: 'New York',
      warranty_days: fixedContractWarrantyDays,
      terms_text: req.body.termsText || null,
      status: req.body.status || 'sent',
      square_payment_link_id: null,
      square_payment_link_url: null,
      esign_provider: null,
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
    let responseContract = contract;

    const depositPaymentLink = await createSquareContractDepositPaymentLink(contract, account, profile);
    if (depositPaymentLink.url) {
      const { data: updatedContract, error: updateContractError } = await supabaseAdmin
        .from('contracts')
        .update({
          square_payment_link_id: depositPaymentLink.id,
          square_payment_link_url: depositPaymentLink.url,
        })
        .eq('id', contract.id)
        .select('*')
        .single();

      if (updateContractError) {
        throw updateContractError;
      }

      responseContract = updatedContract;
    }

    if (depositPaymentLink.warning) {
      warnings.push(depositPaymentLink.warning);
    }

    try {
      const emailWarning = await sendContractEmail(responseContract, account, profile);
      if (emailWarning) {
        warnings.push(emailWarning);
      }
    } catch (emailError) {
      warnings.push(`Contract email failed: ${normalizeError(emailError, 'Unknown email error.')}`);
    }

    res.status(201).json({
      contract: responseContract,
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
    await resolveContractByIdForUser(req.params.contractId, req.user);
    res.status(404).json({
      error: 'Executed contract file is not hosted by the app in manual-sign mode. Ask the client to return the signed PDF via email.',
    });
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

app.get('*', (req, res) => {
  const requestPath = req.path.toLowerCase();

  if (requestPath === '/index.html' || requestPath === '/index') {
    res.redirect(301, '/');
    return;
  }

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