const Stripe = require('stripe');

// Subscription plans — must match frontend PLANS exactly
const PLANS = {
  starter:      { price: 9900,  credits: 100,  name: 'Starter',       interval: 'month' },
  professional: { price: 19900, credits: 250,  name: 'Professional',  interval: 'month' },
  enterprise:   { price: 29900, credits: 500,  name: 'Enterprise',    interval: 'month' },
  // Annual variants (20% off)
  'starter-annual':      { price: 79 * 100 * 12,  credits: 100,  name: 'Starter (Annual)',       interval: 'year' },
  'professional-annual': { price: 159 * 100 * 12, credits: 250,  name: 'Professional (Annual)',  interval: 'year' },
  'enterprise-annual':   { price: 239 * 100 * 12, credits: 500,  name: 'Enterprise (Annual)',    interval: 'year' },
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
    const { planId, userId, userEmail } = req.body;

    if (!planId || !userId) {
      return res.status(400).json({ error: 'Missing planId or userId' });
    }

    const plan = PLANS[planId];
    if (!plan) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    // Determine base URL from request headers
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const baseUrl = `${protocol}://${host}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      ui_mode: 'embedded',
      customer_email: userEmail || undefined,
      line_items: [
        {
          price_data: {
            currency: 'gbp',
            product_data: {
              name: `Creative Kaygency — ${plan.name} Plan`,
              description: `${plan.credits} design credits per ${plan.interval === 'year' ? 'month (billed annually)' : 'month'}`,
            },
            unit_amount: plan.price,
            recurring: {
              interval: plan.interval,
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        userId,
        planId,
        credits: String(plan.credits),
      },
      subscription_data: {
        metadata: {
          userId,
          planId,
          credits: String(plan.credits),
        },
      },
      return_url: `${baseUrl}/?payment=success&type=subscription&plan=${planId}&session_id={CHECKOUT_SESSION_ID}`,
    });

    return res.status(200).json({ clientSecret: session.client_secret });
  } catch (err) {
    console.error('Subscription session error:', err.message, err.type || '', err.code || '');
    return res.status(500).json({ error: err.message || 'Failed to create subscription session' });
  }
};
