import React, { useState } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';

const Layout = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(true); // Começa visível por padrão

  const handleToggleSidebar = () => setSidebarOpen((open) => !open);
  const handleCloseSidebar = () => setSidebarOpen(false);

  return (
    <div className="h-screen flex">
      {/* Sidebar responsivo */}
      <Sidebar isOpen={sidebarOpen} onClose={handleCloseSidebar} onToggle={handleToggleSidebar} />
      <div className="flex-1 flex flex-col">
        {/* Header sempre visível no topo */}
        <Header sidebarOpen={sidebarOpen} onToggleSidebar={handleToggleSidebar} />
        {/* Main com transição suave */}
        <main className={`flex-1 flex flex-col min-h-0 transition-all duration-300 ease-in-out ${
          sidebarOpen ? 'lg:pl-64' : 'lg:pl-0'
        }`}>
          {children}
        </main>
      </div>
    </div>
  );
};

export default Layout; 