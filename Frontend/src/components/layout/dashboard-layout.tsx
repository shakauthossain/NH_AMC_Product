import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { 
  Server, 
  Plus, 
  Activity, 
  ListTodo, 
  Settings,
  Menu,
  X,
  Shield,
  MonitorSpeaker
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TaskSidebar } from "./task-sidebar";

interface DashboardLayoutProps {
  children: React.ReactNode;
  currentPage: string;
  onPageChange: (page: string) => void;
}

const navigation = [
  { name: 'Connections', id: 'connections', icon: Server },
  { name: 'WP Status', id: 'wp-status', icon: Shield },
  { name: 'Provision', id: 'provision', icon: Plus },
  { name: 'Operations', id: 'operations', icon: Activity },
  { name: 'Tasks', id: 'tasks', icon: ListTodo },
];

export function DashboardLayout({ children, currentPage, onPageChange }: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [taskSidebarOpen, setTaskSidebarOpen] = useState(false);
  const [hasActiveTasks, setHasActiveTasks] = useState(false);

  // Check for active tasks and auto-open sidebar
  useEffect(() => {
    const checkTasks = () => {
      const saved = localStorage.getItem('wp-dashboard-tasks');
      if (saved) {
        const tasks = JSON.parse(saved);
        const activeTasks = tasks.filter((task: any) => 
          task.state === 'PENDING' || task.state === 'STARTED'
        );
        const hasActive = activeTasks.length > 0;
        setHasActiveTasks(hasActive);
        
        // Auto-open task sidebar when new tasks are added
        if (hasActive && !taskSidebarOpen) {
          setTaskSidebarOpen(true);
        }
      }
    };

    // Check initially
    checkTasks();

    // Listen for new tasks
    const handleAddTask = () => {
      setTimeout(checkTasks, 100); // Small delay to ensure localStorage is updated
      setTaskSidebarOpen(true); // Always open when new task is added
    };

    window.addEventListener('addTask', handleAddTask);
    
    // Check periodically for task updates
    const interval = setInterval(checkTasks, 2000);

    return () => {
      window.removeEventListener('addTask', handleAddTask);
      clearInterval(interval);
    };
  }, [taskSidebarOpen]);

  return (
    <div className="flex h-screen bg-background">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <motion.aside
        initial={false}
        animate={{ 
          x: sidebarOpen ? 0 : -320,
          width: sidebarOpen ? 320 : 0
        }}
        className={cn(
          "relative z-50 bg-sidebar border-r border-sidebar-border lg:static",
          "flex flex-col h-full overflow-hidden",
          !sidebarOpen && "lg:w-0"
        )}
      >
        {/* Sidebar header */}
        <div className="flex items-center justify-between p-6 border-b border-sidebar-border">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-primary rounded-lg">
              <Shield className="w-6 h-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-sidebar-foreground">WP Manager</h1>
              <p className="text-xs text-sidebar-foreground/60">WordPress Operations</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="lg:hidden"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1">
          {navigation.map((item) => (
            <Button
              key={item.id}
              variant={currentPage === item.id ? "default" : "ghost"}
              className={cn(
                "w-full justify-start",
                currentPage === item.id && "bg-sidebar-primary text-sidebar-primary-foreground"
              )}
              onClick={() => {
                onPageChange(item.id);
                // Keep sidebar open on desktop, close on mobile
                if (window.innerWidth < 1024) {
                  setSidebarOpen(false);
                }
              }}
            >
              <item.icon className="w-4 h-4 mr-3" />
              {item.name}
            </Button>
          ))}
        </nav>

        {/* Settings */}
        <div className="p-4 border-t border-sidebar-border">
          <Button
            variant={currentPage === 'settings' ? "default" : "ghost"}
            className={cn(
              "w-full justify-start",
              currentPage === 'settings' && "bg-sidebar-primary text-sidebar-primary-foreground"
            )}
            onClick={() => {
              onPageChange('settings');
              if (window.innerWidth < 1024) {
                setSidebarOpen(false);
              }
            }}
          >
            <Settings className="w-4 h-4 mr-3" />
            Settings
          </Button>
        </div>
      </motion.aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-16 border-b border-border bg-card/50 backdrop-blur-sm">
          <div className="flex items-center justify-between h-full px-6">
            <div className="flex items-center space-x-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSidebarOpen(!sidebarOpen)}
              >
                <Menu className="w-4 h-4" />
              </Button>
              <h2 className="text-xl font-semibold capitalize">
                {currentPage.replace('-', ' ')}
              </h2>
            </div>
            
            {/* Task Monitor Toggle */}
            <div className="flex items-center space-x-2">
              <Button
                variant={taskSidebarOpen ? "default" : "ghost"}
                size="sm"
                onClick={() => setTaskSidebarOpen(!taskSidebarOpen)}
                className={cn(
                  "relative",
                  hasActiveTasks && !taskSidebarOpen && "animate-pulse"
                )}
              >
                <MonitorSpeaker className="w-4 h-4" />
                {hasActiveTasks && (
                  <div className="absolute -top-1 -right-1 w-3 h-3 bg-primary rounded-full flex items-center justify-center">
                    <div className="w-1.5 h-1.5 bg-primary-foreground rounded-full"></div>
                  </div>
                )}
              </Button>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          <motion.div
            key={currentPage}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="p-6"
          >
            {children}
          </motion.div>
        </main>
      </div>

      {/* Task Sidebar */}
      <TaskSidebar 
        isOpen={taskSidebarOpen} 
        onClose={() => setTaskSidebarOpen(false)} 
      />
    </div>
  );
}