import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { StatusBadge } from "@/components/ui/status-badge";
import { apiService, TaskStatus } from "@/lib/api";
import { 
  ListTodo, 
  Clock, 
  CheckCircle, 
  XCircle, 
  ChevronDown, 
  RefreshCw,
  Code2,
  Trash2
} from "lucide-react";

interface TrackedTask extends TaskStatus {
  name: string;
  startTime: Date;
  description?: string;
}

export function TasksPage() {
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
  }, []);

  // Save tracked tasks to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('wp-dashboard-tasks', JSON.stringify(trackedTasks));
  }, [trackedTasks]);

  // Poll active tasks
  const { data: taskUpdates } = useQuery({
    queryKey: ['task-updates', trackedTasks.map(t => t.task_id)],
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

  // Add a new task to track
  const addTask = (taskId: string, name: string, description?: string) => {
    const newTask: TrackedTask = {
      task_id: taskId,
      state: 'PENDING',
      name,
      description,
      startTime: new Date(),
    };
    
    setTrackedTasks(prev => [newTask, ...prev]);
  };

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

  // Clear completed tasks
  const clearCompleted = () => {
    setTrackedTasks(prev => prev.filter(task => 
      task.state === 'PENDING' || task.state === 'STARTED'
    ));
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
    
    // Handle specific result formats
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
  const completedTasks = trackedTasks.filter(t => t.state === 'SUCCESS' || t.state === 'FAILURE');

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Task Monitor</h1>
          <p className="text-muted-foreground">Real-time task status and results</p>
        </div>
        {completedTasks.length > 0 && (
          <Button variant="outline" onClick={clearCompleted}>
            <Trash2 className="w-4 h-4 mr-2" />
            Clear Completed
          </Button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <Card className="dashboard-card">
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <Clock className="w-5 h-5 text-warning" />
              <div>
                <p className="text-sm text-muted-foreground">Active</p>
                <p className="text-2xl font-bold">{activeTasks.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="dashboard-card">
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <CheckCircle className="w-5 h-5 text-success" />
              <div>
                <p className="text-sm text-muted-foreground">Completed</p>
                <p className="text-2xl font-bold">
                  {trackedTasks.filter(t => t.state === 'SUCCESS').length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="dashboard-card">
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <XCircle className="w-5 h-5 text-destructive" />
              <div>
                <p className="text-sm text-muted-foreground">Failed</p>
                <p className="text-2xl font-bold">
                  {trackedTasks.filter(t => t.state === 'FAILURE').length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="dashboard-card">
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <ListTodo className="w-5 h-5 text-primary" />
              <div>
                <p className="text-sm text-muted-foreground">Total</p>
                <p className="text-2xl font-bold">{trackedTasks.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Active Tasks */}
      {activeTasks.length > 0 && (
        <Card className="dashboard-card">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <RefreshCw className="w-5 h-5 animate-spin" />
              <span>Active Tasks</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <AnimatePresence>
              {activeTasks.map((task) => (
                <motion.div
                  key={task.task_id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="p-4 border rounded-lg space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <StatusBadge status={getStatusFromState(task.state)} />
                      <div>
                        <h3 className="font-medium">{task.name}</h3>
                        <p className="text-sm text-muted-foreground">
                          ID: {task.task_id}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">{formatDuration(task.startTime)}</p>
                      <p className="text-xs text-muted-foreground">
                        {task.startTime.toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                  
                  {task.description && (
                    <p className="text-sm text-muted-foreground">{task.description}</p>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </CardContent>
        </Card>
      )}

      {/* Completed Tasks */}
      {completedTasks.length > 0 && (
        <Card className="dashboard-card">
          <CardHeader>
            <CardTitle>Task History</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {completedTasks.map((task) => (
              <Collapsible key={task.task_id}>
                <CollapsibleTrigger
                  className="flex items-center justify-between w-full p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                  onClick={() => toggleExpanded(task.task_id)}
                >
                  <div className="flex items-center space-x-3">
                    <StatusBadge status={getStatusFromState(task.state)} />
                    <div className="text-left">
                      <h3 className="font-medium">{task.name}</h3>
                      <p className="text-sm text-muted-foreground">
                        {task.startTime.toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeTask(task.task_id);
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                    <ChevronDown
                      className={`w-4 h-4 transition-transform ${
                        expandedTasks.has(task.task_id) ? 'rotate-180' : ''
                      }`}
                    />
                  </div>
                </CollapsibleTrigger>
                
                <CollapsibleContent className="px-4 pb-4">
                  <div className="mt-3 space-y-3 border-t pt-3">
                    <div>
                      <h4 className="text-sm font-medium mb-2">Task Details</h4>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">Task ID:</span>
                          <p className="font-mono">{task.task_id}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Duration:</span>
                          <p>{formatDuration(task.startTime)}</p>
                        </div>
                      </div>
                    </div>
                    
                    {task.result && (
                      <div>
                        <h4 className="text-sm font-medium mb-2">Result</h4>
                        <div className="p-3 bg-muted rounded-lg">
                          <p className="text-sm mb-2">{formatResult(task.result)}</p>
                          <Collapsible>
                            <CollapsibleTrigger className="flex items-center space-x-2 text-xs text-muted-foreground hover:text-foreground">
                              <Code2 className="w-3 h-3" />
                              <span>Show raw JSON</span>
                            </CollapsibleTrigger>
                            <CollapsibleContent className="mt-2">
                              <pre className="text-xs bg-card p-2 rounded border overflow-auto max-h-40">
                                {JSON.stringify(task.result, null, 2)}
                              </pre>
                            </CollapsibleContent>
                          </Collapsible>
                        </div>
                      </div>
                    )}
                    
                    {task.info && task.state === 'FAILURE' && (
                      <div>
                        <h4 className="text-sm font-medium mb-2">Error Information</h4>
                        <div className="p-3 bg-destructive/10 rounded-lg">
                          <p className="text-sm text-destructive">{task.info}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {trackedTasks.length === 0 && (
        <Card className="dashboard-card">
          <CardContent className="text-center py-12">
            <ListTodo className="w-16 h-16 mx-auto mb-4 text-muted-foreground/50" />
            <h3 className="text-lg font-medium mb-2">No tasks yet</h3>
            <p className="text-muted-foreground">
              Tasks will appear here when you start operations from other pages
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Export the addTask function for use in other components
export const useTaskTracker = () => {
  const addTaskToTracker = (taskId: string, name: string, description?: string) => {
    // This is a simple implementation - in a real app you might want to use a global state manager
    const event = new CustomEvent('addTask', { 
      detail: { taskId, name, description } 
    });
    window.dispatchEvent(event);
  };

  return { addTaskToTracker };
};