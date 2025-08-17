import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { 
  ChevronDown, 
  ChevronUp, 
  Bug, 
  CheckCircle, 
  AlertTriangle, 
  XCircle,
  Eye,
  Copy,
  Code
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { NormalizationDebugInfo, NormalizationResult } from "@/lib/plugin-normalizer";

interface PluginDebugPanelProps {
  debugInfo?: NormalizationDebugInfo;
  taskResult?: any;
  attempts?: any[];
  className?: string;
}

export function PluginDebugPanel({ 
  debugInfo, 
  taskResult, 
  attempts, 
  className = "" 
}: PluginDebugPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  if (!debugInfo && !taskResult && !attempts) {
    return null;
  }

  const toggleSection = (section: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(section)) {
      newExpanded.delete(section);
    } else {
      newExpanded.add(section);
    }
    setExpandedSections(newExpanded);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied to clipboard",
      description: "Debug information copied successfully",
    });
  };

  const getConfidenceBadge = (confidence: 'high' | 'medium' | 'low') => {
    const variants = {
      high: { variant: "default" as const, className: "bg-success/10 text-success border-success" },
      medium: { variant: "outline" as const, className: "bg-warning/10 text-warning border-warning" },
      low: { variant: "destructive" as const, className: "bg-destructive/10 text-destructive border-destructive" },
    };
    return variants[confidence];
  };

  const getMethodIcon = (method: string) => {
    switch (method) {
      case 'exact': return <CheckCircle className="w-4 h-4 text-success" />;
      case 'slug_match': return <CheckCircle className="w-4 h-4 text-success" />;
      case 'name_match': return <AlertTriangle className="w-4 h-4 text-warning" />;
      case 'guess': return <XCircle className="w-4 h-4 text-destructive" />;
      default: return <Bug className="w-4 h-4 text-muted-foreground" />;
    }
  };

  return (
    <Card className={`dashboard-card ${className}`}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/5 transition-colors">
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Bug className="w-5 h-5" />
                <span>Plugin Update Debug Info</span>
                {debugInfo && (
                  <Badge variant="outline" className="ml-2">
                    {debugInfo.results.filter(r => r.normalized).length}/{debugInfo.input.length} normalized
                  </Badge>
                )}
              </div>
              {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="space-y-6">
            <AnimatePresence>
              {/* Normalization Results */}
              {debugInfo && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-4"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">Plugin Normalization</h3>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyToClipboard(JSON.stringify(debugInfo, null, 2))}
                    >
                      <Copy className="w-4 h-4 mr-2" />
                      Copy Debug Info
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Input Plugins:</span>
                      <div className="font-mono bg-muted p-2 rounded mt-1">
                        {debugInfo.input.join(', ')}
                      </div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Final Plugin Files:</span>
                      <div className="font-mono bg-muted p-2 rounded mt-1">
                        {debugInfo.final_plugin_files.join(', ') || 'None'}
                      </div>
                    </div>
                  </div>

                  {/* Normalization Details */}
                  <Collapsible 
                    open={expandedSections.has('normalization')} 
                    onOpenChange={() => toggleSection('normalization')}
                  >
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" className="w-full justify-between p-0 h-auto">
                        <span className="font-medium">Normalization Details</span>
                        {expandedSections.has('normalization') ? 
                          <ChevronUp className="w-4 h-4" /> : 
                          <ChevronDown className="w-4 h-4" />
                        }
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-2">
                      <ScrollArea className="h-48">
                        <div className="space-y-2">
                          {debugInfo.results.map((result: NormalizationResult, index: number) => (
                            <div key={index} className="border rounded p-3 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="font-mono text-sm">{result.original}</span>
                                <div className="flex items-center space-x-2">
                                  {getMethodIcon(result.method)}
                                  <Badge {...getConfidenceBadge(result.confidence)}>
                                    {result.confidence}
                                  </Badge>
                                </div>
                              </div>
                              <div className="text-sm text-muted-foreground">
                                Method: {result.method}
                              </div>
                              {result.normalized ? (
                                <div className="text-sm">
                                  <span className="text-muted-foreground">→ </span>
                                  <span className="font-mono bg-success/10 px-1 rounded">
                                    {result.normalized}
                                  </span>
                                </div>
                              ) : (
                                <div className="text-sm text-destructive">
                                  → Failed to normalize
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </CollapsibleContent>
                  </Collapsible>
                </motion.div>
              )}

              {/* Update Attempts */}
              {attempts && attempts.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-4"
                >
                  <Separator />
                  
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">Update Attempts</h3>
                    <Badge variant="outline">
                      {attempts.length} attempts
                    </Badge>
                  </div>

                  <Collapsible 
                    open={expandedSections.has('attempts')} 
                    onOpenChange={() => toggleSection('attempts')}
                  >
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" className="w-full justify-between p-0 h-auto">
                        <span className="font-medium">Attempt Details</span>
                        {expandedSections.has('attempts') ? 
                          <ChevronUp className="w-4 h-4" /> : 
                          <ChevronDown className="w-4 h-4" />
                        }
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-2">
                      <ScrollArea className="h-48">
                        <div className="space-y-3">
                          {attempts.map((attempt, index) => (
                            <div key={index} className="border rounded p-3 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="font-medium">Attempt {index + 1}</span>
                                <Badge variant={attempt.error ? "destructive" : "default"}>
                                  {attempt.error ? "Failed" : "Success"}
                                </Badge>
                              </div>
                              <div className="text-sm text-muted-foreground">
                                Format: {attempt.format}
                              </div>
                              {attempt.error && (
                                <div className="text-sm text-destructive bg-destructive/5 p-2 rounded">
                                  {attempt.error}
                                </div>
                              )}
                              <Collapsible 
                                open={expandedSections.has(`attempt-${index}`)} 
                                onOpenChange={() => toggleSection(`attempt-${index}`)}
                              >
                                <CollapsibleTrigger asChild>
                                  <Button variant="ghost" size="sm" className="h-auto p-1">
                                    <Code className="w-3 h-3 mr-1" />
                                    <span className="text-xs">View Payload</span>
                                  </Button>
                                </CollapsibleTrigger>
                                <CollapsibleContent>
                                  <pre className="text-xs bg-muted p-2 rounded mt-1 overflow-x-auto">
                                    {JSON.stringify(attempt.payload, null, 2)}
                                  </pre>
                                </CollapsibleContent>
                              </Collapsible>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </CollapsibleContent>
                  </Collapsible>
                </motion.div>
              )}

              {/* Task Result */}
              {taskResult && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-4"
                >
                  <Separator />
                  
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">Task Result</h3>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyToClipboard(JSON.stringify(taskResult, null, 2))}
                    >
                      <Copy className="w-4 h-4 mr-2" />
                      Copy Result
                    </Button>
                  </div>

                  <Collapsible 
                    open={expandedSections.has('result')} 
                    onOpenChange={() => toggleSection('result')}
                  >
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" className="w-full justify-between p-0 h-auto">
                        <span className="font-medium">Full Result</span>
                        {expandedSections.has('result') ? 
                          <ChevronUp className="w-4 h-4" /> : 
                          <ChevronDown className="w-4 h-4" />
                        }
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-2">
                      <ScrollArea className="h-64">
                        <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
                          {JSON.stringify(taskResult, null, 2)}
                        </pre>
                      </ScrollArea>
                    </CollapsibleContent>
                  </Collapsible>
                </motion.div>
              )}
            </AnimatePresence>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}