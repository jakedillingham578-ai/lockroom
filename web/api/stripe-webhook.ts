import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export const config = { api: { bodyParser: false } }

function readRawBody(req: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).end()

  const sig = req.headers['stripe-signature']
  const raw = await readRawBody(req)

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (e: any) {
    console.error('[stripe-webhook] signature verification failed:', e.message)
    return res.status(400).send(`Webhook Error: ${e.message}`)
  }

  try {
    // Pro is a group-level unlock — client_reference_id carries the group
    // id (see create-checkout-session), so a subscription sponsors every
    // member of that group, not just whoever paid.
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session
      const groupId = session.client_reference_id
      const customerId = session.customer as string
      const subscriptionId = session.subscription as string
      if (groupId) {
        await supabase.from('groups').update({
          is_pro: true,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
        }).eq('id', groupId)
      }
    }

    if (event.type === 'customer.subscription.deleted' || event.type === 'customer.subscription.updated') {
      const sub = event.data.object as Stripe.Subscription
      const active = sub.status === 'active' || sub.status === 'trialing'
      await supabase.from('groups').update({ is_pro: active }).eq('stripe_subscription_id', sub.id)
    }

    res.status(200).json({ received: true })
  } catch (e: any) {
    console.error('[stripe-webhook] handler error:', e.message)
    res.status(500).json({ error: e.message })
  }
}
