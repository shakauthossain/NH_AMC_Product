import { useState } from "react";
import { motion } from "framer-motion";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiService, SiteConfig } from "@/lib/api";
import { useTaskTracker } from "../layout/task-sidebar";
import { 
  Activity, 
  Download, 
  RefreshCw, 
  Shield, 
  Eye, 
  Database,
  FolderOpen,
  AlertTriangle,
  Server
} from "lucide-react";

interface SavedConnection {
  id: string;
  name: string;
  host: string;
  user: string;
  wp_path: string;
  password?: string;
  key_filename?: string;
  private_key_pem?: string;
}

export function OperationsPage() {
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>("");
  const [siteConfig, setSiteConfig] = useState<SiteConfig>({
    host: "",
    user: "",
    password: "",
    wp_path: "/var/www/html",
    db_name: "",
    db_user: "",
    db_pass: "",
    key_filename: null,
    private_key_pem: null,
  });

  const [healthCheckConfig, setHealthCheckConfig] = useState({
    url: "",
    keyword: "",
    screenshot: true,
    outPath: "/tmp/screenshot.png",
  });

  const [updateConfig, setUpdateConfig] = useState({
    baseUrl: "",
    username: "",
    password: "",
    includePlugins: true,
    includeCore: true,
    reportEmail: "",
  });

  const [backupConfig, setBackupConfig] = useState({
    download: false,
    outDir: "/tmp/backups",
    filename: "",
  });

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

  // Update siteConfig when connection is selected
  const handleConnectionChange = (connectionId: string) => {
    setSelectedConnectionId(connectionId);
    const connection = savedConnections.find((conn: SavedConnection) => conn.id === connectionId);
    if (connection) {
      setSiteConfig({
        host: connection.host,
        user: connection.user,
        password: connection.password || "",
        wp_path: connection.wp_path,
        db_name: siteConfig.db_name,
        db_user: siteConfig.db_user,
        db_pass: siteConfig.db_pass,
        key_filename: connection.key_filename || null,
        private_key_pem: connection.private_key_pem || null,
      });
    }
  };

  const wpStatusMutation = useMutation({
    mutationFn: () => apiService.getWpStatus(siteConfig),
    onSuccess: (data) => {
      toast({
        title: "WordPress status check queued",
        description: `Task ID: ${data.task_id}`,
      });
      addTaskToTracker(data.task_id, "WordPress Status Check", "Analyzing WordPress core, plugins, themes, and system health");
    },
  });

  const backupMutation = useMutation({
    mutationFn: () => apiService.createBackup(siteConfig),
    onSuccess: (data) => {
      toast({
        title: "Backup queued",
        description: `Task ID: ${data.task_id}`,
      });
      addTaskToTracker(data.task_id, "Full Backup", "Compressing database, archiving wp-content, and securing backup files");
    },
  });

  const backupDbMutation = useMutation({
    mutationFn: () => apiService.backupDb({ ...siteConfig, ...backupConfig }),
    onSuccess: (data) => {
      if ('downloaded' in data) {
        toast({
          title: "Database backup downloaded",
          description: `File: ${data.filename}`,
        });
      } else {
        toast({
          title: "Database backup queued",
          description: `Task ID: ${data.task_id}`,
        });
        addTaskToTracker(data.task_id, "Database Backup", "Exporting MySQL tables, compressing SQL dump, and preparing download");
      }
    },
  });

  const backupContentMutation = useMutation({
    mutationFn: () => apiService.backupContent({ ...siteConfig, ...backupConfig }),
    onSuccess: (data) => {
      if ('downloaded' in data) {
        toast({
          title: "Content backup downloaded",
          description: `File: ${data.filename}`,
        });
      } else {
        toast({
          title: "Content backup queued",
          description: `Task ID: ${data.task_id}`,
        });
        addTaskToTracker(data.task_id, "Content Backup", "Archiving themes, plugins, uploads, and media files");
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: () => apiService.updateAll(
      updateConfig.baseUrl,
      updateConfig.includePlugins,
      updateConfig.includeCore,
      true,
      [],
      undefined,
      { username: updateConfig.username, password: updateConfig.password },
      updateConfig.reportEmail || undefined
    ),
    onSuccess: (data) => {
      toast({
        title: "WordPress update queued",
        description: `Task ID: ${data.task_id}`,
      });
      addTaskToTracker(data.task_id, "WordPress Update", `Creating backup, updating ${updateConfig.includeCore ? 'WordPress core' : ''}${updateConfig.includeCore && updateConfig.includePlugins ? ' and ' : ''}${updateConfig.includePlugins ? 'plugins' : ''}, testing compatibility`);
    },
  });

  const healthCheckMutation = useMutation({
    mutationFn: () => apiService.healthCheck(
      healthCheckConfig.url,
      healthCheckConfig.keyword,
      healthCheckConfig.screenshot,
      healthCheckConfig.outPath,
      siteConfig
    ),
    onSuccess: (data) => {
      toast({
        title: "Health check queued",
        description: `Task ID: ${data.task_id}`,
      });
      addTaskToTracker(data.task_id, "Health Check", `Loading page, searching for content, capturing screenshot, analyzing response time`);
    },
  });

  const sslCheckMutation = useMutation({
    mutationFn: (domain: string) => apiService.domainSslCollect(domain),
    onSuccess: (data, domain) => {
      toast({
        title: "SSL check queued",
        description: `Task ID: ${data.task_id}`,
      });
      addTaskToTracker(data.task_id, "SSL Check", `Analyzing certificate chain, checking expiry date, validating domain ownership`);
    },
  });

  const [resetConfig, setResetConfig] = useState({
    domain: "",
    purgeStack: true,
    resetUfw: true,
    force: true,
    reportPath: "/tmp/wp_rollback_report.json",
  });

  const resetMutation = useMutation({
    mutationFn: () => apiService.hardReset(
      siteConfig.wp_path || "/var/www/html",
      resetConfig.domain,
      siteConfig,
      {
        purgeStack: resetConfig.purgeStack,
        resetUfw: resetConfig.resetUfw,
        force: resetConfig.force,
        reportPath: resetConfig.reportPath,
      }
    ),
    onSuccess: (data) => {
      toast({
        title: "WordPress reset queued",
        description: `Task ID: ${data.task_id}`,
      });
      addTaskToTracker(data.task_id, "WordPress Reset", `Stopping services, purging files, resetting database, cleaning configurations`);
    },
  });

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Operations</h1>
        <p className="text-muted-foreground">WordPress maintenance and monitoring operations</p>
      </div>

      <Tabs defaultValue="status" className="space-y-6">
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="status">Status</TabsTrigger>
          <TabsTrigger value="backup">Backup</TabsTrigger>
          <TabsTrigger value="update">Update</TabsTrigger>
          <TabsTrigger value="health">Health</TabsTrigger>
          <TabsTrigger value="ssl">SSL</TabsTrigger>
          <TabsTrigger value="reset">Reset</TabsTrigger>
        </TabsList>

        {/* Server Connection Selection */}
        <Card className="dashboard-card">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Server className="w-5 h-5" />
              <span>Server Connection</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {savedConnections.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Server className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No server connections available</p>
                <p className="text-sm">Please add a server connection first in the Connections page</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="connection">Select Connection</Label>
                  <Select value={selectedConnectionId} onValueChange={handleConnectionChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a saved connection" />
                    </SelectTrigger>
                    <SelectContent>
                      {savedConnections.map((connection: SavedConnection) => (
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
                
                {selectedConnectionId && (
                  <div className="grid grid-cols-3 gap-4 pt-4 border-t">
                    <div className="space-y-2">
                      <Label htmlFor="db_name">DB Name</Label>
                      <Input
                        id="db_name"
                        placeholder="wp_db"
                        value={siteConfig.db_name}
                        onChange={(e) => setSiteConfig({ ...siteConfig, db_name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="db_user">DB User</Label>
                      <Input
                        id="db_user"
                        placeholder="wp_user"
                        value={siteConfig.db_user}
                        onChange={(e) => setSiteConfig({ ...siteConfig, db_user: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="db_pass">DB Password</Label>
                      <Input
                        id="db_pass"
                        type="password"
                        value={siteConfig.db_pass}
                        onChange={(e) => setSiteConfig({ ...siteConfig, db_pass: e.target.value })}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <TabsContent value="status" className="space-y-6">
          <Card className="dashboard-card">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Activity className="w-5 h-5" />
                <span>WordPress Status Check</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground mb-4">
                Check WordPress installation status, version, and plugin information
              </p>
                <Button
                  onClick={() => wpStatusMutation.mutate()}
                  disabled={wpStatusMutation.isPending || !selectedConnectionId}
                  className="btn-primary"
                >
                  {wpStatusMutation.isPending ? "Checking..." : "Check WordPress Status"}
                </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="backup" className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            <Card className="dashboard-card">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Database className="w-5 h-5" />
                  <span>Database Backup</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Switch
                    checked={backupConfig.download}
                    onCheckedChange={(checked) => setBackupConfig({ ...backupConfig, download: checked })}
                  />
                  <Label>Download immediately</Label>
                </div>
                <Button
                  onClick={() => backupDbMutation.mutate()}
                  disabled={backupDbMutation.isPending || !selectedConnectionId}
                  className="w-full"
                >
                  {backupDbMutation.isPending ? "Creating..." : "Backup Database"}
                </Button>
              </CardContent>
            </Card>

            <Card className="dashboard-card">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <FolderOpen className="w-5 h-5" />
                  <span>Content Backup</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Switch
                    checked={backupConfig.download}
                    onCheckedChange={(checked) => setBackupConfig({ ...backupConfig, download: checked })}
                  />
                  <Label>Download immediately</Label>
                </div>
                <Button
                  onClick={() => backupContentMutation.mutate()}
                  disabled={backupContentMutation.isPending || !selectedConnectionId}
                  className="w-full"
                >
                  {backupContentMutation.isPending ? "Creating..." : "Backup wp-content"}
                </Button>
              </CardContent>
            </Card>
          </div>

          <Card className="dashboard-card">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Download className="w-5 h-5" />
                <span>Full Backup (Legacy)</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground mb-4">
                Create a complete backup of database and wp-content together
              </p>
              <Button
                onClick={() => backupMutation.mutate()}
                disabled={backupMutation.isPending || !selectedConnectionId}
                className="btn-primary"
              >
                {backupMutation.isPending ? "Creating..." : "Create Full Backup"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="update" className="space-y-6">
          <Card className="dashboard-card">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <RefreshCw className="w-5 h-5" />
                <span>WordPress Updates</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="baseUrl">Base URL</Label>
                  <Input
                    id="baseUrl"
                    placeholder="https://example.com"
                    value={updateConfig.baseUrl}
                    onChange={(e) => setUpdateConfig({ ...updateConfig, baseUrl: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reportEmail">Report Email (optional)</Label>
                  <Input
                    id="reportEmail"
                    type="email"
                    placeholder="admin@example.com"
                    value={updateConfig.reportEmail}
                    onChange={(e) => setUpdateConfig({ ...updateConfig, reportEmail: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="updateUsername">WordPress Admin Username</Label>
                  <Input
                    id="updateUsername"
                    placeholder="admin"
                    value={updateConfig.username}
                    onChange={(e) => setUpdateConfig({ ...updateConfig, username: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="updatePassword">WordPress Admin Password</Label>
                  <Input
                    id="updatePassword"
                    type="password"
                    value={updateConfig.password}
                    onChange={(e) => setUpdateConfig({ ...updateConfig, password: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex space-x-6">
                <div className="flex items-center space-x-2">
                  <Switch
                    checked={updateConfig.includePlugins}
                    onCheckedChange={(checked) => setUpdateConfig({ ...updateConfig, includePlugins: checked })}
                  />
                  <Label>Update Plugins</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    checked={updateConfig.includeCore}
                    onCheckedChange={(checked) => setUpdateConfig({ ...updateConfig, includeCore: checked })}
                  />
                  <Label>Update Core</Label>
                </div>
              </div>

              <Button
                onClick={() => updateMutation.mutate()}
                disabled={updateMutation.isPending || !updateConfig.baseUrl || !selectedConnectionId}
                className="btn-primary"
              >
                {updateMutation.isPending ? "Updating..." : "Start Update Process"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="health" className="space-y-6">
          <Card className="dashboard-card">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Eye className="w-5 h-5" />
                <span>Health Check</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="healthUrl">Website URL</Label>
                  <Input
                    id="healthUrl"
                    placeholder="https://example.com"
                    value={healthCheckConfig.url}
                    onChange={(e) => setHealthCheckConfig({ ...healthCheckConfig, url: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="keyword">Search Keyword</Label>
                  <Input
                    id="keyword"
                    placeholder="Expected text on page"
                    value={healthCheckConfig.keyword}
                    onChange={(e) => setHealthCheckConfig({ ...healthCheckConfig, keyword: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  checked={healthCheckConfig.screenshot}
                  onCheckedChange={(checked) => setHealthCheckConfig({ ...healthCheckConfig, screenshot: checked })}
                />
                <Label>Take Screenshot</Label>
              </div>

              <Button
                onClick={() => healthCheckMutation.mutate()}
                disabled={healthCheckMutation.isPending || !healthCheckConfig.url}
                className="btn-primary"
              >
                {healthCheckMutation.isPending ? "Checking..." : "Run Health Check"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ssl" className="space-y-6">
          <Card className="dashboard-card">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Shield className="w-5 h-5" />
                <span>SSL Certificate Check</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="domain">Domain</Label>
                <Input
                  id="domain"
                  placeholder="example.com"
                  onChange={(e) => {
                    const domain = e.target.value;
                    if (domain) {
                      sslCheckMutation.mutate(domain);
                    }
                  }}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                Check SSL certificate status and expiration date
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reset" className="space-y-6">
          <Card className="dashboard-card border-destructive/50">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2 text-destructive">
                <AlertTriangle className="w-5 h-5" />
                <span>WordPress Hard Reset</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-destructive/10 border border-destructive/50 rounded-lg p-4">
                <div className="flex items-start space-x-2">
                  <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-destructive mb-1">⚠️ DANGER ZONE</p>
                    <p className="text-muted-foreground">
                      This will completely reset the WordPress installation, purge the stack, and reset UFW firewall rules. 
                      This action is irreversible and requires a special reset token.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="resetDomain">Domain</Label>
                  <Input
                    id="resetDomain"
                    placeholder="example.com"
                    value={resetConfig.domain}
                    onChange={(e) => setResetConfig({ ...resetConfig, domain: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center space-x-2">
                    <Switch
                      checked={resetConfig.purgeStack}
                      onCheckedChange={(checked) => setResetConfig({ ...resetConfig, purgeStack: checked })}
                    />
                    <Label>Purge Stack</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Switch
                      checked={resetConfig.resetUfw}
                      onCheckedChange={(checked) => setResetConfig({ ...resetConfig, resetUfw: checked })}
                    />
                    <Label>Reset UFW</Label>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="reportPath">Report Path</Label>
                  <Input
                    id="reportPath"
                    placeholder="/tmp/wp_rollback_report.json"
                    value={resetConfig.reportPath}
                    onChange={(e) => setResetConfig({ ...resetConfig, reportPath: e.target.value })}
                  />
                </div>

                <Button
                  onClick={() => resetMutation.mutate()}
                  disabled={resetMutation.isPending || !resetConfig.domain || !siteConfig.host}
                  variant="destructive"
                  className="w-full"
                >
                  {resetMutation.isPending ? "Resetting..." : "⚠️ RESET WORDPRESS INSTALLATION"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}