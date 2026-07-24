import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

const PRICE_IDS: Record<string, string> = {
  monthly: 'price_1TwaS5Cj9qqGWRx7xrMOdwRa',
  yearly: 'price_1TwaS5Cj9qqGWRx7lKq6xchX',
}

// Pro is a group-level unlock — whoever subscribes sponsors their whole
// group, since the Pro games are shared experiences. client_reference_id
// carries the group id so the webhook knows which group to flip.
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { userId, groupId, plan, origin } = req.body ?? {}
  const priceId = PRICE_IDS[plan]
  if (!userId || !groupId || !priceId) return res.status(400).json({ error: 'Missing userId, groupId, or invalid plan' })

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: groupId,
      metadata: { userId, groupId },
      success_url: `${origin}/profile?pro=success`,
      cancel_url: `${origin}/profile?pro=cancelled`,
    })
    res.status(200).json({ url: session.url })
  } catch (e: any) {
    console.error('[create-checkout-session]', e.message)
    res.status(500).json({ error: e.message })
  }
}
