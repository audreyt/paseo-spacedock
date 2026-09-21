import {
  type PluginTimelineItemProps,
  useRpc,
  useSettings,
} from "@getpaseo/plugin/client";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  type GatesTimelineData,
  gateRecordRpc,
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
  const [verdicts, setVerdicts] = useState<Record<string, string>>({});
  const decide = useMutation({
    mutationFn: (input: { entity: string; decision: Decision }) =>
      record({
        workflowDir: item.data.workflowDir,
        entity: input.entity,
        decision: input.decision,
        consume: input.decision === "approve",
        agentId,
      }),
    onError: (e) => setError(String(e)),
    onSuccess: (result) => {
      if (!result.ok) setError(result.output || "gate record failed");
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
        setVerdicts((v) => ({
          ...v,
          [entity]: `${result.verdict}@${result.confidence?.toFixed(2) ?? "?"}`,
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
        {gates.length} gate{gates.length === 1 ? "" : "s"} await the captain
      </Text>
      {gates.map((gate) => (
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
            {gate.slug || gate.id} · {gate.readiness}
          </Text>
          {(
            [
              ["approve", "Approve"],
              ["revise", "Revise"],
              ["hold", "Hold"],
            ] as const
          ).map(([decision, label]) => (
            <Pressable
              key={decision}
              accessibilityRole="button"
              accessibilityLabel={`${label} ${gate.slug}`}
              disabled={decide.isPending}
              onPress={() => decide.mutate({ entity: gate.slug || gate.id, decision })}
              style={{
                paddingVertical: 4,
                paddingHorizontal: 10,
                borderRadius: 6,
                backgroundColor:
                  decision === "approve"
                    ? theme.colors.accent
                    : theme.colors.surface2,
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
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Judge ${gate.slug}`}
            disabled={askJudge.isPending}
            onPress={() => askJudge.mutate(gate.slug || gate.id)}
            style={{
              paddingVertical: 4,
              paddingHorizontal: 10,
              borderRadius: 6,
              backgroundColor: theme.colors.surface2,
            }}
          >
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
              Judge
            </Text>
          </Pressable>
          {verdicts[gate.slug || gate.id] ? (
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
              Jev: {verdicts[gate.slug || gate.id]}
            </Text>
          ) : null}
        </View>
      ))}
      {error ? (
        <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
