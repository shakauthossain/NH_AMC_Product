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
import { useToast } from "@/hooks/use-toast";
import { apiService } from "@/lib/api";
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

  // WordPress Status using real API
  const { data: wpStatus, refetch: refetchWpStatus, isLoading: wpLoading } = useQuery({
    queryKey: ['wp-status', selectedSite],
    queryFn: async () => {
      if (!selectedSite || !selectedConnection) return null;
      
      const siteConfig = {
        host: selectedConnection.host,
        user: selectedConnection.user,
        password: selectedConnection.password,
        wp_path: selectedConnection.wp_path || "/var/www/html",
        db_name: selectedConnection.db_name || "",
        db_user: selectedConnection.db_user || "",
        db_pass: selectedConnection.db_pass || "",
        key_filename: selectedConnection.key_filename,
        private_key_pem: selectedConnection.private_key_pem,
      };

      try {
        const statusResponse = await apiService.getWpStatus(siteConfig);
        // Poll for the task result
        const result = await apiService.pollTask(statusResponse.task_id);
        
        if (result.state === 'SUCCESS' && result.result) {
          return {
            version: result.result.wp_version || "Unknown",
            latestVersion: result.result.latest_wp_version || "Unknown",
            updateAvailable: result.result.wp_update_available || false,
            lastUpdated: result.result.last_updated || "Unknown",
            plugins: result.result.plugins || [],
            themes: result.result.themes || []
          } as WordPressStatus;
        }
        
        return null;
      } catch (error) {
        console.error('WordPress status check failed:', error);
        return null;
      }
    },
    enabled: !!selectedSite && !!selectedConnection,
    refetchInterval: autoRefresh ? 30000 : false,
    retry: false,
  });

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

  const handleRefreshAll = () => {
    refetchWpStatus();
    refetchSSL();
    refetchDomain();
    toast({
      title: "Refreshing status",
      description: "Updating all status information...",
    });
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
            disabled={!selectedSite || wpLoading || sslLoading || domainLoading}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${(wpLoading || sslLoading || domainLoading) ? 'animate-spin' : ''}`} />
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
                {wpLoading ? (
                  <div className="animate-pulse space-y-2">
                    <div className="h-4 bg-muted rounded w-3/4"></div>
                    <div className="h-4 bg-muted rounded w-1/2"></div>
                  </div>
                ) : wpStatus ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Current Version:</span>
                      <span className="font-medium">{wpStatus.version}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Latest Version:</span>
                      <span className="font-medium">{wpStatus.latestVersion}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Status:</span>
                      {wpStatus.updateAvailable ? (
                        <Badge variant="outline" className="bg-warning/10 text-warning border-warning">
                          Update available: {wpStatus.version} → {wpStatus.latestVersion}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-success/10 text-success border-success">
                          Up to date
                        </Badge>
                      )}
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Last Updated:</span>
                      <span className="font-medium">{wpStatus.lastUpdated}</span>
                    </div>
                  </>
                ) : null}
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
                ) : null}
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
                ) : null}
              </CardContent>
            </Card>
          </div>

          {/* Plugins & Themes */}
          {wpStatus && (
            <Card className="dashboard-card">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Zap className="w-5 h-5" />
                  <span>Plugins & Themes</span>
                  <Badge variant="outline" className="ml-2">
                    {wpStatus.plugins.filter(p => p.updateAvailable).length + wpStatus.themes.filter(t => t.updateAvailable).length} updates available
                  </Badge>
                </CardTitle>
                <p className="text-sm text-muted-foreground">Installed plugins and themes with version information</p>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="plugins" className="space-y-4">
                  <TabsList>
                    <TabsTrigger value="plugins">Plugins</TabsTrigger>
                    <TabsTrigger value="themes">Themes</TabsTrigger>
                  </TabsList>

                  <TabsContent value="plugins">
                    <ScrollArea className="h-80">
                      <div className="space-y-2">
                        <div className="grid grid-cols-5 gap-4 p-3 bg-muted/50 rounded-lg text-sm font-medium">
                          <div>Name</div>
                          <div>Status</div>
                          <div>Current Version</div>
                          <div>Latest Version</div>
                          <div>Status</div>
                        </div>
                        {wpStatus.plugins.map((plugin, index) => (
                          <div key={index} className="grid grid-cols-5 gap-4 p-3 border rounded-lg items-center">
                            <div className="font-medium">{plugin.name}</div>
                            <div>
                              <Badge variant={plugin.status === 'Active' ? 'default' : 'secondary'}>
                                {plugin.status}
                              </Badge>
                            </div>
                            <div className="font-mono text-sm">{plugin.currentVersion}</div>
                            <div className="font-mono text-sm">{plugin.latestVersion}</div>
                            <div>
                              {plugin.updateAvailable ? (
                                <Badge variant="outline" className="bg-warning/10 text-warning border-warning">
                                  Update Available
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="bg-success/10 text-success border-success">
                                  Up-to-date
                                </Badge>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </TabsContent>

                  <TabsContent value="themes">
                    <ScrollArea className="h-80">
                      <div className="space-y-2">
                        <div className="grid grid-cols-5 gap-4 p-3 bg-muted/50 rounded-lg text-sm font-medium">
                          <div>Name</div>
                          <div>Status</div>
                          <div>Current Version</div>
                          <div>Latest Version</div>
                          <div>Status</div>
                        </div>
                        {wpStatus.themes.map((theme, index) => (
                          <div key={index} className="grid grid-cols-5 gap-4 p-3 border rounded-lg items-center">
                            <div className="font-medium">{theme.name}</div>
                            <div>
                              <Badge variant={theme.status === 'Active' ? 'default' : 'secondary'}>
                                {theme.status}
                              </Badge>
                            </div>
                            <div className="font-mono text-sm">{theme.currentVersion}</div>
                            <div className="font-mono text-sm">{theme.latestVersion}</div>
                            <div>
                              {theme.updateAvailable ? (
                                <Badge variant="outline" className="bg-warning/10 text-warning border-warning">
                                  Update Available
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="bg-success/10 text-success border-success">
                                  Up-to-date
                                </Badge>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          )}
        </motion.div>
      )}
    </div>
  );
}