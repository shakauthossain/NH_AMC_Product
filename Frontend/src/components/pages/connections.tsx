import { useState } from "react";
import { motion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiService, SiteConnection } from "@/lib/api";
import { Server, Plus, Trash2, Key, Lock, AlertCircle } from "lucide-react";

interface SavedConnection extends SiteConnection {
  id: string;
  name: string;
  lastConnected?: Date;
}

export function ConnectionsPage() {
  const [newConnection, setNewConnection] = useState<SiteConnection & { name: string }>({
    name: "",
    host: "",
    user: "",
    wp_path: "/var/www/html",
    password: "",
    key_filename: null,
    private_key_pem: null,
  });
  const [authMethod, setAuthMethod] = useState<'password' | 'key_file' | 'key_pem'>('password');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Load saved connections from localStorage
  const { data: savedConnections = [] } = useQuery({
    queryKey: ['saved-connections'],
    queryFn: () => {
      const saved = localStorage.getItem('wp-dashboard-connections');
      return saved ? JSON.parse(saved) : [];
    },
  });

  const saveConnection = useMutation({
    mutationFn: async (connection: SavedConnection) => {
      const connections = [...savedConnections];
      const existing = connections.findIndex(c => c.id === connection.id);
      
      if (existing >= 0) {
        connections[existing] = connection;
      } else {
        connections.push(connection);
      }
      
      localStorage.setItem('wp-dashboard-connections', JSON.stringify(connections));
      return connections;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-connections'] });
    },
  });

  const deleteConnection = useMutation({
    mutationFn: async (id: string) => {
      const connections = savedConnections.filter((c: SavedConnection) => c.id !== id);
      localStorage.setItem('wp-dashboard-connections', JSON.stringify(connections));
      return connections;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-connections'] });
      toast({ title: "Connection deleted" });
    },
  });

  const testConnection = useMutation({
    mutationFn: (connection: SiteConnection) => apiService.sshLogin(connection),
    onSuccess: (data, variables) => {
      toast({
        title: "Connection successful!",
        description: `Connected to ${variables.host} as ${variables.user}`,
      });
      
      // Save successful connection
      const connection: SavedConnection = {
        ...variables,
        id: data.site_id,
        name: newConnection.name,
        lastConnected: new Date(),
      };
      saveConnection.mutate(connection);
      
      // Reset form
      setNewConnection({
        name: "",
        host: "",
        user: "",
        wp_path: "/var/www/html",
        password: "",
        key_filename: null,
        private_key_pem: null,
      });
    },
    onError: (error) => {
      toast({
        title: "Connection failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!newConnection.name || !newConnection.host || !newConnection.user) {
      toast({
        title: "Missing required fields",
        description: "Please fill in connection name, host, and user",
        variant: "destructive",
      });
      return;
    }

    const connection: SiteConnection = {
      host: newConnection.host,
      user: newConnection.user,
      wp_path: newConnection.wp_path,
      password: authMethod === 'password' ? newConnection.password : null,
      key_filename: authMethod === 'key_file' ? newConnection.key_filename : null,
      private_key_pem: authMethod === 'key_pem' ? newConnection.private_key_pem : null,
    };

    testConnection.mutate(connection);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-foreground">SSH Connections</h1>
        <p className="text-muted-foreground">Manage SSH connections to your WordPress servers</p>
      </div>

      <div className="grid lg:grid-cols-2 gap-8">
        {/* New Connection Form */}
        <Card className="dashboard-card">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Plus className="w-5 h-5" />
              <span>Add New Connection</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Connection Name</Label>
                <Input
                  id="name"
                  placeholder="e.g., Production Server"
                  value={newConnection.name}
                  onChange={(e) => setNewConnection({ ...newConnection, name: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="host">Host / IP Address</Label>
                  <Input
                    id="host"
                    placeholder="203.0.113.45"
                    value={newConnection.host}
                    onChange={(e) => setNewConnection({ ...newConnection, host: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="user">Username</Label>
                  <Input
                    id="user"
                    placeholder="root"
                    value={newConnection.user}
                    onChange={(e) => setNewConnection({ ...newConnection, user: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="wp_path">WordPress Path</Label>
                <Input
                  id="wp_path"
                  placeholder="/var/www/html"
                  value={newConnection.wp_path}
                  onChange={(e) => setNewConnection({ ...newConnection, wp_path: e.target.value })}
                />
              </div>

              <Tabs value={authMethod} onValueChange={(value: any) => setAuthMethod(value)}>
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="password">Password</TabsTrigger>
                  <TabsTrigger value="key_file">Key File</TabsTrigger>
                  <TabsTrigger value="key_pem">Private Key</TabsTrigger>
                </TabsList>

                <TabsContent value="password" className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Enter SSH password"
                    value={newConnection.password || ''}
                    onChange={(e) => setNewConnection({ ...newConnection, password: e.target.value })}
                  />
                </TabsContent>

                <TabsContent value="key_file" className="space-y-2">
                  <Label htmlFor="key_filename">Key File Path</Label>
                  <Input
                    id="key_filename"
                    placeholder="/path/to/private/key"
                    value={newConnection.key_filename || ''}
                    onChange={(e) => setNewConnection({ ...newConnection, key_filename: e.target.value })}
                  />
                </TabsContent>

                <TabsContent value="key_pem" className="space-y-2">
                  <Label htmlFor="private_key_pem">Private Key (PEM)</Label>
                  <Textarea
                    id="private_key_pem"
                    placeholder="-----BEGIN PRIVATE KEY-----"
                    rows={6}
                    value={newConnection.private_key_pem || ''}
                    onChange={(e) => setNewConnection({ ...newConnection, private_key_pem: e.target.value })}
                  />
                </TabsContent>
              </Tabs>

              <Button
                type="submit"
                className="w-full btn-primary"
                disabled={testConnection.isPending}
              >
                {testConnection.isPending ? "Testing Connection..." : "Test & Save Connection"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Saved Connections */}
        <Card className="dashboard-card">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Server className="w-5 h-5" />
              <span>Saved Connections</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {savedConnections.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No saved connections yet</p>
                <p className="text-sm">Add your first SSH connection to get started</p>
              </div>
            ) : (
              <div className="space-y-4">
                {savedConnections.map((connection: SavedConnection) => (
                  <motion.div
                    key={connection.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-4 border rounded-lg space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-medium">{connection.name}</h3>
                        <p className="text-sm text-muted-foreground">
                          {connection.user}@{connection.host}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteConnection.mutate(connection.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                    
                    <div className="flex items-center space-x-2 text-sm">
                      <Badge variant="outline" className="text-xs">
                        {connection.wp_path}
                      </Badge>
                      {connection.password && (
                        <Badge variant="outline" className="text-xs">
                          <Lock className="w-3 h-3 mr-1" />
                          Password
                        </Badge>
                      )}
                      {(connection.key_filename || connection.private_key_pem) && (
                        <Badge variant="outline" className="text-xs">
                          <Key className="w-3 h-3 mr-1" />
                          Key Auth
                        </Badge>
                      )}
                    </div>

                    {connection.lastConnected && (
                      <p className="text-xs text-muted-foreground">
                        Last connected: {new Date(connection.lastConnected).toLocaleString()}
                      </p>
                    )}
                  </motion.div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}