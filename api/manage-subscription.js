const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const supabaseUrl = process.env.SUPABASE_URL || 'https://gmcqtjmwvpkxugcoclgs.supabase.co';
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseServiceKey) {
      return res.status(500).json({ error: 'Server misconfigured' });
    }

    const { action, userId } = req.body;

    if (!action || !userId) {
      return res.status(400).json({ error: 'Missing action or userId' });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user profile to find their Stripe customer ID
    const { data: profile, error: fetchError } = await supabase
      .from('profiles')
      .select('stripe_customer_id, plan, subscription_id')
      .eq('id', userId)
      .single();

    if (fetchError || !profile) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    // ACTION: get-status — return current subscription details
    if (action === 'get-status') {
      if (!profile.stripe_customer_id || !profile.subscription_id) {
        return res.status(200).json({
          active: false,
          plan: profile.plan || 'free',
          subscription: null,
        });
      }

      try {
        const subscription = await stripe.subscriptions.retrieve(profile.subscription_id);
        return res.status(200).json({
          active: subscription.status === 'active' || subscription.status === 'trialing',
          plan: profile.plan || 'free',
          status: subscription.status,
          currentPeriodEnd: subscription.current_period_end,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
        });
      } catch (subErr) {
        // Subscription may have been deleted
        return res.status(200).json({
          active: false,
          plan: profile.plan || 'free',
          subscription: null,
        });
      }
    }

    // ACTION: portal — open Stripe Customer Portal for self-service management
    if (action === 'portal') {
      if (!profile.stripe_customer_id) {
        return res.status(400).json({ error: 'No active subscription to manage' });
      }

      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const baseUrl = `${protocol}://${host}`;

      const portalSession = await stripe.billingPortal.sessions.create({
        customer: profile.stripe_customer_id,
        return_url: `${baseUrl}/dashboard/credits`,
      });

      return res.status(200).json({ url: portalSession.url });
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (err) {
    console.error('Manage subscription error:', err.message);
    return res.status(500).json({ error: err.message || 'Subscription management failed' });
  }
};
