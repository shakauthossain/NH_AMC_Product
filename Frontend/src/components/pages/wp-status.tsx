import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiService } from "@/lib/api";
import { PluginDebugPanel } from "@/components/ui/plugin-debug-panel";
import { useTaskTracker } from "../layout/task-sidebar";
import type { PluginInfo, NormalizationDebugInfo } from "@/lib/plugin-normalizer";
import { 
  Shield, 
  RefreshCw, 
  Globe, 
  AlertTriangle,
  CheckCircle,
  Clock,
  Server,
  Zap,
  Palette,
  Lock,
  Calendar
} from "lucide-react";

interface WordPressStatus {
  version: string;
  latestVersion: string;
  updateAvailable: boolean;
  lastUpdated: string;
  plugins: Array<{
    name: string;
    status: 'Active' | 'Inactive';
    currentVersion: string;
    latestVersion: string;
    updateAvailable: boolean;
  }>;
  themes: Array<{
    name: string;
    status: 'Active' | 'Inactive';
    currentVersion: string;
    latestVersion: string;
    updateAvailable: boolean;
  }>;
}

interface SSLStatus {
  valid: boolean;
  expiresIn: number;
  issuer: string;
  expiryProgress: number;
}

interface DomainInfo {
  domain: string;
  registrar: string;
  expiresIn: number;
  nameservers: string[];
}

