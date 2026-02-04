import {
  ArrowLeft,
  Bot,
  Loader2,
  AlertCircle,
  Settings,
  Trash2,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface ApplicationDetailContentProps {
  appId: string;
}

export function ApplicationDetailContent({
  appId,
}: ApplicationDetailContentProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isUninstallDialogOpen, setIsUninstallDialogOpen] = useState(false);

  const {
    data: installedApp,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["installed-application", appId],
    queryFn: () => api.applications.getInstalledApplication(appId),
  });

  const updateMutation = useMutation({
    mutationFn: (data: { isActive?: boolean }) =>
      api.applications.updateInstalledApplication(appId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["installed-application", appId],
      });
      queryClient.invalidateQueries({ queryKey: ["installed-applications"] });
    },
  });

  const uninstallMutation = useMutation({
    mutationFn: () => api.applications.uninstallApplication(appId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["installed-applications"] });
      navigate({ to: "/application" });
    },
  });

  const handleBack = () => {
    navigate({ to: "/application" });
  };

  const handleToggleActive = (checked: boolean) => {
    updateMutation.mutate({ isActive: checked });
  };

  const handleUninstall = () => {
    uninstallMutation.mutate();
    setIsUninstallDialogOpen(false);
  };

  return (
    <main className="flex-1 flex flex-col bg-background">
      {/* Content Header */}
      <header className="h-14 bg-background flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={handleBack}>
            <ArrowLeft size={18} />
          </Button>
          <Settings size={18} className="text-primary" />
          <h2 className="font-semibold text-lg text-foreground">
            App Settings
          </h2>
        </div>
      </header>

      <Separator />

      {/* Content */}
      <ScrollArea className="flex-1 bg-secondary/50">
        <div className="p-4 max-w-2xl">
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {error && (
            <Card className="p-6 text-center">
              <AlertCircle className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Failed to load application details
              </p>
            </Card>
          )}

          {!isLoading && !error && installedApp && (
            <div className="space-y-6">
              {/* App Info Card */}
              <Card>
                <CardHeader>
                  <div className="flex items-start gap-4">
                    <div className="w-16 h-16 bg-primary/10 rounded-xl flex items-center justify-center shrink-0">
                      <Bot size={32} className="text-primary" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <CardTitle>{installedApp.name}</CardTitle>
                        <Badge
                          variant={
                            installedApp.status === "active"
                              ? "default"
                              : "secondary"
                          }
                        >
                          {installedApp.status}
                        </Badge>
                      </div>
                      {installedApp.description && (
                        <CardDescription className="mt-1">
                          {installedApp.description}
                        </CardDescription>
                      )}
                    </div>
                  </div>
                </CardHeader>
              </Card>

              {/* Settings Card */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Settings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="app-active">Enable App</Label>
                      <p className="text-xs text-muted-foreground">
                        Turn off to temporarily disable this app
                      </p>
                    </div>
                    <Switch
                      id="app-active"
                      checked={installedApp.isActive}
                      onCheckedChange={handleToggleActive}
                      disabled={updateMutation.isPending}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Danger Zone */}
              <Card className="border-destructive/50">
                <CardHeader>
                  <CardTitle className="text-base text-destructive">
                    Danger Zone
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">Uninstall App</p>
                      <p className="text-xs text-muted-foreground">
                        Remove this app from your workspace
                      </p>
                    </div>
                    <AlertDialog
                      open={isUninstallDialogOpen}
                      onOpenChange={setIsUninstallDialogOpen}
                    >
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive" size="sm">
                          <Trash2 size={14} className="mr-1" />
                          Uninstall
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Uninstall {installedApp.name}?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            This will remove the app from your workspace. Any
                            data associated with this app may be lost.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={handleUninstall}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            {uninstallMutation.isPending ? (
                              <Loader2 className="w-4 h-4 animate-spin mr-1" />
                            ) : null}
                            Uninstall
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </ScrollArea>
    </main>
  );
}
