import React from 'react';
import { BrowserRouter as Router, useRoutes } from 'react-router-dom';
import IntersectObserver from '@/components/common/IntersectObserver';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider } from '@/contexts/AuthContext';

import { routes } from './Routes';

const AppRoutes = () => {
  const element = useRoutes(routes);
  return element;
};

const App: React.FC = () => {
  return (
    <Router>
      <AuthProvider>
        <IntersectObserver />
        <div className="flex flex-col min-h-screen">
          <AppRoutes />
        </div>
        <Toaster />
      </AuthProvider>
    </Router>
  );
};

export default App;
