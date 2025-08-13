import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StatusBadge } from "@/components/ui/status-badge";
import { apiService, TaskStatus } from "@/lib/api";
import { 
  X, 
  Clock, 
  CheckCircle, 
  XCircle, 
  RefreshCw,
  Code2,
  Trash2
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface TrackedTask extends TaskStatus {
  name: string;
  startTime: Date;
  description?: string;
}

interface TaskSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function TaskSidebar({ isOpen, onClose }: TaskSidebarProps) {
  const [trackedTasks, setTrackedTasks] = useState<TrackedTask[]>([]);
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());

  // Load tracked tasks from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('wp-dashboard-tasks');
    if (saved) {
      const tasks = JSON.parse(saved);
      setTrackedTasks(tasks.map((task: any) => ({
        ...task,
        startTime: new Date(task.startTime),
      })));
    }

    // Listen for new tasks from other components
    const handleAddTask = (event: CustomEvent) => {
      const { taskId, name, description } = event.detail;
      const newTask: TrackedTask = {
        task_id: taskId,
        state: 'PENDING',
        name,
        description,
        startTime: new Date(),
      };
      
      setTrackedTasks(prev => [newTask, ...prev]);
    };

    window.addEventListener('addTask', handleAddTask as EventListener);
    return () => window.removeEventListener('addTask', handleAddTask as EventListener);
  }, []);

  // Save tracked tasks to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('wp-dashboard-tasks', JSON.stringify(trackedTasks));
  }, [trackedTasks]);

  // Poll active tasks
  const { data: taskUpdates } = useQuery({
    queryKey: ['task-updates-sidebar', trackedTasks.map(t => t.task_id)],
    queryFn: async () => {
      const activeTasks = trackedTasks.filter(t => 
        t.state === 'PENDING' || t.state === 'STARTED'
      );
      
      if (activeTasks.length === 0) return [];

      const updates = await Promise.allSettled(
        activeTasks.map(task => apiService.getTaskStatus(task.task_id))
      );

      return updates
        .map((result, index) => ({
          taskId: activeTasks[index].task_id,
          status: result.status === 'fulfilled' ? result.value : null,
        }))
        .filter(update => update.status !== null);
    },
    refetchInterval: 2000,
    enabled: trackedTasks.some(t => t.state === 'PENDING' || t.state === 'STARTED'),
  });

  // Update task states when polling returns new data
  useEffect(() => {
    if (taskUpdates) {
      setTrackedTasks(prevTasks => 
        prevTasks.map(task => {
          const update = taskUpdates.find(u => u.taskId === task.task_id);
          return update?.status ? { ...task, ...update.status } : task;
        })
      );
    }
  }, [taskUpdates]);

  // Remove a task from tracking
  const removeTask = (taskId: string) => {
    setTrackedTasks(prev => prev.filter(task => task.task_id !== taskId));
    setExpandedTasks(prev => {
      const newSet = new Set(prev);
      newSet.delete(taskId);
      return newSet;
    });
  };

  // Toggle task expansion
  const toggleExpanded = (taskId: string) => {
    setExpandedTasks(prev => {
      const newSet = new Set(prev);
      if (newSet.has(taskId)) {
        newSet.delete(taskId);
      } else {
        newSet.add(taskId);
      }
      return newSet;
    });
  };

  const formatDuration = (startTime: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - startTime.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    
    if (diffMins < 1) return `${diffSecs}s`;
    if (diffMins < 60) return `${diffMins}m ${diffSecs % 60}s`;
    const diffHours = Math.floor(diffMins / 60);
    return `${diffHours}h ${diffMins % 60}m`;
  };

  const getStatusFromState = (state: string): 'pending' | 'running' | 'success' | 'failure' => {
    switch (state) {
      case 'PENDING': return 'pending';
      case 'STARTED': return 'running';
      case 'SUCCESS': return 'success';
      case 'FAILURE': return 'failure';
      default: return 'pending';
    }
  };

  const formatResult = (result: any): string => {
    if (!result) return 'No result data';
    
    if (typeof result === 'string') return result;
    
    if (result.updated !== undefined) {
      if (result.updated) {
        return `Update successful${result.details ? `: ${JSON.stringify(result.details)}` : ''}`;
      } else {
        return `Update failed: ${result.error || 'Unknown error'}${result.restored ? ' (Site restored from backup)' : ''}`;
      }
    }
    
    if (result.message) return result.message;
    if (result.status) return result.status;
    
    return 'Task completed';
  };

  const activeTasks = trackedTasks.filter(t => t.state === 'PENDING' || t.state === 'STARTED');
  const recentTasks = trackedTasks.slice(0, 10); // Show last 10 tasks

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/20 z-40 lg:hidden"
            onClick={onClose}
          />

          {/* Sidebar */}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 h-full w-96 bg-background border-l border-border z-50 flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="flex items-center space-x-2">
                <RefreshCw className={`w-5 h-5 ${activeTasks.length > 0 ? 'animate-spin text-primary' : 'text-muted-foreground'}`} />
                <h2 className="text-lg font-semibold">Task Monitor</h2>
              </div>
              <Button variant="ghost" size="sm" onClick={onClose}>
                <X className="w-4 h-4" />
              </Button>
            </div>

            {/* Summary */}
            <div className="p-4 border-b border-border">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-lg font-bold text-warning">{activeTasks.length}</div>
                  <div className="text-xs text-muted-foreground">Active</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-success">
                    {trackedTasks.filter(t => t.state === 'SUCCESS').length}
                  </div>
                  <div className="text-xs text-muted-foreground">Success</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-destructive">
                    {trackedTasks.filter(t => t.state === 'FAILURE').length}
                  </div>
                  <div className="text-xs text-muted-foreground">Failed</div>
                </div>
              </div>
            </div>

            {/* Tasks List */}
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-4">
                {/* Active Tasks */}
                {activeTasks.length > 0 && (
                  <div>
                    <h3 className="font-medium mb-2 text-sm text-muted-foreground uppercase tracking-wide">
                      Active Tasks
                    </h3>
                    <div className="space-y-2">
                      {activeTasks.map((task) => (
                        <motion.div
                          key={task.task_id}
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="p-3 border rounded-lg bg-card"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <StatusBadge status={getStatusFromState(task.state)} />
                            <span className="text-xs text-muted-foreground">
                              {formatDuration(task.startTime)}
                            </span>
                          </div>
                          <h4 className="font-medium text-sm">{task.name}</h4>
                          {task.description && (
                            <p className="text-xs text-muted-foreground mt-1">{task.description}</p>
                          )}
                        </motion.div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recent Tasks */}
                {recentTasks.length > 0 && (
                  <div>
                    <h3 className="font-medium mb-2 text-sm text-muted-foreground uppercase tracking-wide">
                      Recent Tasks
                    </h3>
                    <div className="space-y-2">
                      {recentTasks.map((task) => (
                        <Collapsible key={task.task_id}>
                          <CollapsibleTrigger
                            className="flex items-center justify-between w-full p-3 border rounded-lg hover:bg-muted/50 transition-colors text-left"
                            onClick={() => toggleExpanded(task.task_id)}
                          >
                            <div className="flex items-center space-x-2">
                              <StatusBadge status={getStatusFromState(task.state)} />
                              <div>
                                <div className="font-medium text-sm">{task.name}</div>
                                <div className="text-xs text-muted-foreground">
                                  {task.startTime.toLocaleTimeString()}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center space-x-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeTask(task.task_id);
                                }}
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </CollapsibleTrigger>
                          
                          <CollapsibleContent className="px-3 pb-3">
                            <div className="mt-2 space-y-2 border-t pt-2">
                              <div className="text-xs">
                                <span className="text-muted-foreground">Duration:</span>
                                <span className="ml-1">{formatDuration(task.startTime)}</span>
                              </div>
                              
                              {task.result && (
                                <div>
                                  <div className="text-xs text-muted-foreground mb-1">Result:</div>
                                  <div className="text-xs bg-muted p-2 rounded">
                                    {formatResult(task.result)}
                                  </div>
                                </div>
                              )}
                              
                              {task.info && task.state === 'FAILURE' && (
                                <div>
                                  <div className="text-xs text-muted-foreground mb-1">Error:</div>
                                  <div className="text-xs bg-destructive/10 text-destructive p-2 rounded">
                                    {task.info}
                                  </div>
                                </div>
                              )}
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      ))}
                    </div>
                  </div>
                )}

                {/* Empty State */}
                {trackedTasks.length === 0 && (
                  <div className="text-center py-8">
                    <Clock className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
                    <h3 className="font-medium mb-2">No tasks yet</h3>
                    <p className="text-sm text-muted-foreground">
                      Tasks will appear here when you start operations
                    </p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// Export the hook for adding tasks
export const useTaskTracker = () => {
  const addTaskToTracker = (taskId: string, name: string, description?: string) => {
    const event = new CustomEvent('addTask', { 
      detail: { taskId, name, description } 
    });
    window.dispatchEvent(event);
  };

  return { addTaskToTracker };
};