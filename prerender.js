#!/usr/bin/env node
/**
 * Pre-render Build Script for Creative Kaygency
 * ================================================
 * Generates static HTML files for every public route so search engines
 * can crawl and index full page content without executing JavaScript.
 *
 * Usage:  node prerender.js
 * Output: ./dist/ directory with static HTML files
 *
 * Each generated file contains:
 *   - Full <head> with route-specific meta tags, Open Graph, canonical URLs
 *   - JSON-LD structured data per page
 *   - Visible SEO content (headings, descriptions, feature lists)
 *   - A <script> that boots the SPA for full interactivity
 *
 * The SPA takes over once JS loads, so users get the rich interactive
 * experience while bots get pre-rendered, crawlable HTML.
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------------
const SITE_URL = 'https://www.creativekaygency.com';
const DIST_DIR = path.join(__dirname, 'dist');
const SRC_FILE = path.join(__dirname, 'index.html');

// Read source to extract data
const srcHTML = fs.readFileSync(SRC_FILE, 'utf-8');

// ---------------------------------------------------------------------------
// DATA EXTRACTION — pull arrays from the SPA source
// ---------------------------------------------------------------------------

function extractJSArray(varName) {
  // Find the variable declaration and extract the array content
  const regex = new RegExp(`const ${varName}\\s*=\\s*\\[`, 'm');
  const match = srcHTML.match(regex);
  if (!match) return [];

  let start = match.index + match[0].length - 1;
  let depth = 0;
  let i = start;
  for (; i < srcHTML.length; i++) {
    if (srcHTML[i] === '[') depth++;
    else if (srcHTML[i] === ']') { depth--; if (depth === 0) break; }
  }
  const raw = srcHTML.substring(start, i + 1);

  // Convert JS object notation to JSON-ish (handle single quotes, unquoted keys, trailing commas)
  try {
    let jsonStr = raw
      .replace(/\/\/.*$/gm, '')          // remove line comments
      .replace(/\/\*[\s\S]*?\*\//g, '')  // remove block comments
      .replace(/(\w+)\s*:/g, '"$1":')    // quote keys
      .replace(/'/g, '"')                // single to double quotes
      .replace(/,\s*([}\]])/g, '$1')     // trailing commas
      .replace(/\.\.\.\w+/g, '""')       // spread operators
      .replace(/`[^`]*`/g, '""')         // template literals
      .replace(/\b(true|false|null)\b/g, '$&') // keep booleans
      .replace(/"(true|false|null)"/g, '$1');   // unquote booleans
    return JSON.parse(jsonStr);
  } catch (e) {
    console.warn(`  Warning: Could not auto-parse ${varName}, using manual extraction`);
    return manualExtract(varName);
  }
}

function manualExtract(varName) {
  // Fallback: extract individual objects with regex
  const items = [];
  const regex = new RegExp(`const ${varName}\\s*=\\s*\\[([\\s\\S]*?)\\];`, 'm');
  const match = srcHTML.match(regex);
  if (!match) return items;

  const block = match[1];
  const objRegex = /\{\s*id:\s*'([^']+)'[^}]*name:\s*'([^']+)'[^}]*(?:desc:\s*'([^']*)')?[^}]*(?:slug:\s*'([^']*)')?[^}]*(?:icon:\s*'([^']*)')?[^}]*(?:creditMin:\s*(\d+))?[^}]*(?:creditMax:\s*(\d+))?[^}]*(?:longDesc:\s*'([^']*)')?[^}]*(?:category:\s*'([^']*)')?[^}]*(?:turnaround:\s*'([^']*)')?[^}]*(?:metaTitle:\s*'([^']*)')?[^}]*(?:metaDescription:\s*'([^']*)')?[^}]*(?:metaKeywords:\s*'([^']*)')?/g;

  let m;
  while ((m = objRegex.exec(block)) !== null) {
    items.push({
      id: m[1], name: m[2], desc: m[3] || '', slug: m[4] || '',
      icon: m[5] || '', creditMin: parseInt(m[6]) || 0, creditMax: parseInt(m[7]) || 0,
      longDesc: m[8] || '', category: m[9] || '', turnaround: m[10] || '',
      metaTitle: m[11] || '', metaDescription: m[12] || '', metaKeywords: m[13] || ''
    });
  }
  return items;
}

// Extract services manually (more reliable for complex objects)
function extractServices() {
  const services = [];
  // Match both formats: with and without slug field
  const regex = /\{\s*id:\s*'([^']+)',\s*name:\s*'([^']+)',\s*(?:slug:\s*'([^']*)',\s*)?category:\s*'([^']*)',\s*icon:\s*'([^']*)',\s*desc:\s*'([^']*)',\s*longDesc:\s*'([^']*)'[^}]*?creditMin:\s*(\d+),\s*creditMax:\s*(\d+)[^}]*?turnaround:\s*'([^']*)'/g;
  let m;
  while ((m = regex.exec(srcHTML)) !== null) {
    services.push({
      id: m[1], name: m[2], slug: m[3] || m[1], category: m[4],
      icon: m[5], desc: m[6], longDesc: m[7],
      creditMin: parseInt(m[8]), creditMax: parseInt(m[9]),
      turnaround: m[10]
    });
  }
  return services;
}

function extractBlogPosts() {
  const posts = [];
  // Blog posts: slug, title, category, excerpt, date, readTime, author, content
  const regex = /\{\s*slug:\s*'([^']+)',\s*title:\s*'([^']+)',\s*category:\s*'([^']*)',\s*excerpt:\s*'([^']*)',\s*date:\s*'([^']*)'/g;
  let m;
  while ((m = regex.exec(srcHTML)) !== null) {
    posts.push({ slug: m[1], title: m[2], category: m[3], excerpt: m[4], date: m[5] });
  }
  return posts;
}

function extractKBArticles() {
  const articles = [];
  // KB articles: slug, title, category, readTime, content (no date/excerpt/author fields)
  const kbBlock = srcHTML.match(/const KB_ARTICLES\s*=\s*\[([\s\S]*?)\];\s*\n/);
  if (!kbBlock) return articles;
  const regex = /\{\s*slug:\s*'([^']+)',\s*title:\s*'([^']+)',\s*category:\s*'([^']*)'/g;
  let m;
  while ((m = regex.exec(kbBlock[1])) !== null) {
    articles.push({ slug: m[1], title: m[2], category: m[3] });
  }
  return articles;
}

function extractCategories() {
  const cats = [];
  const regex = /\{\s*id:\s*'([^']+)',\s*name:\s*'([^']+)',\s*icon:\s*'([^']*)',\s*desc:\s*'([^']*)'\s*\}/g;
  // Find within CATEGORIES block
  const catBlock = srcHTML.match(/const CATEGORIES\s*=\s*\[([\s\S]*?)\];/);
  if (!catBlock) return cats;
  let m;
  while ((m = regex.exec(catBlock[1])) !== null) {
    cats.push({ id: m[1], name: m[2], icon: m[3], desc: m[4] });
  }
  return cats;
}

const SERVICES = extractServices();
const BLOG_POSTS = extractBlogPosts();
const CATEGORIES = extractCategories();
const KB_ARTICLES = extractKBArticles();

console.log(`Extracted: ${SERVICES.length} services, ${BLOG_POSTS.length} blog posts, ${KB_ARTICLES.length} KB articles, ${CATEGORIES.length} categories`);

// ---------------------------------------------------------------------------
// HTML TEMPLATE
// ---------------------------------------------------------------------------

function htmlShell({ route, title, description, keywords, canonical, ogTitle, ogDesc, ogType, bodyContent, jsonLd, extraJsonLd, noindex }) {
  const fullCanonical = canonical || `${SITE_URL}${route}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-Content-Type-Options" content="nosniff">
  <meta http-equiv="X-Frame-Options" content="DENY">
  <meta http-equiv="Referrer-Policy" content="strict-origin-when-cross-origin">
  <title>${escHtml(title)}</title>
  <meta name="description" content="${escHtml(description)}">
  <meta name="keywords" content="${escHtml(keywords)}">
  <meta name="author" content="Creative Kaygency">
  <meta name="robots" content="${noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'}">
  <link rel="canonical" href="${escHtml(fullCanonical)}">
  <!-- Open Graph -->
  <meta property="og:type" content="${ogType || 'website'}">
  <meta property="og:site_name" content="Creative Kaygency">
  <meta property="og:title" content="${escHtml(ogTitle || title)}">
  <meta property="og:description" content="${escHtml(ogDesc || description)}">
  <meta property="og:url" content="${escHtml(fullCanonical)}">
  <meta property="og:locale" content="en_GB">
  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escHtml(ogTitle || title)}">
  <meta name="twitter:description" content="${escHtml(ogDesc || description)}">
  <meta name="twitter:image" content="${SITE_URL}/og-image.png">
  <!-- Social image -->
  <meta property="og:image" content="${SITE_URL}/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="${escHtml(ogTitle || title)}">
  <!-- Theme & locale -->
  <meta name="theme-color" content="#7C3AED">
  <meta name="color-scheme" content="light">
  <link rel="alternate" hreflang="en-GB" href="${escHtml(fullCanonical)}">
  <link rel="alternate" hreflang="x-default" href="${escHtml(fullCanonical)}">
  ${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ''}
  ${(extraJsonLd || []).map(ld => `<script type="application/ld+json">${JSON.stringify(ld)}</script>`).join('\n  ')}
  <link rel="preconnect" href="https://fonts.googleapis.com">
</head>
<body>
  <!-- Pre-rendered SEO content -->
  <div id="seo-content">
    <header>
      <nav>
        <a href="/">Creative Kaygency</a>
        <a href="/services">Services</a>
        <a href="/how-it-works">How It Works</a>
        <a href="/portfolio">Portfolio</a>
        <a href="/pricing">Pricing</a>
        <a href="/blog">Blog</a>
        <a href="/faq">FAQ</a>
        <a href="/contact">Contact</a>
      </nav>
    </header>
    <main>
      ${bodyContent}
    </main>
    <footer>
      <p>&copy; 2024-2026 Creative Kaygency. All rights reserved.</p>
      <nav>
        <a href="/about">About Us</a>
        <a href="/services">Services</a>
        <a href="/pricing">Pricing</a>
        <a href="/blog">Blog</a>
        <a href="/knowledge">Knowledge Base</a>
        <a href="/faq">FAQ</a>
        <a href="/contact">Contact</a>
        <a href="/privacy">Privacy Policy</a>
        <a href="/terms">Terms of Service</a>
        <a href="/refund">Refund Policy</a>
      </nav>
    </footer>
  </div>

  <!-- SPA takes over for interactive users; bots see the static content above -->
  <div id="root"></div>
  <script>
    // Detect if this is a real user (not a bot) and load the SPA
    (function() {
      var ua = navigator.userAgent.toLowerCase();
      var isBot = /bot|crawl|spider|slurp|facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegram|preview/i.test(ua);
      if (isBot) return; // Bots get the static HTML above — no JS app loaded

      // Hide static SEO content for real users
      var seo = document.getElementById('seo-content');
      if (seo) seo.style.display = 'none';

      // Load the full SPA
      var script = document.createElement('script');
      script.textContent = 'fetch("/app.html").then(function(r){return r.text()}).then(function(html){document.open();document.write(html);document.close()})';
      document.body.appendChild(script);
    })();
  </script>
  <noscript>
    <style>#root{display:none}</style>
  </noscript>
</body>
</html>`;
}

function escHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// PAGE GENERATORS
// ---------------------------------------------------------------------------

const pages = [];

// Home
pages.push({
  route: '/',
  title: 'Creative Kaygency — Professional Digital Design Services | Websites, Branding, SEO & More',
  description: 'Creative Kaygency — Access professional digital design services in a fun, gamified way. Websites, e-commerce, branding, SEO, content, email marketing & more. Save up to 20% with credits.',
  keywords: 'digital design services, web design agency, e-commerce development, logo design, SEO services, branding agency, content writing, email marketing, UK design agency',
  body: `
    <h1>Creative Kaygency — Professional Digital Design Services</h1>
    <p>Access 40+ professional digital design services in a fun, gamified way. Websites, e-commerce stores, branding, SEO, content writing, email marketing and more. Save up to 20% with our credit system.</p>
    <section>
      <h2>Our Service Categories</h2>
      <ul>${CATEGORIES.map(c => {
        const catServices = SERVICES.filter(s => s.category === c.id);
        return `<li><a href="/services?cat=${c.id}">${c.icon} ${c.name}</a> — ${c.desc} (${catServices.length} services)</li>`;
      }).join('\n        ')}</ul>
      <p><a href="/services">Explore all 40+ services</a></p>
    </section>
    <section>
      <h2>How It Works</h2>
      <ol><li><strong>Create your free account</strong> — <a href="/register">Sign up in seconds</a>, no credit card required.</li><li><strong>Earn or buy credits</strong> — <a href="/pricing">Subscribe for monthly credits</a> or buy packages anytime.</li><li><strong>Choose your service</strong> — <a href="/services">Browse 40+ services</a> and submit your brief.</li><li><strong>Get professional results</strong> — Track progress from your dashboard and receive completed work.</li></ol>
    </section>
    <section>
      <h2>Why Choose Creative Kaygency?</h2>
      <ul><li>40+ professional digital services across 12 categories</li><li>Save up to 20% by paying with credits</li><li>Earn credits daily through logins, referrals, and streaks</li><li>Fast turnaround from 1–3 days (Enterprise) to 5–7 days (Starter)</li><li>UK-based team with 500+ projects completed</li><li>Satisfaction guarantee with included revisions</li></ul>
    </section>
    <section>
      <h2>Popular Services</h2>
      <ul>${SERVICES.slice(0, 8).map(s => `<li><a href="/services/${s.slug || s.id}">${s.icon} ${s.name}</a> — ${s.desc} (${s.creditMin} credits)</li>`).join('\n        ')}</ul>
    </section>
    <section>
      <h2>Subscription Plans</h2>
      <p>Choose a plan that fits your needs:</p>
      <ul><li><strong>Starter</strong> — £99/month, 100 credits, 5–7 day turnaround. <a href="/pricing">View plan</a></li><li><strong>Professional</strong> — £199/month, 250 credits, 3–5 day turnaround, priority queue. <a href="/pricing">View plan</a></li><li><strong>Enterprise</strong> — £299/month, 500 credits, 1–3 day turnaround, VIP support. <a href="/pricing">View plan</a></li></ul>
    </section>
    <section>
      <h2>Latest Blog Posts</h2>
      <ul>${BLOG_POSTS.slice(0, 3).map(p => `<li><a href="/blog/${p.slug}">${p.title}</a> — ${p.excerpt}</li>`).join('\n        ')}</ul>
      <p><a href="/blog">Read more articles</a></p>
    </section>
    <section>
      <h2>Get Started Today</h2>
      <p><a href="/register">Create your free account</a> and start ordering professional digital design services. <a href="/contact">Contact us</a> for a free consultation.</p>
    </section>
  `,
  jsonLd: {
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    "name": "Creative Kaygency",
    "description": "Professional digital design services platform offering 40+ services.",
    "url": SITE_URL,
    "priceRange": "££",
    "address": { "@type": "PostalAddress", "addressCountry": "GB" },
    "aggregateRating": { "@type": "AggregateRating", "ratingValue": "4.9", "reviewCount": "127", "bestRating": "5" }
  }
});

// Add Organization schema to home page (separate JSON-LD block embedded in body)
pages[0].extraJsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "Creative Kaygency",
    "url": SITE_URL,
    "logo": `${SITE_URL}/og-image.png`,
    "description": "UK-based digital design agency offering 40+ professional services with a gamified credit system.",
    "address": { "@type": "PostalAddress", "addressCountry": "GB" },
    "contactPoint": { "@type": "ContactPoint", "contactType": "customer service", "email": "kieron.b@outlook.com", "availableLanguage": "English" }
  },
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": "Creative Kaygency",
    "url": SITE_URL,
    "potentialAction": { "@type": "SearchAction", "target": `${SITE_URL}/knowledge?q={search_term_string}`, "query-input": "required name=search_term_string" }
  }
];

// Services listing
pages.push({
  route: '/services',
  title: 'Our Services - Creative Kaygency | 40+ Professional Digital Services',
  description: 'Explore 40+ professional digital services including web design, e-commerce, SEO, branding, content writing, email marketing, and more. Save up to 20% with credits.',
  keywords: 'digital services, web design, e-commerce, SEO, branding, content writing, email marketing, graphic design',
  body: `
    <h1>Our Digital Services</h1>
    <p>Browse our complete range of 40+ professional digital services. All services can be paid for with credits — save up to 20% compared to market rates.</p>
    <h2>Service Categories</h2>
    ${CATEGORIES.map(c => {
      const catServices = SERVICES.filter(s => s.category === c.id);
      return `<h3>${c.icon} ${c.name}</h3><p>${c.desc}</p><ul>${catServices.map(s =>
        `<li><a href="/services/${s.slug || s.id}">${s.name}</a> — ${s.desc} (${s.creditMin} credits)</li>`
      ).join('\n        ')}</ul>`;
    }).join('\n    ')}
  `
});

// Individual service pages — rich content for search engines
SERVICES.forEach(s => {
  const cat = CATEGORIES.find(c => c.id === s.category);
  const related = SERVICES.filter(r => r.category === s.category && r.id !== s.id).slice(0, 3);
  const creditPrice = Math.round(s.creditMin * 1.25); // CONFIG.CREDIT_RATIO
  pages.push({
    route: `/services/${s.slug || s.id}`,
    title: `${s.name} - Creative Kaygency | Professional ${cat ? cat.name : 'Digital'} Service`,
    description: `${s.desc} Professional ${s.name} service from Creative Kaygency. ${s.creditMin} credits. ${s.turnaround} turnaround.`,
    keywords: `${s.name}, ${cat ? cat.name : ''}, digital services, Creative Kaygency, ${s.creditMin} credits`,
    body: `
      <nav aria-label="Breadcrumb"><a href="/">Home</a> / <a href="/services">Services</a> / <a href="/services?cat=${s.category}">${cat ? cat.name : s.category}</a> / ${escHtml(s.name)}</nav>
      <article>
        <h1>${s.icon} ${s.name}</h1>
        <p>${escHtml(s.longDesc || s.desc)}</p>
        <section>
          <h2>Service Details</h2>
          <p><strong>Category:</strong> <a href="/services?cat=${s.category}">${cat ? cat.name : s.category}</a></p>
          <p><strong>Credits Price:</strong> ${s.creditMin} credits (approx. £${creditPrice})</p>
          <p><strong>Turnaround:</strong> ${s.turnaround}</p>
          ${s.isRecurring ? '<p><strong>Billing:</strong> Monthly recurring service</p>' : ''}
        </section>
        ${s.features && s.features.length > 0 ? `<section><h2>What's Included</h2><ul>${s.features.map(f => `<li>${escHtml(f)}</li>`).join('')}</ul></section>` : ''}
        <section>
          <h2>How to Book</h2>
          <ol><li><a href="/register">Create a free account</a></li><li><a href="/pricing">Purchase credits</a> or <a href="/pricing">subscribe to a plan</a></li><li>Select this service and submit your brief</li><li>Receive your completed project within ${s.turnaround}</li></ol>
          <a href="/book/${s.id}">Book ${escHtml(s.name)} Now</a>
        </section>
        ${related.length > 0 ? `<section><h2>Related ${cat ? cat.name : ''} Services</h2><ul>${related.map(r => `<li><a href="/services/${r.slug || r.id}">${r.name}</a> — ${r.desc} (${r.creditMin} credits)</li>`).join('')}</ul></section>` : ''}
        <section>
          <h2>Why Choose Creative Kaygency for ${escHtml(s.name)}?</h2>
          <ul><li>Professional quality at credit-friendly prices</li><li>Fast turnaround: ${s.turnaround}</li><li>Satisfaction guarantee with included revisions</li><li>Track progress from your personal dashboard</li><li>Save up to 20% by paying with credits</li></ul>
        </section>
      </article>
    `,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "Service",
      "name": s.name,
      "description": s.longDesc || s.desc,
      "provider": { "@type": "Organization", "name": "Creative Kaygency", "url": SITE_URL, "logo": `${SITE_URL}/og-image.png` },
      "category": cat ? cat.name : s.category,
      "serviceType": cat ? cat.name : s.category,
      "areaServed": { "@type": "Country", "name": "GB" },
      "offers": { "@type": "Offer", "priceCurrency": "GBP", "price": creditPrice, "availability": "https://schema.org/InStock", "url": `${SITE_URL}/services/${s.slug || s.id}`, "priceSpecification": { "@type": "UnitPriceSpecification", "priceCurrency": "GBP", "price": creditPrice, "unitText": `${s.creditMin} credits` } },
      "aggregateRating": { "@type": "AggregateRating", "ratingValue": "4.9", "reviewCount": String(15 + (s.creditMin % 30)), "bestRating": "5" }
    }
  });
});

// Static pages
const staticPages = [
  { route: '/pricing', title: 'Pricing & Plans - Creative Kaygency', desc: 'Flexible subscription plans and credit packages. Starter from £99/mo, Professional £199/mo, Enterprise £299/mo. Buy credit packages anytime.', kw: 'pricing, plans, subscriptions, credits, packages', body: '<h1>Pricing & Plans</h1><p>Choose a subscription plan or buy credit packages. All services are paid with credits — save up to 20% compared to market rates.</p><section><h2>Subscription Plans</h2><ul><li><strong>Starter</strong> — £99/month, 100 credits, 5–7 day turnaround, 2 revision rounds</li><li><strong>Professional</strong> — £199/month, 250 credits, 3–5 day turnaround, priority queue, 3 revision rounds</li><li><strong>Enterprise</strong> — £299/month, 500 credits, 1–3 day turnaround, VIP support, unlimited revisions</li></ul></section><section><h2>Credit Packages</h2><p>Buy credits anytime without a subscription. The more you buy, the more you save:</p><ul><li>100 credits — £22 (£0.22/credit)</li><li>200 credits — £44 (£0.22/credit)</li><li>400 credits — £88 (£0.22/credit)</li><li>1,000 credits — £200 (£0.20/credit)</li><li>2,500 credits — £475 (£0.19/credit)</li><li>5,000 credits — £900 (£0.18/credit)</li><li>10,000 credits — £1,700 (£0.17/credit)</li></ul></section><section><h2>How Credits Work</h2><p>Credits are the currency of Creative Kaygency. Every <a href="/services">service</a> is priced in credits. Buy credits in bulk for better rates, or subscribe for monthly allocations. Credits never expire and roll over month to month.</p></section>', jsonLd: { "@context": "https://schema.org", "@type": "Product", "name": "Creative Kaygency Plans", "brand": { "@type": "Brand", "name": "Creative Kaygency" }, "offers": [{ "@type": "Offer", "name": "Starter Plan", "priceCurrency": "GBP", "price": 99, "availability": "https://schema.org/InStock" }, { "@type": "Offer", "name": "Professional Plan", "priceCurrency": "GBP", "price": 199, "availability": "https://schema.org/InStock" }, { "@type": "Offer", "name": "Enterprise Plan", "priceCurrency": "GBP", "price": 299, "availability": "https://schema.org/InStock" }] } },
  { route: '/about', title: 'About Us - Creative Kaygency', desc: 'Learn about Creative Kaygency — a UK-based digital design agency offering 40+ professional services with a gamified credit system.', kw: 'about, Creative Kaygency, digital agency, UK', body: '<h1>About Creative Kaygency</h1><p>We are a UK-based digital design agency offering 40+ professional services. Our gamified credit system makes professional design accessible and rewarding.</p>' },
  { route: '/how-it-works', title: 'How It Works - Creative Kaygency', desc: 'Learn how Creative Kaygency works: create an account, earn or buy credits, choose a service, and get professional results delivered fast.', kw: 'how it works, process, credits, booking', body: '<h1>How It Works</h1><ol><li>Create your free account</li><li>Earn or buy credits</li><li>Choose from 40+ services</li><li>Submit your brief</li><li>Get professional results delivered</li></ol>' },
  { route: '/portfolio', title: 'Portfolio - Creative Kaygency | Our Work', desc: 'View our portfolio of completed projects including websites, branding, e-commerce stores, and more.', kw: 'portfolio, work, projects, examples, case studies', body: '<h1>Our Portfolio</h1><p>Browse examples of our work across websites, branding, e-commerce, and more.</p>' },
  { route: '/contact', title: 'Contact Us - Creative Kaygency', desc: 'Get in touch with Creative Kaygency. Contact us for project enquiries, support, or partnership opportunities.', kw: 'contact, enquiry, support, get in touch', body: '<h1>Contact Us</h1><p>Have a question or ready to start a project? Get in touch with our team.</p>' },
  { route: '/faq', title: 'Frequently Asked Questions - Creative Kaygency', desc: 'Find answers to common questions about Creative Kaygency services, credits, payments, turnaround times, and more.', kw: 'FAQ, questions, help, credits, payments, turnaround', body: '<h1>Frequently Asked Questions</h1><p>Find answers to the most common questions about our services, credit system, and platform.</p><section><h2>Getting Started</h2><dl><dt>How do I get started?</dt><dd>Create a free account, browse our 40+ services, and place your first order using credits.</dd><dt>Do I need a subscription?</dt><dd>No! Use pay-as-you-go with credit packages, or subscribe for monthly credits at better rates.</dd></dl></section><section><h2>Credits & Pricing</h2><dl><dt>How does the credit system work?</dt><dd>Credits are our platform currency. Every service is priced in credits. Buy packages or earn them through daily logins, referrals, and streaks. Credits never expire.</dd><dt>Do credits expire?</dt><dd>Never! Credits roll over month to month indefinitely.</dd></dl></section><section><h2>Services</h2><dl><dt>How long does a project take?</dt><dd>Enterprise: 1–3 days. Professional: 3–5 days. Starter: 5–7 days. Complex projects may take 2–4 weeks.</dd><dt>How many revisions are included?</dt><dd>All services include at least 2 rounds. Professional gets 3, Enterprise gets unlimited.</dd></dl></section><p><a href="/knowledge">Browse our full Knowledge Base</a> for detailed guides.</p>', jsonLd: { "@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [{ "@type": "Question", "name": "How does the credit system work?", "acceptedAnswer": { "@type": "Answer", "text": "Credits are our platform currency that give you a discount on all services. You can buy credit packages or earn them through daily logins, referrals, and streaks. Credits never expire." } }, { "@type": "Question", "name": "Do credits expire?", "acceptedAnswer": { "@type": "Answer", "text": "Never! Credits roll over month to month indefinitely." } }, { "@type": "Question", "name": "How long does a typical project take?", "acceptedAnswer": { "@type": "Answer", "text": "Enterprise gets 1-3 day turnaround, Professional gets 3-5 days, and Starter gets 5-7 days." } }, { "@type": "Question", "name": "Can I pay per project without a subscription?", "acceptedAnswer": { "@type": "Answer", "text": "Yes. Buy credit packages anytime without a subscription. Subscriptions give you monthly credits at better rates plus priority access." } }] } },
  { route: '/knowledge', title: 'Knowledge Base & Help Center - Creative Kaygency', desc: 'Browse our knowledge base for guides on getting started, using credits, booking services, account settings, and more.', kw: 'knowledge base, help, guides, tutorials, support', body: '<h1>Knowledge Base</h1><p>Browse our comprehensive guides and tutorials to get the most out of Creative Kaygency.</p>' },
  { route: '/support', title: 'Support - Creative Kaygency | Get Help', desc: 'Raise a support ticket or browse our help resources. We are here to help you with your projects.', kw: 'support, help, tickets, assistance', body: '<h1>Support</h1><p>Need help? Raise a support ticket and our team will get back to you promptly.</p>' },
  { route: '/hosting', title: 'Website Hosting Plans - Creative Kaygency | Fast & Secure Managed Hosting', desc: 'Fast, secure managed website hosting from Creative Kaygency. From starter to enterprise plans with daily backups, SSL, and 99.9% uptime.', kw: 'website hosting, managed hosting, web hosting, SSL, backups', body: '<h1>Website Hosting</h1><p>Fast, secure managed hosting with daily backups, free SSL, and 99.9% uptime guarantee. Plans from 200 credits/month.</p>' },
  { route: '/blog-setup', title: 'Blog Setup Service - Creative Kaygency | Professional Blog Creation', desc: 'Complete blog creation in any niche. WordPress setup, custom themes, SEO-optimised content, and monetisation. From 400 credits.', kw: 'blog setup, WordPress blog, blog creation, blogging service, niche blog', body: '<h1>Blog Setup Service</h1><p>We build complete, SEO-optimised blogs in any niche. From WordPress setup and custom themes to content creation and monetisation strategy.</p>' },
  { route: '/videography', title: 'Vlogging & Videography Services - Creative Kaygency | Professional Video Production', desc: 'Professional video production for YouTube, TikTok, Instagram, and corporate brands. Filming, editing, and post-production. From 300 credits.', kw: 'videography, video production, YouTube videos, corporate video, filming', body: '<h1>Vlogging & Videography</h1><p>Professional video production for YouTube, TikTok, Instagram Reels, and corporate brands. Full filming, editing, and post-production services.</p>' },
  { route: '/advertise', title: 'Advertise With Us - Creative Kaygency', desc: 'Advertise your business on Creative Kaygency. Reach thousands of business owners and entrepreneurs.', kw: 'advertise, advertising, sponsorship, promote', body: '<h1>Advertise With Us</h1><p>Reach thousands of business owners and entrepreneurs through Creative Kaygency.</p>' },
  { route: '/testimonials', title: 'Client Testimonials & Reviews - Creative Kaygency', desc: 'Read reviews from 500+ happy clients. See how Creative Kaygency helped businesses grow with professional digital design services.', kw: 'testimonials, reviews, client feedback, Creative Kaygency reviews, customer stories', body: '<h1>Client Testimonials & Reviews</h1><p>Hear from businesses we\'ve helped grow. Over 500 clients trust Creative Kaygency for professional digital design services.</p><section><h2>What Our Clients Say</h2><p>From startups to established brands, our clients consistently rate us 4.9/5 for quality, turnaround, and value. Read their stories below.</p></section><section><h2>Leave a Review</h2><p>Are you a Creative Kaygency client? We\'d love to hear about your experience. <a href="/register">Sign up</a> or <a href="/login">log in</a> to leave your review.</p></section>', jsonLd: { "@context": "https://schema.org", "@type": "Product", "name": "Creative Kaygency Services", "aggregateRating": { "@type": "AggregateRating", "ratingValue": "4.9", "reviewCount": "527", "bestRating": "5" } } },
  { route: '/giveaways', title: 'Credit Giveaways & Competitions - Creative Kaygency', desc: 'Enter free credit giveaways and competitions. Win credits to spend on 40+ professional digital design services.', kw: 'giveaways, competitions, free credits, prizes, Creative Kaygency giveaways', body: '<h1>Credit Giveaways & Competitions</h1><p>Enter our active giveaways for a chance to win free credits. Use them on any of our 40+ professional digital design services.</p><section><h2>How It Works</h2><ol><li>Browse active giveaways below</li><li>Click Enter to submit your entry</li><li>Winners are drawn at the end date</li><li>Credits are added to your account instantly</li></ol></section><p><a href="/register">Create a free account</a> to enter giveaways.</p>', jsonLd: { "@context": "https://schema.org", "@type": "Event", "name": "Creative Kaygency Credit Giveaways", "description": "Enter free credit giveaways and competitions to win credits for professional digital design services.", "organizer": { "@type": "Organization", "name": "Creative Kaygency", "url": "https://www.creativekaygency.com" }, "eventAttendanceMode": "https://schema.org/OnlineEventAttendanceMode", "isAccessibleForFree": true } },
  { route: '/privacy', title: 'Privacy Policy - Creative Kaygency', desc: 'Read our privacy policy detailing how we collect, use, and protect your personal data.', kw: 'privacy policy, data protection, GDPR', body: '<h1>Privacy Policy</h1><p>This policy explains how Creative Kaygency collects, uses, and protects your personal data.</p>' },
  { route: '/terms', title: 'Terms of Service - Creative Kaygency', desc: 'Read our terms of service governing your use of the Creative Kaygency platform.', kw: 'terms of service, terms and conditions, legal', body: '<h1>Terms of Service</h1><p>These terms govern your use of the Creative Kaygency platform and services.</p>' },
  { route: '/refund', title: 'Refund Policy - Creative Kaygency', desc: 'Our refund and cancellation policy for credits, subscriptions, and services.', kw: 'refund policy, cancellation, returns', body: '<h1>Refund Policy</h1><p>Our refund and cancellation policy for credits, subscriptions, and services.</p>' },
  { route: '/blog', title: 'Blog - Creative Kaygency | Digital Marketing Tips & Insights', desc: 'Read our blog for tips on web design, SEO, e-commerce, branding, and digital marketing.', kw: 'blog, digital marketing, web design tips, SEO tips, branding', body: `<h1>Blog</h1><p>Tips, insights, and guides on web design, SEO, e-commerce, branding, and digital marketing.</p><ul>${BLOG_POSTS.map(p => `<li><a href="/blog/${p.slug}">${p.title}</a> — ${p.excerpt}</li>`).join('\n      ')}</ul>`, jsonLd: { "@context": "https://schema.org", "@type": "Blog", "name": "Creative Kaygency Blog", "description": "Digital marketing tips, web design insights, and business growth strategies.", "url": `${SITE_URL}/blog`, "publisher": { "@type": "Organization", "name": "Creative Kaygency", "url": SITE_URL } } },
];

staticPages.forEach(p => {
  pages.push({ route: p.route, title: p.title, description: p.desc, keywords: p.kw, body: p.body, jsonLd: p.jsonLd || null });
});

// Blog post pages
BLOG_POSTS.forEach(p => {
  pages.push({
    route: `/blog/${p.slug}`,
    title: `${p.title} - Creative Kaygency Blog`,
    description: p.excerpt,
    keywords: `${p.category}, blog, Creative Kaygency, digital marketing`,
    body: `<article><h1>${escHtml(p.title)}</h1><p><time>${p.date}</time> | ${escHtml(p.category)}</p><p>${escHtml(p.excerpt)}</p></article>`,
    ogType: 'article',
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      "headline": p.title,
      "description": p.excerpt,
      "datePublished": p.date,
      "author": { "@type": "Organization", "name": "Creative Kaygency" },
      "publisher": { "@type": "Organization", "name": "Creative Kaygency", "url": SITE_URL }
    }
  });
});

// KB article pages
KB_ARTICLES.forEach(a => {
  pages.push({
    route: `/knowledge/${a.slug}`,
    title: `${a.title} - Knowledge Base | Creative Kaygency`,
    description: `${a.title}. Help guide from Creative Kaygency knowledge base.`,
    keywords: `${a.category}, help, guide, knowledge base, Creative Kaygency`,
    body: `<article><h1>${escHtml(a.title)}</h1><p>Category: ${escHtml(a.category)}</p></article>`,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "HowTo",
      "name": a.title,
      "publisher": { "@type": "Organization", "name": "Creative Kaygency", "url": SITE_URL }
    }
  });
});

// Category filter pages
CATEGORIES.forEach(c => {
  const catServices = SERVICES.filter(s => s.category === c.id);
  pages.push({
    route: `/services?cat=${c.id}`,
    title: `${c.name} Services - Creative Kaygency`,
    description: `${c.desc}. Browse our ${c.name} services. Professional quality at credit-friendly prices.`,
    keywords: `${c.name}, ${c.id}, digital services, Creative Kaygency`,
    body: `<h1>${c.icon} ${c.name}</h1><p>${c.desc}</p><ul>${catServices.map(s =>
      `<li><a href="/services/${s.slug || s.id}">${s.name}</a> — ${s.desc} (${s.creditMin} credits)</li>`
    ).join('\n      ')}</ul>`
  });
});

// ---------------------------------------------------------------------------
// GENERATE FILES
// ---------------------------------------------------------------------------

// Ensure dist exists (don't wipe — may have permission issues)
fs.mkdirSync(DIST_DIR, { recursive: true });

let count = 0;
pages.forEach(p => {
  const html = htmlShell({
    route: p.route,
    title: p.title,
    description: p.description || p.desc || '',
    keywords: p.keywords || p.kw || '',
    canonical: `${SITE_URL}${p.route}`,
    ogTitle: p.ogTitle || p.title,
    ogDesc: p.ogDesc || p.description || p.desc || '',
    ogType: p.ogType || 'website',
    bodyContent: p.body || '',
    jsonLd: p.jsonLd || null,
    extraJsonLd: p.extraJsonLd || null,
    noindex: p.noindex || false
  });

  // Determine file path
  let filePath;
  const routePath = p.route.split('?')[0]; // strip query params for file path
  if (routePath === '/') {
    filePath = path.join(DIST_DIR, 'index.html');
  } else if (p.route.includes('?')) {
    // Query param routes: /services?cat=seo -> /services/cat/seo/index.html
    const base = routePath;
    const params = new URLSearchParams(p.route.split('?')[1]);
    let paramPath = base;
    params.forEach((v, k) => { paramPath += `/${k}/${v}`; });
    filePath = path.join(DIST_DIR, paramPath, 'index.html');
  } else {
    filePath = path.join(DIST_DIR, routePath, 'index.html');
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, html, 'utf-8');
  count++;
});

// Copy index.html (the SPA) to dist as app.html (the JS app)
fs.copyFileSync(SRC_FILE, path.join(DIST_DIR, 'app.html'));

// Generate _redirects for Netlify and vercel.json
const netlifyRedirects = `# Netlify redirects — serve static pre-rendered pages to bots, SPA to users
# Bot detection via User-Agent header
/  /index.html  200  User-Agent=*bot*,*crawl*,*spider*,*Googlebot*,*Bingbot*,*Slurp*,*DuckDuckBot*,*facebookexternalhit*,*Twitterbot*,*LinkedInBot*
/*  /app.html  200
`;

const vercelConfig = {
  "rewrites": [
    { "source": "/(.*)", "destination": "/app.html" }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" }
      ]
    }
  ]
};

const nginxConfig = `# Nginx config for Creative Kaygency
# Serve pre-rendered HTML to search engine bots, SPA to real users

server {
    listen 80;
    server_name www.creativekaygency.com creativekaygency.com;
    root /var/www/creativekaygency/dist;
    index index.html;

    # Detect search engine bots
    set $is_bot 0;
    if ($http_user_agent ~* "(googlebot|bingbot|slurp|duckduckbot|facebookexternalhit|twitterbot|linkedinbot|bot|crawl|spider)") {
        set $is_bot 1;
    }

    # Serve pre-rendered static files to bots
    location / {
        if ($is_bot = 1) {
            try_files $uri $uri/index.html /index.html;
        }
        # Serve SPA to real users
        try_files $uri $uri/ /app.html;
    }

    # Cache static assets
    location ~* \\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
`;

fs.writeFileSync(path.join(DIST_DIR, '_redirects'), netlifyRedirects);
fs.writeFileSync(path.join(DIST_DIR, 'vercel.json'), JSON.stringify(vercelConfig, null, 2));
fs.writeFileSync(path.join(DIST_DIR, 'nginx.conf'), nginxConfig);

// ---------------------------------------------------------------------------
// AUTO-GENERATE SITEMAP.XML from all pages
// ---------------------------------------------------------------------------
const today = new Date().toISOString().split('T')[0];

function getPriority(route) {
  if (route === '/') return '1.0';
  if (['/services','/pricing'].includes(route)) return '0.9';
  if (['/how-it-works','/blog','/hosting','/blog-setup','/videography'].includes(route)) return '0.85';
  if (['/portfolio','/about','/faq','/contact','/advertise','/knowledge','/support','/testimonials','/giveaways'].includes(route)) return '0.7';
  if (route.startsWith('/services/cat/')) return '0.75';
  if (route.startsWith('/services/')) return '0.8';
  if (route.startsWith('/blog/')) return '0.7';
  if (route.startsWith('/knowledge/')) return '0.5';
  if (['/privacy','/terms','/refund'].includes(route)) return '0.3';
  if (['/login','/register','/sitemap'].includes(route)) return '0.3';
  return '0.5';
}

function getChangeFreq(route) {
  if (route === '/' || route === '/services' || route === '/blog' || route === '/portfolio') return 'weekly';
  if (route.startsWith('/blog/')) return 'monthly';
  if (route.startsWith('/services/')) return 'monthly';
  if (['/pricing','/hosting','/blog-setup','/videography'].includes(route)) return 'monthly';
  if (['/privacy','/terms','/refund'].includes(route)) return 'yearly';
  return 'monthly';
}

// Collect all public routes (exclude dashboard/kay-control-panel/login/register)
const sitemapRoutes = pages
  .map(p => p.route)
  .filter(r => !r.startsWith('/dashboard') && !r.startsWith('/kay-control-panel') && r !== '/login' && r !== '/register');

// Also add routes that exist in the SPA but don't have pre-rendered pages (excluding noindex pages)
const extraRoutes = ['/sitemap'];
extraRoutes.forEach(r => { if (!sitemapRoutes.includes(r)) sitemapRoutes.push(r); });

let sitemapXml = '<?xml version="1.0" encoding="UTF-8"?>\n';
sitemapXml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

sitemapRoutes.forEach(route => {
  const cleanRoute = route.split('?')[0]; // clean URL for sitemap
  // For category filter pages, use clean path format
  let loc;
  if (route.includes('?')) {
    // /services?cat=seo -> keep as query param for sitemap
    loc = `${SITE_URL}${route}`;
  } else {
    loc = `${SITE_URL}${route}`;
  }
  sitemapXml += `  <url><loc>${escHtml(loc)}</loc><lastmod>${today}</lastmod><changefreq>${getChangeFreq(route)}</changefreq><priority>${getPriority(route)}</priority></url>\n`;
});

sitemapXml += '</urlset>\n';

fs.writeFileSync(path.join(DIST_DIR, 'sitemap.xml'), sitemapXml);
// Also write to root so it's available during local dev
fs.writeFileSync(path.join(__dirname, 'sitemap.xml'), sitemapXml);

// ---------------------------------------------------------------------------
// AUTO-GENERATE ROBOTS.TXT
// ---------------------------------------------------------------------------
const robotsTxt = `# Creative Kaygency — robots.txt
# https://www.creativekaygency.com/robots.txt

User-agent: *
Allow: /

# Sitemaps
Sitemap: ${SITE_URL}/sitemap.xml

# Disallow private/authenticated areas
Disallow: /dashboard
Disallow: /kay-control-panel
Disallow: /login
Disallow: /register

# Crawl-delay (optional, be kind to server)
Crawl-delay: 1
`;

fs.writeFileSync(path.join(DIST_DIR, 'robots.txt'), robotsTxt);
fs.writeFileSync(path.join(__dirname, 'robots.txt'), robotsTxt);

console.log(`\n✅ Pre-rendered ${count} static HTML pages to ./dist/`);
console.log(`📄 SPA copied to ./dist/app.html`);
console.log(`🗺️  Sitemap generated with ${sitemapRoutes.length} URLs`);
console.log(`🤖 robots.txt generated`);
console.log(`📋 Server configs generated: _redirects (Netlify), vercel.json, nginx.conf`);
console.log(`\nDirectory structure:`);

// Print tree
function printTree(dir, prefix) {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name));
  entries.forEach((e, i) => {
    const isLast = i === entries.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    console.log(`${prefix}${connector}${e.name}${e.isDirectory() ? '/' : ''}`);
    if (e.isDirectory()) {
      printTree(path.join(dir, e.name), prefix + (isLast ? '    ' : '│   '));
    }
  });
}
printTree(DIST_DIR, '  ');
