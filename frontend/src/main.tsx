import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
// Poppins bundled with the app, latin only: no CDN (LAN-first)
import '@fontsource/poppins/latin-400.css';
import '@fontsource/poppins/latin-600.css';
import '@fontsource/poppins/latin-700.css';
import './index.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
