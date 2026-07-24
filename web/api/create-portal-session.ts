import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { userId, origin } = req.body ?? {}
  if (!userId) return res.status(400).json({ error: 'Missing userId' })

  try {
    const { data: profile } = await supabase.from('profiles').select('stripe_customer_id').eq('id', userId).single()
    const customerId = (profile as any)?.stripe_customer_id
    if (!customerId) return res.status(400).json({ error: 'No Stripe customer on file for this user' })

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/profile`,
    })
    res.status(200).json({ url: session.url })
  } catch (e: any) {
    console.error('[create-portal-session]', e.message)
    res.status(500).json({ error: e.message })
  }
}
