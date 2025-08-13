import { useState } from "react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { ConnectionsPage } from "@/components/pages/connections";
import { WPStatusPage } from "@/components/pages/wp-status";
import { ProvisionPage } from "@/components/pages/provision";
import { OperationsPage } from "@/components/pages/operations";
import { TasksPage } from "@/components/pages/tasks";
import { SettingsPage } from "@/components/pages/settings";

const Index = () => {
  const [currentPage, setCurrentPage] = useState('connections');

  const renderCurrentPage = () => {
    switch (currentPage) {
      case 'connections':
        return <ConnectionsPage />;
      case 'wp-status':
        return <WPStatusPage />;
      case 'provision':
        return <ProvisionPage />;
      case 'operations':
        return <OperationsPage />;
      case 'tasks':
        return <TasksPage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <ConnectionsPage />;
    }
  };

  return (
    <DashboardLayout currentPage={currentPage} onPageChange={setCurrentPage}>
      {renderCurrentPage()}
    </DashboardLayout>
  );
};

export default Index;
