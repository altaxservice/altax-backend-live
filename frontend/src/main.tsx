import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installSpellcheckEnforcement } from './utils/enforceSpellcheck'
import { installFieldSuggestions } from './utils/fieldSuggestions'

installSpellcheckEnforcement()
installFieldSuggestions()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
