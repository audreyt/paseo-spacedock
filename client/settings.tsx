import {
  type PluginSurfaceProps,
  useSettings,
} from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsSection,
} from "@getpaseo/plugin/client/ui";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { spacedockSettings } from "../shared/contracts";

export function SpacedockSettings({ theme }: PluginSurfaceProps) {
  const settings = useSettings(spacedockSettings);
  const [draft, setDraft] = useState({
    binaryPath: "",
    skillsDir: "",
    foProvider: "",
  });
  const seeded = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (settings.status === "ready" && !seeded.current) {
      seeded.current = true;
      setDraft(settings.values);
    }
  }, [settings]);

  if (settings.status !== "ready") {
    return (
      <View style={{ padding: 16 }}>
        <Text style={{ color: theme.colors.foregroundMuted }}>
          {settings.status === "loading" ? "Loading…" : "Settings unavailable."}
        </Text>
      </View>
    );
  }

  return (
    <View>
      <SettingsSection title="Spacedock">
        <SettingsCard>
          <SettingsInput
            label="spacedock binary"
            hint="Absolute path override; defaults to /opt/homebrew/bin/spacedock or PATH"
            placeholder="/opt/homebrew/bin/spacedock"
            initialValue={draft.binaryPath}
            onChangeText={(text) =>
              setDraft((d) => ({ ...d, binaryPath: text }))
            }
          />
          <SettingsInput
            label="Skills directory"
            hint="Directory containing first-officer/SKILL.md (e.g. a spacedock checkout's skills/)"
            placeholder="~/w/spacedock/skills"
            initialValue={draft.skillsDir}
            onChangeText={(text) => setDraft((d) => ({ ...d, skillsDir: text }))}
          />
          <SettingsInput
            label="First-officer provider"
            hint="provider or provider/model for launched first officers; empty = first available"
            placeholder="omp"
            initialValue={draft.foProvider}
            onChangeText={(text) =>
              setDraft((d) => ({ ...d, foProvider: text }))
            }
          />
          <SettingsAction
            label="Save"
            actionLabel={settings.saving ? "Saving…" : "Save"}
            disabled={settings.saving}
            onPress={async () => {
              const ok = await settings.save(draft, settings.revision);
              setNotice(ok ? "Saved." : (settings.saveError ?? "Save failed."));
            }}
          />
        </SettingsCard>
      </SettingsSection>
      {notice ? (
        <View style={{ paddingHorizontal: 16 }}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
            {notice}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
