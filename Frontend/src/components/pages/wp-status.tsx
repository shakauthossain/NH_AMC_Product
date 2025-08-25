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
// console.log('Starting WP Outdated check...');
      // console.log("selectedSite", selectedSite);
      // console.log("selectedConnection", selectedConnection);
      if (!selectedSite || !selectedConnection) return null;
      
      const domain = selectedConnection.host
      // ?.includes('.') 
      //   ? selectedConnection.name 
      //   : selectedConnection.host;
// console.log("domain", domain);
      // Try to construct a proper WP REST API URL
      const baseUrl = domain.startsWith('http') ? domain : `http://${domain}`;
      // console.log("baseUrl", baseUrl);
      const restUrl = `${baseUrl}/wp-json/custom/v1/status`;
      // console.log("restUrl", restUrl);
      
      try {
        const outdatedResponse = await apiService.wpOutdatedFetch(restUrl);
// console.log("outdatedResponse", outdatedResponse);
        const result = await apiService.pollTask(outdatedResponse.task_id);
        // console.log("WP Outdated task result:", result);
        
        if (result.state === 'SUCCESS' && result.result) {
// console.log("WP Outdated data structure:", {
            // plugins: result.result.raw.plugins,
            // themes: result.result.raw.themes,
            // core: result.result.raw.core
          // });
          return {
            plugins: result.result.raw.plugins || [],
            themes: result.result.raw.themes || [],
            core: result.result.raw.core || {}
          };
        }
        
        // console.log("WP Outdated task failed or no result:", result);
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
    if (!selectedConnection || !wpOutdatedStatus?.plugins) return;

    // Get all plugins that have updates available
    const outdatedPlugins = wpOutdatedStatus.plugins.filter((plugin: any) => 
      plugin.updateAvailable || plugin.update_available
    );

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

      // Get plugin files for bulk update
      const pluginFiles = outdatedPlugins.map((plugin: any) => plugin.plugin_file);

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
        // Find the plugin in the available plugins list to get its plugin_file
        const targetPlugin = wpOutdatedStatus?.plugins?.find((p: any) => 
          p.name === itemName || p.slug === itemName
        );

        if (!targetPlugin) {
          throw new Error(`Plugin "${itemName}" not found in available plugins`);
        }

        const pluginFile = targetPlugin.plugin_file;
        
        console.log('=== PLUGIN UPDATE REQUEST ===');
        console.log('Plugin to update:', itemName);
        console.log('Plugin file:', pluginFile);
        console.log('Base URL:', baseUrl);
        console.log('Auth:', { username, password: password ? '[SET]' : '[NOT SET]' });

        // Use the new polling method for proper verification
        const updateResult = await apiService.updatePluginWithPolling(
          baseUrl,
          pluginFile,
          { username, password },
          (status) => {
            // Update toast to show progress
            toast({
              title: "Plugin Update",
              description: status,
            });
          }
        );

        console.log('=== PLUGIN UPDATE RESULT ===');
        console.log('Success:', updateResult.success);
        console.log('Updated:', updateResult.updated);
        console.log('Message:', updateResult.message);
        console.log('Details:', updateResult.details);

        // Show result toast
        if (updateResult.success && updateResult.updated) {
          toast({
            title: "Plugin updated",
            description: `${itemName} is now up to date.`,
          });
        } else if (updateResult.success && !updateResult.updated) {
          toast({
            title: "Plugin update failed",
            description: `${itemName} did not update. ${updateResult.details || ''}`,
            variant: "destructive",
          });
        } else {
          // Handle auth failures specifically
          if (updateResult.details?.includes('401') || updateResult.details?.toLowerCase().includes('auth')) {
            toast({
              title: "Auth failed on WordPress",
              description: "Check username/password in Settings.",
              variant: "destructive",
            });
          } else {
            toast({
              title: "Plugin update failed",
              description: updateResult.details || updateResult.message,
              variant: "destructive",
            });
          }
        }

        // Close dialog if it was open and refresh status
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
                      {wpOutdatedStatus.core.update_available ? (
                        <Badge variant="outline" className="bg-warning/10 text-warning border-warning">
                          Update available
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-success/10 text-success border-success">
                          Up to date
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
                      {(wpOutdatedStatus?.plugins || []).filter((p: any) => p.updateAvailable || p.update_available).length + 
                       (wpOutdatedStatus?.themes || []).filter((t: any) => t.updateAvailable || t.update_available).length} updates available
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
                      disabled={isBulkUpdating || !wpOutdatedStatus?.plugins?.some((p: any) => p.updateAvailable || p.update_available)}
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
                         {((wpOutdatedStatus?.plugins || []) as any[]).map((plugin: any, index: number) => {
                           const hasUpdate = plugin.updateAvailable || plugin.update_available;
                           const pluginKey = `plugin-${plugin.name || plugin.slug}`;
                           const isUpdating = updatingItems.has(pluginKey);
                           
                           return (
                           <div key={index} className="grid grid-cols-6 gap-4 p-3 border rounded-lg items-center">
                            <div className="font-medium">{plugin.name || plugin.slug}</div>
                            <div>
                              <Badge variant={(plugin.status || plugin.active) === 'Active' || plugin.active ? 'default' : 'secondary'}>
                                {plugin.status || (plugin.active ? 'Active' : 'Inactive')}
                              </Badge>
                            </div>
                            <div className="font-mono text-sm">{plugin.currentVersion || plugin.current_version || plugin.version}</div>
                            <div className="font-mono text-sm">{plugin.latestVersion || plugin.latest_version || plugin.new_version || 'N/A'}</div>
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
                         {(wpOutdatedStatus?.plugins || []).length === 0 && (
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
                         {((wpOutdatedStatus?.themes || []) as any[]).map((theme: any, index: number) => {
                           const hasUpdate = theme.updateAvailable || theme.update_available;
                           const themeKey = `theme-${theme.name || theme.slug}`;
                           const isUpdating = updatingItems.has(themeKey);
                           
                           return (
                           <div key={index} className="grid grid-cols-6 gap-4 p-3 border rounded-lg items-center">
                            <div className="font-medium">{theme.name || theme.slug}</div>
                            <div>
                              <Badge variant={(theme.status || theme.active) === 'Active' || theme.active ? 'default' : 'secondary'}>
                                {theme.status || (theme.active ? 'Active' : 'Inactive')}
                              </Badge>
                            </div>
                            <div className="font-mono text-sm">{theme.currentVersion || theme.current_version || theme.version}</div>
                            <div className="font-mono text-sm">{theme.latestVersion || theme.latest_version || theme.new_version || 'N/A'}</div>
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
                         {(wpOutdatedStatus?.themes || []).length === 0 && (
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
