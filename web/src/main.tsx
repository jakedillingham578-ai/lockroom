import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { runSettlementInBackground } from './lib/settlement'

// Auto-settle any pending bets against live ESPN scores on every app load
runSettlementInBackground()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
