import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@fontsource-variable/inter';
import './theme.css';
import { AuthProvider } from './auth';
import { App } from './App';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Render free-tier cold starts: keep retrying while the box wakes up.
      retry: 3,
      retryDelay: (attempt) => Math.min(4000 * 2 ** attempt, 20_000),
      refetchOnWindowFocus: true,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename="/admin">
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
