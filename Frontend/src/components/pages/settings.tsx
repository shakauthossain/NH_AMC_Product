import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiService, ApiSettings } from "@/lib/api";
import { Settings, Server, Shield, Key, CheckCircle } from "lucide-react";

export function SettingsPage() {
  const [settings, setSettings] = useState<ApiSettings>({
    baseUrl: 'http://localhost:8000',
    defaultAuth: {
      username: '',
      password: '',
    },
    customHeaders: {},
    resetToken: '',
  });

  const [headersText, setHeadersText] = useState('');
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const { toast } = useToast();

  // Load settings on component mount
  useEffect(() => {
    const currentSettings = apiService.getSettings();
    setSettings(currentSettings);
    
    // Convert headers object to JSON string for editing
    if (currentSettings.customHeaders) {
      setHeadersText(JSON.stringify(currentSettings.customHeaders, null, 2));
    }
  }, []);

  const handleSave = () => {
    try {
      // Parse custom headers if provided
      let customHeaders = {};
      if (headersText.trim()) {
        customHeaders = JSON.parse(headersText);
      }

      const updatedSettings: ApiSettings = {
        ...settings,
        customHeaders,
      };

      apiService.updateSettings(updatedSettings);
      setSettings(updatedSettings);
      
      toast({
        title: "Settings saved",
        description: "API configuration has been updated successfully",
      });
    } catch (error) {
      toast({
        title: "Invalid JSON",
        description: "Please check the custom headers JSON format",
        variant: "destructive",
      });
    }
  };

  const testConnection = async () => {
    setIsTestingConnection(true);
    setConnectionStatus('idle');

    try {
      // Temporarily update the API service with current settings
      const tempSettings: ApiSettings = {
        ...settings,
        customHeaders: headersText.trim() ? JSON.parse(headersText) : {},
      };
      apiService.updateSettings(tempSettings);

      // Test the connection
      const result = await apiService.ping();
      
      if (result.ok) {
        setConnectionStatus('success');
        toast({
          title: "Connection successful",
          description: `Connected to ${result.service}`,
        });
      } else {
        throw new Error('Service returned ok: false');
      }
    } catch (error) {
      setConnectionStatus('error');
      toast({
        title: "Connection failed",
        description: error instanceof Error ? error.message : 'Unknown error occurred',
        variant: "destructive",
      });
    } finally {
      setIsTestingConnection(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground">Configure API endpoints and authentication</p>
      </div>

      <div className="grid gap-8">
        {/* API Configuration */}
        <Card className="dashboard-card">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Server className="w-5 h-5" />
              <span>API Configuration</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="baseUrl">Base URL</Label>
              <div className="flex space-x-2">
                <Input
                  id="baseUrl"
                  placeholder="http://localhost:8000"
                  value={settings.baseUrl}
                  onChange={(e) => setSettings({ ...settings, baseUrl: e.target.value })}
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  onClick={testConnection}
                  disabled={isTestingConnection || !settings.baseUrl}
                >
                  {isTestingConnection ? "Testing..." : "Test"}
                </Button>
              </div>
              {connectionStatus === 'success' && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center space-x-2 text-success text-sm"
                >
                  <CheckCircle className="w-4 h-4" />
                  <span>Connection successful</span>
                </motion.div>
              )}
              <p className="text-sm text-muted-foreground">
                The base URL for your FastAPI backend (include protocol)
              </p>
            </div>

            <div className="space-y-4">
              <h3 className="text-lg font-medium">Custom Headers</h3>
              <div className="space-y-2">
                <Label htmlFor="customHeaders">Additional HTTP Headers (JSON)</Label>
                <Textarea
                  id="customHeaders"
                  placeholder='{\n  "X-API-Key": "your-api-key",\n  "Custom-Header": "value"\n}'
                  rows={6}
                  value={headersText}
                  onChange={(e) => setHeadersText(e.target.value)}
                  className="font-mono text-sm"
                />
                <p className="text-sm text-muted-foreground">
                  JSON object with custom headers to include in all API requests
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Default WordPress Authentication */}
        <Card className="dashboard-card">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Shield className="w-5 h-5" />
              <span>Default WordPress Authentication</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground mb-4">
              Default credentials for WordPress admin operations (used when not specified in individual requests)
            </p>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="defaultUsername">Username</Label>
                <Input
                  id="defaultUsername"
                  placeholder="admin"
                  value={settings.defaultAuth?.username || ''}
                  onChange={(e) => setSettings({
                    ...settings,
                    defaultAuth: {
                      ...settings.defaultAuth,
                      username: e.target.value,
                      password: settings.defaultAuth?.password || '',
                    }
                  })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="defaultPassword">Password</Label>
                <Input
                  id="defaultPassword"
                  type="password"
                  placeholder="••••••••"
                  value={settings.defaultAuth?.password || ''}
                  onChange={(e) => setSettings({
                    ...settings,
                    defaultAuth: {
                      username: settings.defaultAuth?.username || '',
                      password: e.target.value,
                    }
                  })}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Security Settings */}
        <Card className="dashboard-card">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Key className="w-5 h-5" />
              <span>Security Settings</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="resetToken">Reset Token</Label>
              <Input
                id="resetToken"
                type="password"
                placeholder="Required for hard reset operations"
                value={settings.resetToken || ''}
                onChange={(e) => setSettings({ ...settings, resetToken: e.target.value })}
              />
              <p className="text-sm text-muted-foreground">
                Bearer token required for dangerous operations like hard reset
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Save Button */}
        <div className="flex justify-end">
          <Button onClick={handleSave} className="btn-primary">
            Save Settings
          </Button>
        </div>
      </div>
    </div>
  );
}