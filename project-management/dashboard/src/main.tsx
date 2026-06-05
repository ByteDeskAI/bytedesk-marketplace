import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { setGlobalTheme } from '@atlaskit/tokens';
import App from './App';

// Apply Atlassian dark theme — injects all --ds-* CSS custom properties into :root
setGlobalTheme({ colorMode: 'dark' });

const root = document.getElementById('root');
if (!root) throw new Error('#root element not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
