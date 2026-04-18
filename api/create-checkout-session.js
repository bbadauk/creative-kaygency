const Stripe = require('stripe');

// Credit packages — must match frontend definitions exactly
const PACKAGES = {
  basic:      { credits: 100,   price: 2200,   label: '100 Credits' },
  standard:   { credits: 200,   price: 4400,   label: '200 Credits' },
  premium:    { credits: 400,   price: 8800,   label: '400 Credits' },
  mega:       { credits: 1000,  price: 20000,  label: '1,000 Credits' },
  ultra:      { credits: 2500,  price: 47500,  label: '2,500 Credits' },
  enterprise: { credits: 5000,  price: 90000,  label: '5,000 Credits' },
  unlimited:  { credits: 10000, price: 170000, label: '10,000 Credits' },
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
    const { packageId, userId, userEmail } = req.body;

    if (!packageId || !userId) {
      return res.status(400).json({ error: 'Missing packageId or userId' });
    }

    const pkg = PACKAGES[packageId];
    if (!pkg) {
      return res.status(400).json({ error: 'Invalid package' });
    }

    // Determine base URL from request headers
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const baseUrl = `${protocol}://${host}`;

    // NOTE: payment_method_types MUST NOT be set with ui_mode 'embedded'
    // Stripe determines available payment methods automatically in embedded mode
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      ui_mode: 'embedded',
      customer_email: userEmail || undefined,
      line_items: [
        {
          price_data: {
            currency: 'gbp',
            product_data: {
              name: `Creative Kaygency — ${pkg.label}`,
              description: `${pkg.credits} design credits for Creative Kaygency services`,
            },
            unit_amount: pkg.price, // in pence
          },
          quantity: 1,
        },
      ],
      metadata: {
        userId,
        packageId,
        credits: String(pkg.credits),
      },
      return_url: `${baseUrl}/?payment=success&credits=${pkg.credits}&session_id={CHECKOUT_SESSION_ID}`,
    });

    return res.status(200).json({ clientSecret: session.client_secret });
  } catch (err) {
    console.error('Checkout session error:', err.message, err.type || '', err.code || '');
    return res.status(500).json({ error: err.message || 'Failed to create checkout session' });
  }
};
