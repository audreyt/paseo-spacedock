import {
  type PluginTimelineItemProps,
  useRpc,
  useSettings,
} from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import {
  type GatesTimelineData,
  gateRecordRpc,
  gatesRpc,
  judgeGateRpc,
  spacedockSettings,
} from "../shared/contracts";

type Decision = "approve" | "revise" | "hold";

export function GatesCard({
  item,
  theme,
  agentId,
}: PluginTimelineItemProps<GatesTimelineData>) {
  const record = useRpc(gateRecordRpc);
  const judge = useRpc(judgeGateRpc);
  const settings = useSettings(spacedockSettings);
  const [error, setError] = useState<string | null>(null);
  const [verdicts, setVerdicts] = useState<
    Record<string, { model?: string; text: string }>
  >({});
  const refresh = useRpc(gatesRpc);
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [done, setDone] = useState<Record<string, string>>({});
  const freshQuery = useQuery({
    queryKey: ["spacedock-gates", item.data.workflowDir],
    queryFn: () => refresh({ workflowDir: item.data.workflowDir }),
    refetchInterval: 15_000,
  });
  const live = freshQuery.data
    ? new Set(freshQuery.data.gates.map((g) => g.slug || g.id))
    : null;
  const currentOf = freshQuery.data?.currentOf ?? {};
  const decide = useMutation({
    mutationFn: (input: { entity: string; decision: Decision }) =>
      record({
        workflowDir: item.data.workflowDir,
        entity: input.entity,
        decision: input.decision,
        reason: reason.trim() || undefined,
        consume: input.decision === "approve",
        agentId,
      }),
    onError: (e) => setError(String(e)),
    onSuccess: (result, input) => {
      if (result.ok) {
        setDone((d) => ({ ...d, [input.entity]: input.decision }));
        queryClient.invalidateQueries({
          queryKey: ["spacedock-gates", item.data.workflowDir],
        });
      } else {
        setError(result.output || "gate record failed");
      }
    },
  });
  const askJudge = useMutation({
    mutationFn: (entity: string) =>
      judge({
        workflowDir: item.data.workflowDir,
        entity,
        apiKey:
          settings.status === "ready" && settings.values.typesafeApiKey.trim()
            ? settings.values.typesafeApiKey.trim()
            : undefined,
        baseUrl:
          settings.status === "ready" && settings.values.typesafeBaseUrl.trim()
            ? settings.values.typesafeBaseUrl.trim()
            : undefined,
        model:
          settings.status === "ready" && settings.values.typesafeModel.trim()
            ? settings.values.typesafeModel.trim()
            : undefined,
      }),
    onSuccess: (result, entity) => {
      if (result.ok && result.verdict) {
        const stamp = result.stamp
          ? result.stamp
          : `${result.verdict}@${result.confidence?.toFixed(2) ?? "?"}`;
        const policy = result.policy ? ` · ${result.policy.text}` : "";
        setVerdicts((v) => ({
          ...v,
          [entity]: { model: result.model, text: `${stamp}${policy}` },
        }));
      } else if (!result.ok) {
        setError(result.error ?? "judge failed");
      }
    },
    onError: (e) => setError(String(e)),
  });

  const gates = item.data.gates;
  if (gates.length === 0) return null;

  return (
    <View
      style={{
        backgroundColor: theme.colors.surface1,
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderRadius: 10,
        padding: 12,
        gap: 8,
      }}
    >
      <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>
        {gates.length} gate{gates.length === 1 ? " awaits" : "s await"} the
        captain
      </Text>
      <TextInput
        value={reason}
        onChangeText={setReason}
        placeholder="Reason (required for Revise / Hold)"
        placeholderTextColor={theme.colors.foregroundMuted}
        style={{
          color: theme.colors.foreground,
          backgroundColor: theme.colors.surface2,
          borderRadius: 6,
          paddingHorizontal: 10,
          paddingVertical: 6,
          fontSize: 12,
        }}
      />
      {gates.map((gate) => {
        const key = gate.slug || gate.id;
        const recorded = done[key];
        const stale = live ? !live.has(key) : false;
        return (
          <View
            key={gate.id}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <Text
              style={{
                color: theme.colors.foreground,
                fontSize: 12,
                flexShrink: 1,
              }}
            >
              {key} ·{" "}
              {stale
                ? `now at ${currentOf[key] ?? "?"} — no gate waiting`
                : gate.readiness}
            </Text>
            {recorded ? (
              <Text
                style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}
              >
                ✓ {recorded} recorded
              </Text>
            ) : stale ? null : (
              <>
                {(
                  [
                    ["approve", "Approve"],
                    ["revise", "Revise"],
                    ["hold", "Hold"],
                  ] as const
                ).map(([decision, label]) => {
                  const needsReason =
                    decision !== "approve" && !reason.trim();
                  const disabled = decide.isPending || needsReason;
                  return (
                    <Pressable
                      key={decision}
                      accessibilityRole="button"
                      accessibilityLabel={`${label} ${gate.slug}`}
                      disabled={disabled}
                      onPress={() => decide.mutate({ entity: key, decision })}
                      style={{
                        paddingVertical: 4,
                        paddingHorizontal: 10,
                        borderRadius: 6,
                        backgroundColor:
                          decision === "approve"
                            ? theme.colors.accent
                            : theme.colors.surface2,
                        opacity: disabled ? 0.5 : 1,
                      }}
                    >
                      <Text
                        style={{
                          color:
                            decision === "approve"
                              ? theme.colors.accentForeground
                              : theme.colors.foreground,
                          fontSize: 12,
                        }}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Judge ${gate.slug}`}
                  disabled={askJudge.isPending}
                  onPress={() => askJudge.mutate(key)}
                  style={{
                    paddingVertical: 4,
                    paddingHorizontal: 10,
                    borderRadius: 6,
                    backgroundColor: theme.colors.surface2,
                  }}
                >
                  <Text
                    style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}
                  >
                    Judge
                  </Text>
                </Pressable>
              </>
            )}
            {verdicts[key] ? (
              <Text
                style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}
              >
                {verdicts[key].model ?? "judge"}: {verdicts[key].text}
              </Text>
            ) : null}
          </View>
        );
      })}
      {error ? (
        <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
