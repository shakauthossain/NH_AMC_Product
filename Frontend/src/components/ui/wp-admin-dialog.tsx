import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiService } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Shield, Settings } from "lucide-react";

interface WpAdminDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WpAdminDialog({ open, onOpenChange }: WpAdminDialogProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const { toast } = useToast();

  const handleSave = () => {
    if (!username.trim() || !password.trim()) {
      toast({
        title: "Missing credentials",
        description: "Please enter both username and password",
        variant: "destructive",
      });
      return;
    }

    // Get current settings and update with WordPress admin credentials
    const currentSettings = apiService.getSettings();
    const updatedSettings = {
      ...currentSettings,
      defaultAuth: {
        username: username.trim(),
        password: password.trim(),
      },
    };

    // Save to API service (which stores in localStorage)
    apiService.updateSettings(updatedSettings);

    // Mark that we've shown this dialog
    localStorage.setItem('wp-admin-dialog-shown', 'true');

    toast({
      title: "WordPress credentials saved",
      description: "Credentials are now available in settings and will be used for WordPress operations",
    });

    onOpenChange(false);
  };

  const handleSkip = () => {
    // Mark that we've shown this dialog even if skipped
    localStorage.setItem('wp-admin-dialog-shown', 'true');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Shield className="w-5 h-5" />
            <span>WordPress Admin Credentials</span>
          </DialogTitle>
          <DialogDescription>
            To perform WordPress operations like updates and status checks, we need your WordPress admin credentials. These will be stored securely and used for all WordPress operations.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="wp-username">WordPress Admin Username</Label>
            <Input
              id="wp-username"
              placeholder="admin"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="wp-password">WordPress Admin Password</Label>
            <Input
              id="wp-password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <div className="flex items-start space-x-2 p-3 bg-muted/30 rounded-md">
            <Settings className="w-4 h-4 mt-0.5 text-muted-foreground" />
            <div className="text-sm text-muted-foreground">
              <p className="font-medium">Note:</p>
              <p>You can always update these credentials later in Settings → Default WordPress Authentication.</p>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={handleSkip} className="sm:flex-1">
            Skip for now
          </Button>
          <Button onClick={handleSave} className="sm:flex-1">
            Save Credentials
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}