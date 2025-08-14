import { useState } from "react";
import { motion } from "framer-motion";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiService, WPInstallRequest } from "@/lib/api";
import { useTaskTracker } from "../layout/task-sidebar";
import { Plus, Server, Globe, Mail, Database, Code } from "lucide-react";

interface SavedConnection {
  id: string;
  name: string;
  host: string;
  user: string;
  wp_path: string;
}

export function ProvisionPage() {
  const [selectedSiteId, setSelectedSiteId] = useState<string>("");
  const [installConfig, setInstallConfig] = useState<WPInstallRequest>({
    domain: "",
    wp_path: "/var/www/html",
    site_title: "",
    admin_user: "admin",
    admin_pass: "",
    admin_email: "",
    db_name: "",
    db_user: "",
    db_pass: "",
    php_version: "8.1",
    wp_version: "latest",
    report_email: "",
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

  const installWordPress = useMutation({
    mutationFn: () => {
      if (!selectedSiteId) {
        throw new Error('Please select a server connection');
      }
      return apiService.installWordPress(selectedSiteId, installConfig);
    },
    onSuccess: (data) => {
      toast({
        title: "WordPress installation queued",
        description: `Task ID: ${data.task_id}`,
      });
      
      addTaskToTracker(data.task_id, "WordPress Installation", `Installing LEMP stack, configuring PHP ${installConfig.php_version}, downloading WordPress ${installConfig.wp_version}, setting up database`);
      
      // Reset form
      setInstallConfig({
        domain: "",
        wp_path: "/var/www/html",
        site_title: "",
        admin_user: "admin",
        admin_pass: "",
        admin_email: "",
        db_name: "",
        db_user: "",
        db_pass: "",
        php_version: "8.1",
        wp_version: "latest",
        report_email: "",
      });
      setSelectedSiteId("");
    },
    onError: (error) => {
      toast({
        title: "Installation failed to start",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedSiteId) {
      toast({
        title: "No server selected",
        description: "Please select a server connection first",
        variant: "destructive",
      });
      return;
    }

    if (!installConfig.site_title || !installConfig.admin_email) {
      toast({
        title: "Missing required fields",
        description: "Please fill in site title, and admin email",
        variant: "destructive",
      });
      return;
    }

    installWordPress.mutate();
  };

  const generatePassword = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    const password = Array.from({ length: 16 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    setInstallConfig({ ...installConfig, admin_pass: password });
  };

  const generateDbPassword = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const password = Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    setInstallConfig({ ...installConfig, db_pass: password });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Provision WordPress</h1>
        <p className="text-muted-foreground">Install a new WordPress site on your server</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Server Selection */}
        <Card className="dashboard-card">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Server className="w-5 h-5" />
              <span>Server Selection</span>
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
              <div className="space-y-2">
                <Label htmlFor="server">Select Server</Label>
                <Select value={selectedSiteId} onValueChange={setSelectedSiteId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a server connection" />
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
            )}
          </CardContent>
        </Card>

        {/* Site Configuration */}
        <Card className="dashboard-card">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Globe className="w-5 h-5" />
              <span>Site Configuration</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="domain">Domain</Label>
                <Input
                  id="domain"
                  placeholder="example.com"
                  value={installConfig.domain}
                  onChange={(e) => setInstallConfig({ ...installConfig, domain: e.target.value })}
                  // required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wp_path">WordPress Path</Label>
                <Input
                  id="wp_path"
                  placeholder="/var/www/html"
                  value={installConfig.wp_path}
                  onChange={(e) => setInstallConfig({ ...installConfig, wp_path: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="site_title">Site Title</Label>
              <Input
                id="site_title"
                placeholder="My WordPress Site"
                value={installConfig.site_title}
                onChange={(e) => setInstallConfig({ ...installConfig, site_title: e.target.value })}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="php_version">PHP Version</Label>
                <Select
                  value={installConfig.php_version}
                  onValueChange={(value) => setInstallConfig({ ...installConfig, php_version: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7.4">PHP 7.4</SelectItem>
                    <SelectItem value="8.0">PHP 8.0</SelectItem>
                    <SelectItem value="8.1">PHP 8.1</SelectItem>
                    <SelectItem value="8.2">PHP 8.2</SelectItem>
                    <SelectItem value="8.3">PHP 8.3</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="wp_version">WordPress Version</Label>
                <Select
                  value={installConfig.wp_version}
                  onValueChange={(value) => setInstallConfig({ ...installConfig, wp_version: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="latest">Latest</SelectItem>
                    <SelectItem value="6.4">WordPress 6.4</SelectItem>
                    <SelectItem value="6.3">WordPress 6.3</SelectItem>
                    <SelectItem value="6.2">WordPress 6.2</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Admin Account */}
        <Card className="dashboard-card">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Mail className="w-5 h-5" />
              <span>Admin Account</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="admin_user">Username</Label>
                <Input
                  id="admin_user"
                  placeholder="admin"
                  value={installConfig.admin_user}
                  onChange={(e) => setInstallConfig({ ...installConfig, admin_user: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="admin_email">Email</Label>
                <Input
                  id="admin_email"
                  type="email"
                  placeholder="admin@example.com"
                  value={installConfig.admin_email}
                  onChange={(e) => setInstallConfig({ ...installConfig, admin_email: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="admin_pass">Password</Label>
              <div className="flex space-x-2">
                <Input
                  id="admin_pass"
                  type="password"
                  placeholder="••••••••••••••••"
                  value={installConfig.admin_pass}
                  onChange={(e) => setInstallConfig({ ...installConfig, admin_pass: e.target.value })}
                  className="flex-1"
                />
                <Button type="button" variant="outline" onClick={generatePassword}>
                  Generate
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Database Configuration */}
        <Card className="dashboard-card">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Database className="w-5 h-5" />
              <span>Database Configuration</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="db_name">Database Name</Label>
                <Input
                  id="db_name"
                  placeholder="wp_database"
                  value={installConfig.db_name}
                  onChange={(e) => setInstallConfig({ ...installConfig, db_name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="db_user">Database User</Label>
                <Input
                  id="db_user"
                  placeholder="wp_user"
                  value={installConfig.db_user}
                  onChange={(e) => setInstallConfig({ ...installConfig, db_user: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="db_pass">Database Password</Label>
              <div className="flex space-x-2">
                <Input
                  id="db_pass"
                  type="password"
                  placeholder="••••••••••••"
                  value={installConfig.db_pass}
                  onChange={(e) => setInstallConfig({ ...installConfig, db_pass: e.target.value })}
                  className="flex-1"
                />
                <Button type="button" variant="outline" onClick={generateDbPassword}>
                  Generate
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Optional Settings */}
        <Card className="dashboard-card">
          <CardHeader>
            <CardTitle>Optional Settings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="report_email">Report Email</Label>
              <Input
                id="report_email"
                type="email"
                placeholder="reports@example.com"
                value={installConfig.report_email}
                onChange={(e) => setInstallConfig({ ...installConfig, report_email: e.target.value })}
              />
              <p className="text-sm text-muted-foreground">
                Email address to receive installation reports (optional)
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Submit */}
        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={installWordPress.isPending || !selectedSiteId}
            className="btn-primary"
          >
            {installWordPress.isPending ? "Installing..." : "Install WordPress"}
          </Button>
        </div>
      </form>
    </div>
  );
}