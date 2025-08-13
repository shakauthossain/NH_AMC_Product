import { cn } from "@/lib/utils";
import { CheckCircle, Clock, XCircle, Loader2 } from "lucide-react";

interface StatusBadgeProps {
  status: 'pending' | 'running' | 'success' | 'failure';
  text?: string;
  className?: string;
}

const statusConfig = {
  pending: {
    icon: Clock,
    className: "status-pending",
    defaultText: "Pending"
  },
  running: {
    icon: Loader2,
    className: "status-running",
    defaultText: "Running"
  },
  success: {
    icon: CheckCircle,
    className: "status-success",
    defaultText: "Completed"
  },
  failure: {
    icon: XCircle,
    className: "status-failure",
    defaultText: "Failed"
  }
};

export function StatusBadge({ status, text, className }: StatusBadgeProps) {
  const config = statusConfig[status];
  const Icon = config.icon;
  
  return (
    <span className={cn("status-badge", config.className, className)}>
      <Icon className={cn("w-3 h-3 mr-1", status === 'running' && "animate-spin")} />
      {text || config.defaultText}
    </span>
  );
}