export function WPStatusPage() {
  const [selectedSite, setSelectedSite] = useState<string>("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [updatingItems, setUpdatingItems] = useState<Set<string>>(new Set());
  const [isUpdateDialogOpen, setIsUpdateDialogOpen] = useState(false);
  const [selectedUpdateItem, setSelectedUpdateItem] = useState<{name: string, type: 'plugin' | 'theme'} | null>(null);
  const [updateFormData, setUpdateFormData] = useState({
    dbName: '',
    dbUser: '',
    dbPassword: '',
    domain: ''
  });
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);
  const [debugInfo, setDebugInfo] = useState<{
    normalization?: NormalizationDebugInfo;
    attempts?: any[];
    taskResult?: any;
  }>({});
  const { toast } = useToast();
  const { addTaskToTracker } = useTaskTracker();

  // Load saved connections
  const { data: savedConnections = [] } = useQuery({
    queryKey: ['saved-connections'],
    queryFn: () => {
      const saved = localStorage.getItem('wp-dashboard-connections');
      return saved ? JSON.parse(saved) : [];
    },
  });

  const selectedConnection = savedConnections.find((conn: any) => conn.id === selectedSite);


  const { data: sslStatus, refetch: refetchSSL, isLoading: sslLoading } = useQuery({
    queryKey: ['ssl-status', selectedSite],
    queryFn: async () => {
      if (!selectedSite || !selectedConnection) return null;
      
      // Extract domain from connection name or use host
      const domain = selectedConnection.name?.includes('.') 
        ? selectedConnection.name 
        : selectedConnection.host;
      
      try {
        const sslResponse = await apiService.domainSslCollect(domain);
        const result = await apiService.pollTask(sslResponse.task_id);
        
        if (result.state === 'SUCCESS' && result.result) {
          const sslInfo = result.result.ssl_info || {};
          const expiresIn = sslInfo.expires_in_days || 0;
          return {
            valid: sslInfo.valid || false,
            expiresIn,
            issuer: sslInfo.issuer || "Unknown",
            expiryProgress: Math.min(100, Math.max(0, ((90 - expiresIn) / 90) * 100))
          } as SSLStatus;
        }
        
        return null;
      } catch (error) {
        console.error('SSL check failed:', error);
        return null;
      }
    },
    enabled: !!selectedSite && !!selectedConnection,
    refetchInterval: autoRefresh ? 60000 : false,
    retry: false,
  });

  const { data: domainInfo, refetch: refetchDomain, isLoading: domainLoading } = useQuery({
    queryKey: ['domain-info', selectedSite],
    queryFn: async () => {
      if (!selectedSite || !selectedConnection) return null;
      
      const domain = selectedConnection.name?.includes('.') 
        ? selectedConnection.name 
        : selectedConnection.host;
      
      try {
        const domainResponse = await apiService.domainSslCollect(domain);
        const result = await apiService.pollTask(domainResponse.task_id);
        
        if (result.state === 'SUCCESS' && result.result) {
          const domainData = result.result.domain_info || {};
          return {
            domain,
            registrar: domainData.registrar || "Unknown",
            expiresIn: domainData.expires_in_days || 0,
            nameservers: domainData.nameservers || []
          } as DomainInfo;
        }
        
        return null;
      } catch (error) {
        console.error('Domain check failed:', error);
        return null;
      }
    },
    enabled: !!selectedSite && !!selectedConnection,
    refetchInterval: autoRefresh ? 300000 : false,
    retry: false,
  });

  // WP Outdated Status - separate check for plugins/themes
  const { data: wpOutdatedStatus, refetch: refetchOutdated, isLoading: outdatedLoading } = useQuery({
    queryKey: ['wp-outdated', selectedSite],
    queryFn: async () => {
      if (!selectedSite || !selectedConnection) return null;
      
      const domain = selectedConnection.host;
      // Send site root URL only (not the full /wp-json/custom/v1/status path)
      const baseUrl = domain.startsWith('http') ? domain : `http://${domain}`;
      
      try {
        const outdatedResponse = await apiService.wpOutdatedFetch(baseUrl);
        const result = await apiService.pollTask(outdatedResponse.task_id);
        
        if (result.state === 'SUCCESS' && result.result) {
          const summary = result.result.summary || {};
          const raw = result.result.raw || {};
          
          console.log("WP Outdated new data structure:", {
            summary,
            rawPluginsList: raw.plugins?.list,
            rawThemesList: raw.themes?.list,
            fullResult: result.result
          });
          
          // Build arrays according to new schema
          const pluginsAll = Array.isArray(raw.plugins?.list) ? raw.plugins.list : [];
          const themesAll = Array.isArray(raw.themes?.list) ? raw.themes.list : [];
          
          const pluginsOutdated = Array.isArray(summary.plugins_outdated) 
            ? summary.plugins_outdated 
            : pluginsAll.filter((p: any) => p.has_update === true);
            
          const themesOutdated = Array.isArray(summary.themes_outdated)
            ? summary.themes_outdated
            : themesAll.filter((t: any) => t.has_update === true);
          
          return {
            pluginsAll,
            themesAll,
            pluginsOutdated,
            themesOutdated,
            core: {
              current_version: summary.core_current,
              latest_version: summary.core_latest,
              update_available: summary.core_update_available
            },
            summary,
            raw
          };
        }
        
        return null;
      } catch (error) {
        console.error('WP Outdated check failed:', error);
        return null;
      }
    },
    enabled: !!selectedSite && !!selectedConnection,
    refetchInterval: autoRefresh ? 60000 : false,
    retry: false,
  });

  // console.log("Current wpOutdatedStatus:", wpOutdatedStatus);

  const handleRefreshAll = () => {
    refetchSSL();
    refetchDomain();
    refetchOutdated();
    toast({
      title: "Refreshing status",
      description: "Updating all status information...",
    });
  };

  const openUpdateDialog = (itemName: string, itemType: 'plugin' | 'theme') => {
    // Skip dialog for plugins - handle directly
    if (itemType === 'plugin') {
      handleUpdateItem(itemName, itemType);
      return;
    }
    
    // Show dialog for themes (themes need database info)
    setSelectedUpdateItem({ name: itemName, type: itemType });
    setUpdateFormData({
      dbName: '',
      dbUser: '',
      dbPassword: '',
      domain: ''
    });
    setIsUpdateDialogOpen(true);
  };

  const handleBulkPluginUpdate = async () => {
    if (!selectedConnection || !wpOutdatedStatus?.pluginsOutdated) return;

    // Get all plugins that have updates available
    const outdatedPlugins = Array.isArray(wpOutdatedStatus.pluginsOutdated) ? wpOutdatedStatus.pluginsOutdated : [];

    if (outdatedPlugins.length === 0) {
      toast({
        title: "No updates available",
        description: "All plugins are already up to date.",
      });
      return;
    }

    setIsBulkUpdating(true);

    try {
      // Get authentication from settings
      const settings = apiService.getSettings();
      const { username, password } = settings.defaultAuth || {};
      
      if (!username || !password) {
        toast({
          title: "Authentication required",
          description: "Please configure WordPress credentials in Settings first.",
          variant: "destructive",
        });
        return;
      }

      // Construct base URL
      const baseUrl = selectedConnection.host.startsWith('http') 
        ? selectedConnection.host 
        : `http://${selectedConnection.host}`;

      // Get plugin files/names for bulk update - handle new schema  
      const pluginFiles = outdatedPlugins.map((plugin: any) => plugin.file || plugin.plugin_file || plugin.slug || plugin.name);

      console.log('=== BULK PLUGIN UPDATE REQUEST ===');
      console.log('Plugins to update:', outdatedPlugins.map(p => p.name || p.slug));
      console.log('Plugin files:', pluginFiles);
      console.log('Base URL:', baseUrl);
      console.log('Auth:', { username, password: password ? '[SET]' : '[NOT SET]' });

      // Use the new bulk polling method
      const bulkResult = await apiService.updateAllPluginsWithPolling(
        baseUrl,
        pluginFiles,
        { username, password },
        (status) => {
          toast({
            title: "Bulk Plugin Update",
            description: status,
          });
        }
      );

      console.log('=== BULK PLUGIN UPDATE RESULT ===');
      console.log('Success:', bulkResult.success);
      console.log('Summary:', bulkResult.summary);
      console.log('Results:', bulkResult.results);

      // Show summary toast
      if (bulkResult.success) {
        toast({
          title: "Bulk plugin update completed",
          description: bulkResult.summary,
        });
      } else {
        toast({
          title: "Bulk plugin update failed",
          description: bulkResult.summary,
          variant: "destructive",
        });
      }

      // Refresh status
      refetchOutdated();

    } catch (error) {
      console.error('Bulk plugin update failed:', error);
      
      if (error instanceof Error && error.message.includes('timeout')) {
        toast({
          title: "Update timeout",
          description: "Still running in background; refresh to check status.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Bulk update failed",
          description: `Failed to update plugins: ${error}`,
          variant: "destructive",
        });
      }
    } finally {
      setIsBulkUpdating(false);
    }
  };

  const handleUpdateItem = async (itemName?: string, itemType?: 'plugin' | 'theme') => {
    // Use parameters if provided, otherwise use selected item from dialog
    const name = itemName || selectedUpdateItem?.name;
    const type = itemType || selectedUpdateItem?.type;
    
    if (!selectedConnection || !name || !type) return;
    
    const itemKey = `${type}-${name}`;
    setUpdatingItems(prev => new Set(prev).add(itemKey));
    
    try {
      // Get authentication from settings
      const settings = apiService.getSettings();
      const { username, password } = settings.defaultAuth || {};
      
      if (!username || !password) {
        toast({
          title: "Authentication required",
          description: "Please configure WordPress credentials in Settings first.",
          variant: "destructive",
        });
        return;
      }

      // Construct base URL from connection or form data
      let baseUrl = selectedConnection.host.startsWith('http') 
        ? selectedConnection.host 
        : `http://${selectedConnection.host}`;
      
      // Use domain from form if provided
      if (updateFormData.domain) {
        baseUrl = updateFormData.domain.startsWith('http') 
          ? updateFormData.domain 
          : `http://${updateFormData.domain}`;
      }

      if (itemType === 'plugin') {
        const pluginName = name;

        console.log('=== PLUGIN UPDATE REQUEST (BY NAME) ===');
        console.log('Plugin to update:', pluginName);
        console.log('Base URL:', baseUrl);
        console.log('Auth:', { username, password: password ? '[SET]' : '[NOT SET]' });

        // Enqueue update task with plugin name (not file)
        const enqueueResponse = await apiService.updatePlugins(
          baseUrl,
          [pluginName],
          false,
          [],
          undefined,
          { username, password }
        );

        toast({
          title: "Plugin update queued",
          description: `Task ID: ${enqueueResponse.task_id}`,
        });

        // Track in Task Sidebar
        addTaskToTracker(enqueueResponse.task_id, `Update Plugin: ${pluginName}`, `Updating ${pluginName} via WordPress API`);

        // Poll for completion
        const taskResult = await apiService.pollTaskWithTimeout(enqueueResponse.task_id);
        const res = taskResult.result || {};
        const ok = res.ok === true || res.status_code === 200;

        if (taskResult.state === 'SUCCESS' && ok) {
          toast({
            title: "Plugin updated",
            description: `${pluginName} update complete`,
          });
        } else {
          const detail = res?.response?.status || taskResult.info || 'Update failed';
          toast({
            title: "Plugin update failed",
            description: `${pluginName}: ${detail}`,
            variant: "destructive",
          });
        }

        // Close any dialog if open and refresh status
        setIsUpdateDialogOpen(false);
        refetchOutdated();

      } else {
        // For themes, use the standard method (themes don't have the same complexity)
        const endpoint = '/tasks/wp-update/themes';
        const fullUrl = `${settings.baseUrl}${endpoint}`;
        
        const payload = {
          base_url: baseUrl,
          themes: [itemName],
          auth: { username, password },
        };

        console.log('=== THEME UPDATE REQUEST ===');
        console.log('Theme to update:', itemName);
        console.log('Base URL:', baseUrl);
        console.log('Auth:', { username, password: password ? '[SET]' : '[NOT SET]' });
        console.log('Payload:', payload);
        
        const response = await fetch(fullUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...settings.customHeaders,
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        console.log('=== THEME UPDATE RESPONSE ===');
        console.log('Task ID:', result.task_id);
        console.log('Status:', result.status);
        console.log('Full response:', result);

        // For now, just show success for themes (can be enhanced later)
        toast({
          title: "Theme update queued",
          description: `Task ID: ${result.task_id}`,
        });
        
        // Close dialog and refresh status
        setIsUpdateDialogOpen(false);
        refetchOutdated();
      }
      
    } catch (error) {
      console.error(`Failed to update ${itemType}:`, error);
      
      if (error instanceof Error && error.message.includes('timeout')) {
        toast({
          title: "Update timeout",
          description: "Still running in background; refresh to check status.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Update failed",
          description: `Failed to update ${itemName}: ${error}`,
          variant: "destructive",
        });
      }
    } finally {
      setUpdatingItems(prev => {
        const newSet = new Set(prev);
        newSet.delete(itemKey);
        return newSet;
      });
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">WordPress Status</h1>
          <p className="text-muted-foreground">Monitor your WordPress site health and security</p>
        </div>
        
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="auto-refresh"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="auto-refresh" className="text-sm">Auto-refresh</label>
          </div>
          
          <Button 
            variant="outline" 
            onClick={handleRefreshAll}
            disabled={!selectedSite || outdatedLoading || sslLoading || domainLoading}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${(outdatedLoading || sslLoading || domainLoading) ? 'animate-spin' : ''}`} />
            Refresh Status
          </Button>
        </div>
      </div>

      {/* Site Selection */}
      <Card className="dashboard-card">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Server className="w-5 h-5" />
            <span>Select Site</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {savedConnections.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Server className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No site connections available</p>
              <p className="text-sm">Please add a server connection first in the Connections page</p>
            </div>
          ) : (
            <div className="space-y-2">
              <Select value={selectedSite} onValueChange={setSelectedSite}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a site to monitor" />
                </SelectTrigger>
                <SelectContent>
                  {savedConnections.map((connection: any) => (
                    <SelectItem key={connection.id} value={connection.id}>
                      <div className="flex items-center space-x-2">
                        <span className="font-medium">{connection.name}</span>
                        <span className="text-muted-foreground">
                          ({connection.user}@{connection.host})
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedSite && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-8"
        >
          {/* Status Overview */}
          <div className="grid md:grid-cols-3 gap-6">
            {/* WordPress Core */}
            <Card className="dashboard-card">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center space-x-2 text-lg">
                  <Shield className="w-5 h-5" />
                  <span>WordPress Core</span>
                </CardTitle>
                <p className="text-sm text-muted-foreground">Current installation status</p>
              </CardHeader>
              <CardContent className="space-y-3">
                {outdatedLoading ? (
                  <div className="animate-pulse space-y-2">
                    <div className="h-4 bg-muted rounded w-3/4"></div>
                    <div className="h-4 bg-muted rounded w-1/2"></div>
                  </div>
                ) : wpOutdatedStatus?.core ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Current Version:</span>
                      <span className="font-medium">{wpOutdatedStatus.core.current_version || "Unknown"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Latest Version:</span>
                      <span className="font-medium">{wpOutdatedStatus.core.latest_version || "N/A"}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Status:</span>
                      {(wpOutdatedStatus.core.update_available ? (
                        <Badge variant="outline" className="bg-warning/10 text-warning border-warning">
                          Up to date
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-success/10 text-success border-success">
                          Update available
                        </Badge>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex items-center space-x-2 text-muted-foreground">
                    <AlertTriangle className="w-4 h-4" />
                    <span className="text-sm">WordPress core information not available</span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* SSL Certificate */}
            <Card className="dashboard-card">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center space-x-2 text-lg">
                  <Lock className="w-5 h-5" />
                  <span>SSL Certificate</span>
                </CardTitle>
                <p className="text-sm text-muted-foreground">Security certificate status</p>
              </CardHeader>
              <CardContent className="space-y-3">
                {sslLoading ? (
                  <div className="animate-pulse space-y-2">
                    <div className="h-4 bg-muted rounded w-3/4"></div>
                    <div className="h-4 bg-muted rounded w-1/2"></div>
                  </div>
                 ) : sslStatus ? (
                   <>
                     <div className="flex justify-between items-center">
                       <span className="text-sm text-muted-foreground">Status:</span>
                       <Badge variant="outline" className="bg-success/10 text-success border-success">
                         ✓ Valid
                       </Badge>
                     </div>
                     <div className="flex justify-between">
                       <span className="text-sm text-muted-foreground">Expires In:</span>
                       <span className="font-medium">{sslStatus.expiresIn} days</span>
                     </div>
                     <div className="flex justify-between">
                       <span className="text-sm text-muted-foreground">Issuer:</span>
                       <span className="font-medium text-sm">{sslStatus.issuer}</span>
                     </div>
                     <div className="space-y-1">
                       <div className="flex justify-between text-sm">
                         <span className="text-muted-foreground">Expiry Progress</span>
                         <span>{sslStatus.expiryProgress}%</span>
                       </div>
                       <Progress value={sslStatus.expiryProgress} className="h-2" />
                     </div>
                   </>
                 ) : (
                   <div className="flex items-center space-x-2 text-destructive">
                     <AlertTriangle className="w-4 h-4" />
                     <span className="text-sm">SSL information not found</span>
                   </div>
                 )}
              </CardContent>
            </Card>

            {/* Domain Information */}
            <Card className="dashboard-card">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center space-x-2 text-lg">
                  <Globe className="w-5 h-5" />
                  <span>Domain Information</span>
                </CardTitle>
                <p className="text-sm text-muted-foreground">Registration and DNS details</p>
              </CardHeader>
              <CardContent className="space-y-3">
                {domainLoading ? (
                  <div className="animate-pulse space-y-2">
                    <div className="h-4 bg-muted rounded w-3/4"></div>
                    <div className="h-4 bg-muted rounded w-1/2"></div>
                  </div>
                 ) : domainInfo ? (
                   <>
                     <div className="flex justify-between">
                       <span className="text-sm text-muted-foreground">Domain:</span>
                       <span className="font-medium">{domainInfo.domain}</span>
                     </div>
                     <div className="flex justify-between">
                       <span className="text-sm text-muted-foreground">Registrar:</span>
                       <span className="font-medium">{domainInfo.registrar}</span>
                     </div>
                     <div className="flex justify-between">
                       <span className="text-sm text-muted-foreground">Expires In:</span>
                       <span className="font-medium">{domainInfo.expiresIn} days</span>
                     </div>
                     <div className="space-y-1">
                       <span className="text-sm text-muted-foreground">Nameservers:</span>
                       <div className="text-xs space-y-1">
                         {domainInfo.nameservers.map((ns, index) => (
                           <div key={index} className="font-mono bg-muted px-2 py-1 rounded">
                             {ns}
                           </div>
                         ))}
                       </div>
                     </div>
                   </>
                 ) : (
                   <div className="flex items-center space-x-2 text-destructive">
                     <AlertTriangle className="w-4 h-4" />
                     <span className="text-sm">Domain information not found</span>
                   </div>
                 )}
              </CardContent>
            </Card>
          </div>

          {/* Plugins & Themes */}
          {wpOutdatedStatus && (
            <Card className="dashboard-card">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Zap className="w-5 h-5" />
                   <span>Plugins & Themes</span>
                   {wpOutdatedStatus && (
                     <Badge variant="outline" className="ml-2">
                        {(Array.isArray(wpOutdatedStatus?.pluginsOutdated) ? wpOutdatedStatus.pluginsOutdated.length : 0) + 
                         (Array.isArray(wpOutdatedStatus?.themesOutdated) ? wpOutdatedStatus.themesOutdated.length : 0)} updates available
                     </Badge>
                   )}
                  {outdatedLoading && (
                    <Badge variant="outline" className="ml-2 animate-pulse">
                      Checking...
                    </Badge>
                  )}
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  REST API status check - Installed plugins and themes with version information
                </p>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="plugins" className="space-y-4">
                  <TabsList>
                   <TabsTrigger value="plugins">Plugins</TabsTrigger>
                    <TabsTrigger value="themes">Themes</TabsTrigger>
                  </TabsList>
                  <div className="flex justify-end mb-4">
                     <Button
                       onClick={handleBulkPluginUpdate}
                       disabled={isBulkUpdating || !(Array.isArray(wpOutdatedStatus?.pluginsOutdated) && wpOutdatedStatus.pluginsOutdated.length > 0)}
                       className="h-9"
                     >
                      {isBulkUpdating ? (
                        <>
                          <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                          Updating All...
                        </>
                      ) : (
                        'Update All Plugins'
                      )}
                    </Button>
                  </div>
                  <TabsList className="hidden">
                  </TabsList>

                  <TabsContent value="plugins">
                    <ScrollArea className="h-80">
                       <div className="space-y-2">
                         <div className="grid grid-cols-6 gap-4 p-3 bg-muted/50 rounded-lg text-sm font-medium">
                           <div>Name</div>
                           <div>Status</div>
                           <div>Current Version</div>
                           <div>Latest Version</div>
                           <div>Update Status</div>
                           <div>Actions</div>
                         </div>
                           {(Array.isArray(wpOutdatedStatus?.pluginsAll) ? wpOutdatedStatus.pluginsAll : []).map((plugin: any, index: number) => {
                             // Check if this plugin has an update available
                             const hasUpdate = wpOutdatedStatus.pluginsOutdated?.some((p: any) => 
                               (p.name === plugin.name) || (p.slug === plugin.slug) || (p.file === plugin.file)
                             ) || plugin.has_update === true;
                             const pluginKey = `plugin-${plugin.name || plugin.slug}`;
                             const isUpdating = updatingItems.has(pluginKey);
                            
                            return (
                            <div key={index} className="grid grid-cols-6 gap-4 p-3 border rounded-lg items-center">
                             <div className="font-medium">{plugin.name || plugin.slug}</div>
                             <div>
                               <Badge variant={plugin.active ? 'default' : 'secondary'}>
                                 {plugin.active ? 'Active' : 'Inactive'}
                               </Badge>
                             </div>
                             <div className="font-mono text-sm">{plugin.installed || plugin.current || 'N/A'}</div>
                             <div className="font-mono text-sm">{plugin.available || plugin.latest || 'N/A'}</div>
                              <div>
                                {hasUpdate ? (
                                  <Badge variant="outline" className="bg-warning/10 text-warning border-warning">
                                    Update Available
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="bg-success/10 text-success border-success">
                                    Up-to-date
                                  </Badge>
                                )}
                              </div>
                              <div>
                                {hasUpdate && (
                                   <Button
                                     size="sm"
                                     variant="outline"
                                     onClick={() => openUpdateDialog(plugin.name || plugin.slug, 'plugin')}
                                     disabled={isUpdating || isBulkUpdating}
                                     className="h-8"
                                   >
                                    {isUpdating ? (
                                      <>
                                        <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                                        Updating...
                                      </>
                                    ) : (
                                      'Update'
                                    )}
                                  </Button>
                                )}
                              </div>
                            </div>
                             );
                           })}
                          {(!Array.isArray(wpOutdatedStatus?.pluginsAll) || wpOutdatedStatus.pluginsAll.length === 0) && (
                           <div className="text-center py-4 text-muted-foreground">
                             No plugin information available
                           </div>
                         )}
                      </div>
                    </ScrollArea>
                  </TabsContent>

                  <TabsContent value="themes">
                    <ScrollArea className="h-80">
                       <div className="space-y-2">
                         <div className="grid grid-cols-6 gap-4 p-3 bg-muted/50 rounded-lg text-sm font-medium">
                           <div>Name</div>
                           <div>Status</div>
                           <div>Current Version</div>
                           <div>Latest Version</div>
                           <div>Update Status</div>
                           <div>Actions</div>
                         </div>
                           {(Array.isArray(wpOutdatedStatus?.themesAll) ? wpOutdatedStatus.themesAll : []).map((theme: any, index: number) => {
                             // Check if this theme has an update available
                             const hasUpdate = wpOutdatedStatus.themesOutdated?.some((t: any) => 
                               (t.name === theme.name) || (t.slug === theme.slug) || (t.stylesheet === theme.stylesheet)
                             ) || theme.has_update === true;
                             const themeKey = `theme-${theme.name || theme.slug}`;
                             const isUpdating = updatingItems.has(themeKey);
                            
                            return (
                            <div key={index} className="grid grid-cols-6 gap-4 p-3 border rounded-lg items-center">
                             <div className="font-medium">{theme.name || theme.slug}</div>
                             <div>
                               <Badge variant={theme.active ? 'default' : 'secondary'}>
                                 {theme.active ? 'Active' : 'Inactive'}
                               </Badge>
                             </div>
                             <div className="font-mono text-sm">{theme.installed || theme.current || 'N/A'}</div>
                             <div className="font-mono text-sm">{theme.available || theme.latest || 'N/A'}</div>
                              <div>
                                {hasUpdate ? (
                                  <Badge variant="outline" className="bg-warning/10 text-warning border-warning">
                                    Update Available
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="bg-success/10 text-success border-success">
                                    Up-to-date
                                  </Badge>
                                )}
                              </div>
                              <div>
                                {hasUpdate && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => openUpdateDialog(theme.name || theme.slug, 'theme')}
                                    disabled={isUpdating}
                                    className="h-8"
                                  >
                                    {isUpdating ? (
                                      <>
                                        <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                                        Updating...
                                      </>
                                    ) : (
                                      'Update'
                                    )}
                                  </Button>
                                )}
                              </div>
                            </div>
                             );
                           })}
                          {(!Array.isArray(wpOutdatedStatus?.themesAll) || wpOutdatedStatus.themesAll.length === 0) && (
                           <div className="text-center py-4 text-muted-foreground">
                             No theme information available
                           </div>
                         )}
                      </div>
                    </ScrollArea>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          )}
        </motion.div>
      )}

      {/* Plugin Debug Panel */}
      {(debugInfo.normalization || debugInfo.attempts || debugInfo.taskResult) && (
        <PluginDebugPanel
          debugInfo={debugInfo.normalization}
          attempts={debugInfo.attempts}
          taskResult={debugInfo.taskResult}
        />
      )}

      {/* Update Dialog */}
      <Dialog open={isUpdateDialogOpen} onOpenChange={setIsUpdateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Update {selectedUpdateItem?.type}: {selectedUpdateItem?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="dbName">Database Name</Label>
              <Input
                id="dbName"
                placeholder="Enter database name"
                value={updateFormData.dbName}
                onChange={(e) => setUpdateFormData({ ...updateFormData, dbName: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dbUser">Database User</Label>
              <Input
                id="dbUser"
                placeholder="Enter database username"
                value={updateFormData.dbUser}
                onChange={(e) => setUpdateFormData({ ...updateFormData, dbUser: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dbPassword">Database Password</Label>
              <Input
                id="dbPassword"
                type="password"
                placeholder="Enter database password"
                value={updateFormData.dbPassword}
                onChange={(e) => setUpdateFormData({ ...updateFormData, dbPassword: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="domain">Domain (optional)</Label>
              <Input
                id="domain"
                placeholder="https://example.com (optional)"
                value={updateFormData.domain}
                onChange={(e) => setUpdateFormData({ ...updateFormData, domain: e.target.value })}
              />
            </div>
            <div className="flex justify-end space-x-2 pt-4">
              <Button
                variant="outline"
                onClick={() => setIsUpdateDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={() => handleUpdateItem()}
                disabled={!updateFormData.dbName || !updateFormData.dbUser || !updateFormData.dbPassword}
              >
                Start Update
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
