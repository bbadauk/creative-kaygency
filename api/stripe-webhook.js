const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

// Vercel serverless functions need raw body for Stripe signature verification
// This config tells Vercel NOT to parse the body
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

  // Only process completed checkout sessions
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { userId, packageId, credits } = session.metadata;

    if (!userId || !credits) {
      console.error('Missing metadata in checkout session:', session.id);
      return res.status(400).json({ error: 'Missing metadata' });
    }

    const creditsToAdd = parseInt(credits, 10);
    if (isNaN(creditsToAdd) || creditsToAdd <= 0) {
      console.error('Invalid credits value:', credits);
      return res.status(400).json({ error: 'Invalid credits' });
    }

    // Use Supabase service role key to bypass RLS
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    try {
      // Get current credits
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

      // Update credits
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ credits: newCredits })
        .eq('id', userId);

      if (updateError) {
        console.error('Failed to update credits:', updateError.message);
        return res.status(500).json({ error: 'Credit update failed' });
      }

      // Audit log
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
        // Audit is best-effort
        console.warn('Audit log failed:', auditErr.message);
      }

      console.log(`Credits granted: ${creditsToAdd} to user ${userId} (package: ${packageId}, session: ${session.id})`);
      return res.status(200).json({ received: true, credits: creditsToAdd });
    } catch (err) {
      console.error('Database error:', err.message);
      return res.status(500).json({ error: 'Database error' });
    }
  }

  // Acknowledge other event types
  return res.status(200).json({ received: true });
};
