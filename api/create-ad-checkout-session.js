const Stripe = require('stripe');

// Ad packages — must match frontend AD_PACKAGES exactly
const AD_PACKAGES = {
  'ad-basic':   { price: 2900,  name: 'Basic Ad',   duration: 7,  description: 'Dashboard sidebar placement for 7 days' },
  'ad-pro':     { price: 7900,  name: 'Pro Ad',      duration: 30, description: 'Sidebar and banner ads for 30 days' },
  'ad-premium': { price: 14900, name: 'Premium Ad',  duration: 30, description: 'Featured placement with premium positioning for 30 days' },
};

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const { packageId, userId, userEmail, adTitle, businessName } = req.body;

    if (!packageId || !userId) {
      return res.status(400).json({ error: 'Missing packageId or userId' });
    }

    const pkg = AD_PACKAGES[packageId];
    if (!pkg) {
      return res.status(400).json({ error: 'Invalid ad package' });
    }

    // Determine base URL from request headers
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const baseUrl = `${protocol}://${host}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      ui_mode: 'embedded',
      customer_email: userEmail || undefined,
      line_items: [
        {
          price_data: {
            currency: 'gbp',
            product_data: {
              name: `Creative Kaygency — ${pkg.name} Package`,
              description: pkg.description,
            },
            unit_amount: pkg.price,
          },
          quantity: 1,
        },
      ],
      metadata: {
        userId,
        packageId,
        type: 'advertising',
        adTitle: (adTitle || '').slice(0, 200),
        businessName: (businessName || '').slice(0, 200),
      },
      return_url: `${baseUrl}/?payment=success&type=ad&package=${packageId}&session_id={CHECKOUT_SESSION_ID}`,
    });

    return res.status(200).json({ clientSecret: session.client_secret });
  } catch (err) {
    console.error('Ad checkout session error:', err.message, err.type || '', err.code || '');
    return res.status(500).json({ error: err.message || 'Failed to create ad checkout session' });
  }
};
