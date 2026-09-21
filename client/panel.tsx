import {
  type PluginWorkspacePanelProps,
  useRpc,
  useSettings,
  useWorkspace,
} from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import {
  type BootStatus,
  gateRecordRpc,
  judgeGateRpc,
  launchFoRpc,
  type ReadyGate,
  spacedockSettings,
  statusRpc,
} from "../shared/contracts";

type Decision = "approve" | "revise" | "hold";

function GateCard({
  gate,
  workflowDir,
  theme,
  compact,
  bin,
  apiKey,
  baseUrl,
  model,
  onDecided,
}: {
  gate: ReadyGate;
  workflowDir: string;
  theme: PluginWorkspacePanelProps["theme"];
  compact: boolean;
  bin?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  onDecided: () => void;
}) {
  const record = useRpc(gateRecordRpc);
  const judge = useRpc(judgeGateRpc);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<{
    verdict?: string;
    confidence?: number;
    evidence?: number | null;
    risk?: number | null;
  } | null>(null);
  const decide = useMutation({
    mutationFn: (decision: Decision) => {
      const note = verdict?.verdict
        ? `Jev ${verdict.verdict}@${verdict.confidence?.toFixed(2) ?? "?"}`
        : null;
      const text = [reason.trim() || null, note].filter(Boolean).join(" · ");
      return record({
        workflowDir,
        entity: gate.slug || gate.id,
        decision,
        reason: text || undefined,
        consume: decision === "approve",
        bin,
      });
    },
    onSuccess: (result) => {
      if (result.ok) {
        onDecided();
      } else {
        setMessage(result.output || "gate record failed");
      }
    },
    onError: (error) => setMessage(String(error)),
  });
  const askJudge = useMutation({
    mutationFn: () =>
      judge({
        workflowDir,
        entity: gate.slug || gate.id,
        apiKey,
        baseUrl,
        model,
        bin,
      }),
    onSuccess: (result) => {
      if (result.ok) {
        setVerdict(result);
      } else {
        setMessage(result.error ?? "judge failed");
      }
    },
    onError: (error) => setMessage(String(error)),
  });
  const button = (decision: Decision, label: string, accent: boolean) => (
    <Pressable
      key={decision}
      accessibilityRole="button"
      accessibilityLabel={`${label} ${gate.slug}`}
      disabled={decide.isPending}
      onPress={() => decide.mutate(decision)}
      style={{
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 8,
        backgroundColor: accent ? theme.colors.accent : theme.colors.surface2,
      }}
    >
      <Text
        style={{
          color: accent ? theme.colors.accentForeground : theme.colors.foreground,
          fontSize: 13,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
  return (
    <View
      style={{
        backgroundColor: theme.colors.surface1,
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderRadius: 10,
        padding: compact ? 10 : 14,
        gap: 8,
      }}
    >
      <Text style={{ color: theme.colors.foreground, fontSize: 15 }}>
        {gate.slug || gate.id}
      </Text>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
        {gate.current} · {gate.readiness}
      </Text>
      <TextInput
        value={reason}
        onChangeText={setReason}
        placeholder="Reason (optional, recorded with the decision)"
        placeholderTextColor={theme.colors.foregroundMuted}
        style={{
          color: theme.colors.foreground,
          backgroundColor: theme.colors.surface2,
          borderRadius: 8,
          paddingHorizontal: 10,
          paddingVertical: 6,
          fontSize: 13,
        }}
      />
      <View style={{ flexDirection: "row", gap: 8 }}>
        {button("approve", "Approve", true)}
        {button("revise", "Revise", false)}
        {button("hold", "Hold", false)}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Judge ${gate.slug}`}
          disabled={askJudge.isPending}
          onPress={() => askJudge.mutate()}
          style={{
            paddingVertical: 6,
            paddingHorizontal: 12,
            borderRadius: 8,
            backgroundColor: theme.colors.surface2,
          }}
        >
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>
            {askJudge.isPending ? "Judging…" : "Judge"}
          </Text>
        </Pressable>
      </View>
      {verdict?.verdict ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
          Jev suggests {verdict.verdict} (confidence{" "}
          {verdict.confidence?.toFixed(2) ?? "?"}
          {verdict.evidence != null
            ? `, evidence ${verdict.evidence.toFixed(2)}`
            : ""}
          {verdict.risk != null ? `, risk ${verdict.risk.toFixed(2)}` : ""}) —
          captain still decides.
        </Text>
      ) : null}
      {message ? (
        <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>
          {message}
        </Text>
      ) : null}
    </View>
  );
}

function StageChips({
  stages,
  theme,
}: {
  stages: NonNullable<BootStatus["stages"]>;
  theme: PluginWorkspacePanelProps["theme"];
}) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {stages.map((s) => (
        <View
          key={s.name}
          style={{
            flexDirection: "row",
            gap: 4,
            alignItems: "center",
            backgroundColor: theme.colors.surface2,
            borderRadius: 6,
            paddingHorizontal: 8,
            paddingVertical: 4,
          }}
        >
          <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>
            {s.name}
          </Text>
          {s.gate === "true" ? (
            <Text style={{ color: theme.colors.accent, fontSize: 11 }}>gate</Text>
          ) : null}
          {s.worktree === "true" ? (
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
              wt
            </Text>
          ) : null}
          {s.terminal === "true" ? (
            <Text style={{ color: theme.colors.statusSuccess, fontSize: 11 }}>
              term
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

export function SpacedockPanel({
  theme,
  layout,
  workspaceId,
}: PluginWorkspacePanelProps) {
  const directory = useWorkspace(workspaceId, (w) => w.directory);
  const settings = useSettings(spacedockSettings);
  const setting = (
    k:
      | "binaryPath"
      | "skillsDir"
      | "foProvider"
      | "typesafeApiKey"
      | "typesafeBaseUrl"
      | "typesafeModel",
  ) =>
    settings.status === "ready" && settings.values[k].trim()
      ? settings.values[k].trim()
      : undefined;
  const bin = setting("binaryPath");
  const apiKey = setting("typesafeApiKey");
  const baseUrl = setting("typesafeBaseUrl");
  const model = setting("typesafeModel");
  const status = useRpc(statusRpc);
  const launchFo = useRpc(launchFoRpc);
  const queryClient = useQueryClient();
  const [task, setTask] = useState("");
  const [launchMessage, setLaunchMessage] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["spacedock-status", directory, bin],
    queryFn: () => status({ cwd: directory ?? "", bin }),
    enabled: !!directory,
    refetchInterval: 15_000,
  });

  const launch = useMutation({
    mutationFn: () =>
      launchFo({
        workspaceId,
        task: task.trim() || undefined,
        bin,
        provider:
          settings.status === "ready" ? settings.values.foProvider : undefined,
        skillsDir: setting("skillsDir"),
      }),
    onSuccess: (result) => {
      setLaunchMessage(
        result.ok
          ? `First officer launched (${result.agentId})`
          : (result.error ?? "launch failed"),
      );
    },
    onError: (error) => setLaunchMessage(String(error)),
  });

  const styles = useMemo(
    () => ({
      screen: {
        flex: 1,
        backgroundColor: theme.colors.surface0,
      },
      body: {
        padding: layout.compact ? 14 : 22,
        gap: 14,
      },
      heading: { color: theme.colors.foreground, fontSize: 18 },
      section: { color: theme.colors.foregroundMuted, fontSize: 12 },
      card: {
        backgroundColor: theme.colors.surface1,
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderRadius: 10,
        padding: layout.compact ? 10 : 14,
        gap: 6,
      },
      mono: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
        fontFamily: "monospace" as const,
      },
      primary: {
        paddingVertical: 8,
        paddingHorizontal: 14,
        borderRadius: 8,
        backgroundColor: theme.colors.accent,
        alignSelf: "flex-start" as const,
      },
      primaryText: { color: theme.colors.accentForeground, fontSize: 13 },
      input: {
        color: theme.colors.foreground,
        backgroundColor: theme.colors.surface2,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
        fontSize: 13,
      },
    }),
    [theme, layout.compact],
  );

  const data = query.data;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
      <Text style={styles.heading}>Spacedock</Text>
      {query.isPending ? (
        <Text style={styles.section}>Checking for a commissioned workflow…</Text>
      ) : null}
      {data?.found === false ? (
        <View style={styles.card}>
          <Text style={styles.section}>
            {data.error ?? "No commissioned workflow here."}
          </Text>
          <Text style={styles.mono}>{directory}</Text>
        </View>
      ) : null}
      {data?.found ? (
        <>
          <View style={styles.card}>
            <Text style={styles.mono}>{data.workflowDir}</Text>
            <Text style={styles.section}>
              {data.boot.state_backend ?? "?"} · {data.boot.sandbox ?? "?"} ·{" "}
              {data.boot.dispatchable?.length ?? 0} dispatchable ·{" "}
              {data.boot.ready_gates?.length ?? 0} gates ready
            </Text>
          </View>

          {data.boot.stages?.length ? (
            <StageChips stages={data.boot.stages} theme={theme} />
          ) : null}

          <Text style={styles.section}>Gates awaiting the captain</Text>
          {data.boot.ready_gates?.length ? (
            data.boot.ready_gates.map((gate) => (
              <GateCard
                key={gate.id}
                gate={gate}
                workflowDir={data.workflowDir}
                theme={theme}
                compact={layout.compact}
                bin={bin}
                apiKey={apiKey}
                baseUrl={baseUrl}
                model={model}
                onDecided={() =>
                  queryClient.invalidateQueries({
                    queryKey: ["spacedock-status", directory, bin],
                  })
                }
              />
            ))
          ) : (
            <Text style={styles.section}>None.</Text>
          )}

          <Text style={styles.section}>First officer</Text>
          <TextInput
            value={task}
            onChangeText={setTask}
            placeholder="Task for the first officer (optional)"
            placeholderTextColor={theme.colors.foregroundMuted}
            style={styles.input}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Launch first officer"
            disabled={launch.isPending}
            onPress={() => launch.mutate()}
            style={styles.primary}
          >
            <Text style={styles.primaryText}>
              {launch.isPending ? "Launching…" : "Launch first officer"}
            </Text>
          </Pressable>
          {launchMessage ? (
            <Text style={styles.section}>{launchMessage}</Text>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}
