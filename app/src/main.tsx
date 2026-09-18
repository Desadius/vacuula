import { createRoot } from 'react-dom/client'
import { BrowserRouter } from "react-router";
import { AppProvider } from './context/AppContext'
import './i18n'
import './theme/theme.css'
import './theme'
import './mascot'
import './index.css'
import App from './app.tsx'
import { registerServiceWorker } from './serviceWorker'

registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <AppProvider>
    <BrowserRouter basename='/web'>
      <App />
    </BrowserRouter>
  </AppProvider>,
)
