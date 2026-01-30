import { useState, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Hash, Lock, AlertCircle, ArrowLeft, Globe } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCreateChannel } from "@/hooks/useChannels";

interface CreateChannelDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

function normalizeChannelName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/-+/g, "-") // Collapse multiple hyphens
    .replace(/^-|-$/g, "") // Remove leading/trailing hyphens
    .substring(0, 80);
}

function validateChannelName(name: string): { valid: boolean; error?: string } {
  if (!name || name.trim().length === 0) {
    return { valid: false, error: "Channel name is required" };
  }
  if (name.length > 80) {
    return {
      valid: false,
      error: "Channel name must be 80 characters or less",
    };
  }
  // Allow Unicode letters, numbers, hyphens, and underscores
  // Must start with a letter or number (Unicode-aware)
  if (!/^[\p{L}\p{N}][\p{L}\p{N}\-_]*$/u.test(name)) {
    return {
      valid: false,
      error: "Must start with a letter or number",
    };
  }
  return { valid: true };
}

type Step = "name" | "visibility";

export function CreateChannelDialog({
  isOpen,
  onClose,
}: CreateChannelDialogProps) {
  const navigate = useNavigate();
  const createChannel = useCreateChannel();

  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState("");
  const [normalizedName, setNormalizedName] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    const normalized = normalizeChannelName(name);
    setNormalizedName(normalized);
    if (normalized) {
      const validation = validateChannelName(normalized);
      setNameError(validation.valid ? null : validation.error || null);
    } else {
      setNameError(null);
    }
  }, [name]);

  const handleNextStep = () => {
    const validation = validateChannelName(normalizedName);
    if (!validation.valid) {
      setNameError(validation.error || "Invalid channel name");
      return;
    }
    setStep("visibility");
  };

  const handleBack = () => {
    setStep("name");
  };

  const handleCreate = async () => {
    try {
      const channel = await createChannel.mutateAsync({
        name: normalizedName,
        description: description || undefined,
        type: isPrivate ? "private" : "public",
      });

      handleClose();

      navigate({
        to: "/channels/$channelId",
        params: { channelId: channel.id },
      });
    } catch (error) {
      console.error("Failed to create channel:", error);
    }
  };

  const resetForm = () => {
    setStep("name");
    setName("");
    setNormalizedName("");
    setDescription("");
    setIsPrivate(false);
    setNameError(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const canProceed = normalizedName && !nameError;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        {step === "name" ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Hash size={20} />
                Create a channel
              </DialogTitle>
              <DialogDescription>
                Channels are where your team communicates. They're best when
                organized around a topic.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="channel-name">Name</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    <Hash size={16} />
                  </span>
                  <Input
                    id="channel-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. marketing"
                    className="pl-10"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && canProceed) {
                        e.preventDefault();
                        handleNextStep();
                      }
                    }}
                  />
                </div>
                {name &&
                  normalizedName !==
                    name.toLowerCase().replace(/\s+/g, "-") && (
                    <p className="text-xs text-muted-foreground">
                      Will be created as:{" "}
                      <span className="font-mono">{normalizedName}</span>
                    </p>
                  )}
                {nameError && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <AlertCircle size={12} />
                    {nameError}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="channel-description">
                  Description{" "}
                  <span className="text-muted-foreground font-normal">
                    (optional)
                  </span>
                </Label>
                <Textarea
                  id="channel-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What's this channel about?"
                  rows={3}
                  maxLength={1000}
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={handleNextStep}
                disabled={!canProceed}
                className="bg-primary hover:bg-primary/90"
              >
                Next
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 -ml-2"
                  onClick={handleBack}
                >
                  <ArrowLeft size={18} />
                </Button>
                <span>Choose visibility</span>
              </DialogTitle>
              <DialogDescription>
                Select who can see and join{" "}
                <span className="font-mono font-medium">#{normalizedName}</span>
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-4">
              <button
                type="button"
                onClick={() => setIsPrivate(false)}
                className={`w-full p-4 rounded-lg border-2 text-left transition-colors ${
                  !isPrivate
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-border"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`p-2 rounded-lg ${
                      !isPrivate ? "bg-primary/10" : "bg-muted"
                    }`}
                  >
                    <Globe
                      size={20}
                      className={
                        !isPrivate ? "text-primary" : "text-muted-foreground"
                      }
                    />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">Public</span>
                      {!isPrivate && (
                        <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">
                          Selected
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      Anyone in your workspace can view and join this channel.
                    </p>
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setIsPrivate(true)}
                className={`w-full p-4 rounded-lg border-2 text-left transition-colors ${
                  isPrivate
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-border"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`p-2 rounded-lg ${
                      isPrivate ? "bg-primary/10" : "bg-muted"
                    }`}
                  >
                    <Lock
                      size={20}
                      className={
                        isPrivate ? "text-primary" : "text-muted-foreground"
                      }
                    />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">Private</span>
                      {isPrivate && (
                        <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">
                          Selected
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      Only invited members can see and join this channel.
                    </p>
                  </div>
                </div>
              </button>
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={handleBack}>
                Back
              </Button>
              <Button
                onClick={handleCreate}
                disabled={createChannel.isPending}
                className="bg-primary hover:bg-primary/90"
              >
                {createChannel.isPending ? "Creating..." : "Create Channel"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
