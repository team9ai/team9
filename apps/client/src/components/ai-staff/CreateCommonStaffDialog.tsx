import { useState, useCallback, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
// No Textarea UI component — using plain <textarea> with Tailwind
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import {
  ArrowLeft,
  ArrowRight,
  ClipboardList,
  Loader2,
  MessageSquare,
  Sparkles,
  Users,
  Wand2,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { api } from "@/services/api";
import { useSelectedWorkspaceId } from "@/stores/useWorkspaceStore";
import { useCurrentUser } from "@/hooks/useAuth";
import { useCreateDirectChannel } from "@/hooks/useChannels";
import {
  COMMON_STAFF_MODELS,
  DEFAULT_STAFF_MODEL,
  type StaffModel,
} from "@/lib/common-staff-models";
import { StaffBadgeCard } from "./StaffBadgeCard";

type CreationMode = "form" | "agentic" | "recruitment";

interface CreateCommonStaffDialogProps {
  appId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DICEBEAR_PRESETS = Array.from({ length: 8 }, (_, i) => ({
  url: `https://api.dicebear.com/9.x/avataaars/svg?seed=staff-${i}`,
  seed: `staff-${i}`,
}));

export function CreateCommonStaffDialog({
  appId,
  open,
  onOpenChange,
}: CreateCommonStaffDialogProps) {
  const workspaceId = useSelectedWorkspaceId();
  const { data: currentUser } = useCurrentUser();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const createDirectChannel = useCreateDirectChannel();

  // Step state
  const [mode, setMode] = useState<CreationMode | null>(null);
  const [step, setStep] = useState(1);

  // Form fields
  const [displayName, setDisplayName] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [mentorId, setMentorId] = useState("");
  const [model, setModel] = useState<StaffModel>(DEFAULT_STAFF_MODEL);
  const [persona, setPersona] = useState("");
  const [personaPrompt, setPersonaPrompt] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isGeneratingPersona, setIsGeneratingPersona] = useState(false);
  const [isGeneratingAvatar, setIsGeneratingAvatar] = useState(false);
  const [avatarStyle, setAvatarStyle] = useState<string>("realistic");

  // Recruitment state
  const [jobTitle, setJobTitle] = useState("");
  const [jd, setJd] = useState("");
  const [candidates, setCandidates] = useState<
    Array<{
      candidateIndex: number;
      displayName: string;
      roleTitle: string;
      persona: string;
      summary: string;
    }>
  >([]);
  const [selectedCandidate, setSelectedCandidate] = useState<number | null>(
    null,
  );
  const [isGeneratingCandidates, setIsGeneratingCandidates] = useState(false);
  const [candidateGenerationError, setCandidateGenerationError] = useState<
    string | null
  >(null);
  const [formError, setFormError] = useState<string | null>(null);
  // Editable candidate fields (keyed by candidateIndex)
  const [editedCandidates, setEditedCandidates] = useState<
    Record<number, { displayName: string; roleTitle: string; persona: string }>
  >({});

  // Workspace members for mentor dropdown
  const { data: membersData } = useQuery({
    queryKey: ["workspace-members", workspaceId],
    queryFn: () => api.workspace.getMembers(workspaceId!, { limit: 100 }),
    enabled: !!workspaceId && open,
  });
  const humanMembers = (membersData?.members ?? []).filter(
    (m) => !m.userType || m.userType === "human",
  );

  // Default mentor to current user on dialog open
  useEffect(() => {
    if (open && currentUser?.id) setMentorId(currentUser.id);
  }, [open, currentUser?.id]);

  // Reset form on close
  const resetForm = useCallback(() => {
    setMode(null);
    setStep(1);
    setDisplayName("");
    setRoleTitle("");
    setJobDescription("");
    setMentorId("");
    setModel(DEFAULT_STAFF_MODEL);
    setPersona("");
    setPersonaPrompt("");
    setAvatarUrl(null);
    setIsGeneratingPersona(false);
    setIsGeneratingAvatar(false);
    setJobTitle("");
    setJd("");
    setCandidates([]);
    setSelectedCandidate(null);
    setIsGeneratingCandidates(false);
    setCandidateGenerationError(null);
    setEditedCandidates({});
    setFormError(null);
  }, []);

  // Persona AI generation
  const handleGeneratePersona = useCallback(async () => {
    setIsGeneratingPersona(true);
    setFormError(null);
    try {
      const stream = api.applications.generatePersona(appId, {
        displayName: displayName || "Staff",
        roleTitle: roleTitle || undefined,
        jobDescription: jobDescription || undefined,
        prompt: personaPrompt || undefined,
        existingPersona: persona || undefined,
      });
      let accumulated = "";
      for await (const chunk of stream) {
        accumulated += chunk;
        setPersona(accumulated);
      }
    } catch (error) {
      setFormError("Failed to generate persona. Please try again.");
      console.error("Persona generation failed:", error);
    } finally {
      setIsGeneratingPersona(false);
    }
  }, [appId, displayName, roleTitle, jobDescription, persona, personaPrompt]);

  // Avatar AI generation
  const handleGenerateAvatar = useCallback(async () => {
    setIsGeneratingAvatar(true);
    setFormError(null);
    try {
      const result = await api.applications.generateAvatar(appId, {
        style: avatarStyle,
        displayName: displayName || undefined,
        roleTitle: roleTitle || undefined,
        persona: persona || undefined,
      });
      setAvatarUrl(result.avatarUrl);
    } catch (error) {
      setFormError("Failed to generate avatar. Please try again.");
      console.error("Avatar generation failed:", error);
    } finally {
      setIsGeneratingAvatar(false);
    }
  }, [appId, avatarStyle, displayName, roleTitle, persona]);

  // Submit mutation
  const createMutation = useMutation({
    mutationFn: () =>
      api.applications.createCommonStaff(appId, {
        displayName,
        roleTitle: roleTitle || undefined,
        mentorId: mentorId || undefined,
        persona: persona || undefined,
        jobDescription: jobDescription || undefined,
        model: { provider: model.provider, id: model.id },
        avatarUrl: avatarUrl || undefined,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["installed-applications-with-bots", workspaceId],
      });
      navigate({ to: "/ai-staff/$staffId", params: { staffId: data.botId } });
      onOpenChange(false);
      resetForm();
    },
    onError: (error) => {
      setFormError(
        error instanceof Error ? error.message : "Failed to create staff",
      );
    },
  });

  // Agentic submit mutation
  const agenticMutation = useMutation({
    mutationFn: () =>
      api.applications.createCommonStaff(appId, {
        mentorId: mentorId || undefined,
        model: { provider: model.provider, id: model.id },
        agenticBootstrap: true,
      }),
    onSuccess: async (data) => {
      queryClient.invalidateQueries({
        queryKey: ["installed-applications-with-bots", workspaceId],
      });
      onOpenChange(false);
      resetForm();
      // Navigate to the DM with the new bot so the bootstrap conversation is visible
      try {
        const channel = await createDirectChannel.mutateAsync(data.userId);
        void navigate({
          to: "/messages/$channelId",
          params: { channelId: channel.id },
        });
      } catch {
        // Fall back to the staff detail page if DM creation fails
        void navigate({
          to: "/ai-staff/$staffId",
          params: { staffId: data.botId },
        });
      }
    },
    onError: (error) => {
      setFormError(
        error instanceof Error ? error.message : "Failed to create staff",
      );
    },
  });

  // Recruitment: generate candidates from SSE stream
  const handleGenerateCandidates = async () => {
    setIsGeneratingCandidates(true);
    setCandidates([]);
    setSelectedCandidate(null);
    setEditedCandidates({});
    setCandidateGenerationError(null);
    try {
      const stream = api.applications.generateCandidates(appId, {
        jobTitle: jobTitle || undefined,
        jobDescription: jd || undefined,
      });
      for await (const event of stream) {
        if (event.type === "partial" || event.type === "complete") {
          const partialCandidates = event.data?.candidates ?? [];
          const complete = partialCandidates.filter(
            (
              c,
            ): c is {
              candidateIndex: number;
              displayName: string;
              roleTitle: string;
              persona: string;
              summary: string;
            } =>
              c.candidateIndex != null &&
              !!c.displayName &&
              !!c.roleTitle &&
              !!c.persona &&
              !!c.summary,
          );
          setCandidates(complete);
        }
      }
    } catch (error) {
      console.error("Candidate generation failed:", error);
      setCandidateGenerationError(
        error instanceof Error
          ? error.message
          : "Failed to generate candidates",
      );
    } finally {
      setIsGeneratingCandidates(false);
    }
  };

  // Recruitment: submit with selected candidate
  const recruitmentMutation = useMutation({
    mutationFn: () => {
      const candidate = candidates.find(
        (c) => c.candidateIndex === selectedCandidate,
      );
      if (!candidate) throw new Error("No candidate selected");
      const edited =
        selectedCandidate != null
          ? editedCandidates[selectedCandidate]
          : undefined;
      return api.applications.createCommonStaff(appId, {
        displayName: edited?.displayName ?? candidate.displayName,
        roleTitle: edited?.roleTitle ?? candidate.roleTitle,
        persona: edited?.persona ?? candidate.persona,
        mentorId: mentorId || undefined,
        model: { provider: model.provider, id: model.id },
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["installed-applications-with-bots", workspaceId],
      });
      navigate({ to: "/ai-staff/$staffId", params: { staffId: data.botId } });
      onOpenChange(false);
      resetForm();
    },
    onError: (error) => {
      setFormError(
        error instanceof Error ? error.message : "Failed to create staff",
      );
    },
  });

  const canProceedStep2 =
    displayName.trim().length > 0 && roleTitle.trim().length > 0;
  const totalSteps = mode === "form" ? 4 : mode === "agentic" ? 2 : 4;

  // ── Step 1: Mode Selection ──────────────────────────────────────────
  const renderStep1 = () => (
    <div className="grid grid-cols-3 gap-3">
      {(
        [
          {
            key: "form" as const,
            icon: ClipboardList,
            title: "Form Mode",
            desc: "Fill in all information directly",
          },
          {
            key: "agentic" as const,
            icon: MessageSquare,
            title: "Agentic Mode",
            desc: "AI guides setup in private DM",
          },
          {
            key: "recruitment" as const,
            icon: Users,
            title: "Recruitment",
            desc: "Generate candidates from a JD",
          },
        ] as const
      ).map(({ key, icon: Icon, title, desc }) => (
        <Card
          key={key}
          className={`cursor-pointer p-4 text-center transition-all hover:border-primary ${
            mode === key ? "border-primary bg-primary/5" : ""
          }`}
          onClick={() => {
            setMode(key);
            setStep(2);
          }}
        >
          <Icon className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">{title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
        </Card>
      ))}
    </div>
  );

  // ── Step 2 (Form): Basic Info ───────────────────────────────────────
  const renderFormStep2 = () => (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium" htmlFor="displayName">
          Display Name *
        </label>
        <Input
          id="displayName"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="e.g. Alice"
        />
      </div>
      <div>
        <label className="text-sm font-medium" htmlFor="roleTitle">
          Role Title *
        </label>
        <Input
          id="roleTitle"
          value={roleTitle}
          onChange={(e) => setRoleTitle(e.target.value)}
          placeholder="e.g. Senior Engineer"
        />
      </div>
      <div>
        <label className="text-sm font-medium" htmlFor="jobDesc">
          Job Description
        </label>
        <textarea
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          id="jobDesc"
          value={jobDescription}
          onChange={(e) => setJobDescription(e.target.value)}
          placeholder="Optional description of responsibilities..."
          rows={3}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium">Mentor</label>
          <Select value={mentorId} onValueChange={setMentorId}>
            <SelectTrigger>
              <SelectValue placeholder="Select mentor..." />
            </SelectTrigger>
            <SelectContent>
              {humanMembers.map((m) => (
                <SelectItem key={m.userId} value={m.userId}>
                  {m.displayName || m.username}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-sm font-medium">Model</label>
          <Select
            value={model.id}
            onValueChange={(id) => {
              const found = COMMON_STAFF_MODELS.find((m) => m.id === id);
              if (found) setModel(found);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COMMON_STAFF_MODELS.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );

  // ── Step 3 (Form): Persona ──────────────────────────────────────────
  const renderFormStep3 = () => (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium">Persona</label>
        <textarea
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
          placeholder="Describe the personality, communication style, quirks..."
          rows={8}
          disabled={isGeneratingPersona}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          {persona.length} characters
        </p>
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="text-sm font-medium">Guidance (optional)</label>
          <Input
            value={personaPrompt}
            onChange={(e) => setPersonaPrompt(e.target.value)}
            placeholder='e.g. "make it more fun", "add coffee obsession"'
          />
        </div>
        <Button
          variant="outline"
          onClick={handleGeneratePersona}
          disabled={isGeneratingPersona}
        >
          {isGeneratingPersona ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-1 h-4 w-4" />
          )}
          {persona ? "Regenerate" : "AI Generate"}
        </Button>
      </div>
    </div>
  );

  // ── Step 4 (Form): Avatar & Preview ─────────────────────────────────
  const [avatarTab, setAvatarTab] = useState<"presets" | "ai">("presets");

  const renderFormStep4 = () => (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-md bg-muted p-1">
        <Button
          size="sm"
          variant={avatarTab === "presets" ? "default" : "ghost"}
          className="flex-1"
          onClick={() => setAvatarTab("presets")}
        >
          Presets
        </Button>
        <Button
          size="sm"
          variant={avatarTab === "ai" ? "default" : "ghost"}
          className="flex-1"
          onClick={() => setAvatarTab("ai")}
        >
          <Wand2 className="mr-1 h-3 w-3" /> AI Generate
        </Button>
      </div>

      {avatarTab === "presets" && (
        <div className="grid grid-cols-4 gap-2">
          {DICEBEAR_PRESETS.map((preset) => (
            <img
              key={preset.seed}
              src={preset.url}
              alt={preset.seed}
              className={`h-16 w-16 cursor-pointer rounded-full border-2 transition-all ${
                avatarUrl === preset.url
                  ? "border-primary"
                  : "border-transparent hover:border-muted-foreground/30"
              }`}
              onClick={() => setAvatarUrl(preset.url)}
            />
          ))}
        </div>
      )}

      {avatarTab === "ai" && (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="text-sm font-medium">Style</label>
            <Select value={avatarStyle} onValueChange={setAvatarStyle}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="realistic">Realistic</SelectItem>
                <SelectItem value="cartoon">Cartoon</SelectItem>
                <SelectItem value="anime">Anime</SelectItem>
                <SelectItem value="notion-lineart">Notion Line Art</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            onClick={handleGenerateAvatar}
            disabled={isGeneratingAvatar}
          >
            {isGeneratingAvatar ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Wand2 className="mr-1 h-4 w-4" />
            )}
            Generate
          </Button>
        </div>
      )}

      <div className="flex justify-center pt-2">
        <StaffBadgeCard
          displayName={displayName || "New Staff"}
          roleTitle={roleTitle}
          avatarUrl={avatarUrl || undefined}
          mentorName={
            humanMembers.find((m) => m.userId === mentorId)?.displayName ??
            undefined
          }
          persona={persona}
          modelLabel={model.label}
        />
      </div>
    </div>
  );

  // ── Agentic Step 2 ──────────────────────────────────────────────────
  const renderAgenticStep2 = () => (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium">Model</label>
        <Select
          value={model.id}
          onValueChange={(id) => {
            const found = COMMON_STAFF_MODELS.find((m) => m.id === id);
            if (found) setModel(found);
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COMMON_STAFF_MODELS.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="text-sm text-muted-foreground">
        A new AI staff member will be created and will guide the setup process
        in a private DM with you.
      </p>
    </div>
  );

  // ── Recruitment Step 2: JD input ────────────────────────────────────
  const renderRecruitmentStep2 = () => (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium" htmlFor="recruitJobTitle">
          Job Title
        </label>
        <Input
          id="recruitJobTitle"
          value={jobTitle}
          onChange={(e) => setJobTitle(e.target.value)}
          placeholder="e.g. Frontend Engineer"
        />
      </div>
      <div>
        <label className="text-sm font-medium" htmlFor="recruitJd">
          Job Description
        </label>
        <textarea
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          id="recruitJd"
          value={jd}
          onChange={(e) => setJd(e.target.value)}
          placeholder="Optional — describe the role, responsibilities, and requirements..."
          rows={5}
        />
      </div>
    </div>
  );

  // ── Recruitment Step 3: Candidate cards ─────────────────────────────
  const renderRecruitmentStep3 = () => (
    <div className="space-y-4">
      {isGeneratingCandidates && candidates.length === 0 && (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Generating candidates…
        </div>
      )}
      {candidateGenerationError && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {candidateGenerationError}
        </div>
      )}
      {candidates.length > 0 && (
        <div className="space-y-3">
          {candidates.map((c) => {
            const edited = editedCandidates[c.candidateIndex];
            return (
              <StaffBadgeCard
                key={c.candidateIndex}
                displayName={edited?.displayName ?? c.displayName}
                roleTitle={edited?.roleTitle ?? c.roleTitle}
                persona={edited?.persona ?? c.persona}
                selected={selectedCandidate === c.candidateIndex}
                onClick={() => setSelectedCandidate(c.candidateIndex)}
              />
            );
          })}
        </div>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={handleGenerateCandidates}
        disabled={isGeneratingCandidates}
        className="w-full"
      >
        {isGeneratingCandidates ? (
          <Loader2 className="mr-1 h-4 w-4 animate-spin" />
        ) : (
          <Sparkles className="mr-1 h-4 w-4" />
        )}
        {candidates.length > 0 ? "Re-roll" : "Generate Candidates"}
      </Button>
    </div>
  );

  // ── Recruitment Step 4: Model + Mentor ──────────────────────────────
  const renderRecruitmentStep4 = () => {
    const selC = candidates.find((c) => c.candidateIndex === selectedCandidate);
    const edited =
      selectedCandidate != null
        ? editedCandidates[selectedCandidate]
        : undefined;
    return (
      <div className="space-y-4">
        {selC && (
          <div className="flex justify-center pb-2">
            <StaffBadgeCard
              displayName={edited?.displayName ?? selC.displayName}
              roleTitle={edited?.roleTitle ?? selC.roleTitle}
              mentorName={
                humanMembers.find((m) => m.userId === mentorId)?.displayName ??
                undefined
              }
              persona={edited?.persona ?? selC.persona}
              modelLabel={model.label}
            />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium">Mentor</label>
            <Select value={mentorId} onValueChange={setMentorId}>
              <SelectTrigger>
                <SelectValue placeholder="Select mentor..." />
              </SelectTrigger>
              <SelectContent>
                {humanMembers.map((m) => (
                  <SelectItem key={m.userId} value={m.userId}>
                    {m.displayName || m.username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">Model</label>
            <Select
              value={model.id}
              onValueChange={(id) => {
                const found = COMMON_STAFF_MODELS.find((m) => m.id === id);
                if (found) setModel(found);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMMON_STAFF_MODELS.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    );
  };

  // ── Render current step ─────────────────────────────────────────────
  const renderCurrentStep = () => {
    if (step === 1) return renderStep1();
    if (mode === "form") {
      if (step === 2) return renderFormStep2();
      if (step === 3) return renderFormStep3();
      if (step === 4) return renderFormStep4();
    }
    if (mode === "agentic" && step === 2) return renderAgenticStep2();
    if (mode === "recruitment") {
      if (step === 2) return renderRecruitmentStep2();
      if (step === 3) return renderRecruitmentStep3();
      if (step === 4) return renderRecruitmentStep4();
    }
    return null;
  };

  const stepTitle = () => {
    if (step === 1) return "Create AI Staff";
    if (mode === "form") {
      if (step === 2) return "Basic Info";
      if (step === 3) return "Personality";
      if (step === 4) return "Avatar & Preview";
    }
    if (mode === "agentic") return "Agentic Setup";
    if (mode === "recruitment") {
      if (step === 2) return "Job Description";
      if (step === 3) return "Choose a Candidate";
      if (step === 4) return "Finalize";
    }
    return "Create AI Staff";
  };

  const isLastStep = step === totalSteps;
  const canSubmit =
    mode === "form"
      ? canProceedStep2
      : mode === "agentic"
        ? true
        : mode === "recruitment"
          ? selectedCandidate != null
          : false;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) resetForm();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{stepTitle()}</DialogTitle>
          {step > 1 && (
            <p className="text-xs text-muted-foreground">
              Step {step} of {totalSteps}
            </p>
          )}
        </DialogHeader>

        {renderCurrentStep()}

        {formError && <p className="text-sm text-destructive">{formError}</p>}

        {step > 1 && (
          <DialogFooter className="flex justify-between sm:justify-between">
            <Button
              variant="ghost"
              onClick={() => {
                if (step === 2) {
                  setMode(null);
                  setStep(1);
                } else {
                  setStep((s) => s - 1);
                }
              }}
            >
              <ArrowLeft className="mr-1 h-4 w-4" /> Back
            </Button>

            {isLastStep ? (
              mode === "agentic" ? (
                <Button
                  onClick={() => agenticMutation.mutate()}
                  disabled={agenticMutation.isPending}
                >
                  {agenticMutation.isPending && (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  )}
                  Create &amp; Start Bootstrap
                </Button>
              ) : mode === "recruitment" ? (
                <Button
                  onClick={() => recruitmentMutation.mutate()}
                  disabled={!canSubmit || recruitmentMutation.isPending}
                >
                  {recruitmentMutation.isPending && (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  )}
                  Create
                </Button>
              ) : (
                <Button
                  onClick={() => createMutation.mutate()}
                  disabled={!canSubmit || createMutation.isPending}
                >
                  {createMutation.isPending && (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  )}
                  Create
                </Button>
              )
            ) : (
              <Button
                onClick={() => {
                  if (mode === "recruitment" && step === 2) {
                    // Advance to candidate step and kick off generation
                    setStep((s) => s + 1);
                    void handleGenerateCandidates();
                  } else {
                    setStep((s) => s + 1);
                  }
                }}
                disabled={
                  (mode === "form" && step === 2 && !canProceedStep2) ||
                  (mode === "recruitment" &&
                    step === 3 &&
                    isGeneratingCandidates) ||
                  (mode === "recruitment" &&
                    step === 3 &&
                    selectedCandidate === null &&
                    candidates.length > 0)
                }
              >
                {mode === "recruitment" && step === 2 ? (
                  <>
                    Generate Candidates <ArrowRight className="ml-1 h-4 w-4" />
                  </>
                ) : (
                  <>
                    Next <ArrowRight className="ml-1 h-4 w-4" />
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
