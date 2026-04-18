const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

// Vercel serverless functions need raw body for Stripe signature verification
module.exports.config = {
  api: {
    bodyParser: false,
  },
};

// Helper to read raw body from request stream
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Map plan IDs to plan names
const PLAN_MAP = {
  starter: 'starter',
  professional: 'professional',
  enterprise: 'enterprise',
  'starter-annual': 'starter',
  'professional-annual': 'professional',
  'enterprise-annual': 'enterprise',
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const supabaseUrl = process.env.SUPABASE_URL || 'https://gmcqtjmwvpkxugcoclgs.supabase.co';
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!webhookSecret || !supabaseServiceKey) {
    console.error('Missing STRIPE_WEBHOOK_SECRET or SUPABASE_SERVICE_ROLE_KEY');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  let event;

  try {
    const rawBody = await getRawBody(req);
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // ── CHECKOUT SESSION COMPLETED ──
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { userId, packageId, credits, type, planId } = session.metadata;

    // Handle subscription checkout completion — store customer & subscription IDs
    if (session.mode === 'subscription') {
      const planName = PLAN_MAP[planId] || 'free';

      try {
        await supabase
          .from('profiles')
          .update({
            plan: planName,
            stripe_customer_id: session.customer,
            subscription_id: session.subscription,
          })
          .eq('id', userId);

        // Grant initial month's credits
        if (credits) {
          const creditsToAdd = parseInt(credits, 10);
          if (creditsToAdd > 0) {
            const { data: profile } = await supabase
              .from('profiles')
              .select('credits')
              .eq('id', userId)
              .single();

            if (profile) {
              const newCredits = Math.min(profile.credits + creditsToAdd, 999999);
              await supabase
                .from('profiles')
                .update({ credits: newCredits })
                .eq('id', userId);

              try {
                await supabase.from('credit_audit_log').insert({
                  user_id: userId,
                  amount: creditsToAdd,
                  reason: 'subscription',
                  source: `stripe:${session.id}`,
                  balance_before: profile.credits,
                  balance_after: newCredits,
                });
              } catch (e) { /* best effort */ }
            }
          }
        }

        console.log(`Subscription created: ${planName} for user ${userId} (sub: ${session.subscription})`);
      } catch (err) {
        console.error('Failed to update subscription profile:', err.message);
      }

      return res.status(200).json({ received: true });
    }

    // Handle advertising purchase
    if (type === 'advertising') {
      console.log(`Ad purchase completed: ${packageId} by user ${userId} (session: ${session.id})`);
      return res.status(200).json({ received: true, type: 'advertising' });
    }

    // Handle one-off credit purchase
    if (!userId || !credits) {
      console.error('Missing metadata in checkout session:', session.id);
      return res.status(400).json({ error: 'Missing metadata' });
    }

    const creditsToAdd = parseInt(credits, 10);
    if (isNaN(creditsToAdd) || creditsToAdd <= 0) {
      console.error('Invalid credits value:', credits);
      return res.status(400).json({ error: 'Invalid credits' });
    }

    try {
      const { data: profile, error: fetchError } = await supabase
        .from('profiles')
        .select('credits')
        .eq('id', userId)
        .single();

      if (fetchError || !profile) {
        console.error('Failed to fetch profile:', fetchError?.message);
        return res.status(500).json({ error: 'User not found' });
      }

      const newCredits = Math.min(profile.credits + creditsToAdd, 999999);

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ credits: newCredits })
        .eq('id', userId);

      if (updateError) {
        console.error('Failed to update credits:', updateError.message);
        return res.status(500).json({ error: 'Credit update failed' });
      }

      try {
        await supabase.from('credit_audit_log').insert({
          user_id: userId,
          amount: creditsToAdd,
          reason: 'credit_purchase',
          source: `stripe:${session.id}`,
          balance_before: profile.credits,
          balance_after: newCredits,
        });
      } catch (auditErr) {
        console.warn('Audit log failed:', auditErr.message);
      }

      console.log(`Credits granted: ${creditsToAdd} to user ${userId} (package: ${packageId}, session: ${session.id})`);
      return res.status(200).json({ received: true, credits: creditsToAdd });
    } catch (err) {
      console.error('Database error:', err.message);
      return res.status(500).json({ error: 'Database error' });
    }
  }

  // ── INVOICE PAID (recurring subscription renewal — grant monthly credits) ──
  if (event.type === 'invoice.paid') {
    const invoice = event.data.object;

    // Only process renewal invoices (not first payment — handled by checkout.session.completed)
    if (invoice.billing_reason === 'subscription_cycle' && invoice.subscription) {
      try {
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
        const { userId, credits } = subscription.metadata;

        if (!userId || !credits) {
          console.log('Invoice paid but no userId/credits in subscription metadata');
          return res.status(200).json({ received: true });
        }

        const creditsToAdd = parseInt(credits, 10);
        if (isNaN(creditsToAdd) || creditsToAdd <= 0) {
          return res.status(200).json({ received: true });
        }

        const { data: profile } = await supabase
          .from('profiles')
          .select('credits')
          .eq('id', userId)
          .single();

        if (profile) {
          const newCredits = Math.min(profile.credits + creditsToAdd, 999999);
          await supabase
            .from('profiles')
            .update({ credits: newCredits })
            .eq('id', userId);

          try {
            await supabase.from('credit_audit_log').insert({
              user_id: userId,
              amount: creditsToAdd,
              reason: 'subscription_renewal',
              source: `stripe:${invoice.id}`,
              balance_before: profile.credits,
              balance_after: newCredits,
            });
          } catch (e) { /* best effort */ }

          console.log(`Subscription renewal: +${creditsToAdd} credits for user ${userId}`);
        }
      } catch (err) {
        console.error('Invoice.paid processing error:', err.message);
      }
    }

    return res.status(200).json({ received: true });
  }

  // ── SUBSCRIPTION DELETED (cancelled / expired) ──
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    const { userId } = subscription.metadata;

    if (userId) {
      try {
        await supabase
          .from('profiles')
          .update({ plan: 'free', subscription_id: null })
          .eq('id', userId);

        console.log(`Subscription cancelled for user ${userId}`);
      } catch (err) {
        console.error('Failed to update cancelled subscription:', err.message);
      }
    }

    return res.status(200).json({ received: true });
  }

  // ── SUBSCRIPTION UPDATED (plan change) ──
  if (event.type === 'customer.subscription.updated') {
    const subscription = event.data.object;
    const { userId, planId } = subscription.metadata;

    if (userId && planId) {
      const planName = PLAN_MAP[planId] || 'free';
      try {
        await supabase
          .from('profiles')
          .update({
            plan: planName,
            subscription_id: subscription.id,
          })
          .eq('id', userId);

        console.log(`Subscription updated: ${planName} for user ${userId}`);
      } catch (err) {
        console.error('Failed to update subscription:', err.message);
      }
    }

    return res.status(200).json({ received: true });
  }

  // Acknowledge other event types
  return res.status(200).json({ received: true });
};
