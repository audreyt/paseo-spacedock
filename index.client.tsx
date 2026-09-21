import type { PluginClientContext } from "@getpaseo/plugin/client";
import { SpacedockPanel } from "./client/panel";
import { SpacedockSettings } from "./client/settings";
import { GatesCard } from "./client/timeline";
import { gatesTimelineData } from "./shared/contracts";

export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({
    id: "spacedock",
    title: "Spacedock",
    icon: "Anchor",
    context: "workspace",
    Component: SpacedockPanel,
  });

  client.addCommandCenterItem({
    id: "spacedock-open",
    title: "Open Spacedock",
    icon: "Anchor",
    keywords: ["gate", "workflow", "first officer"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("spacedock");
    },
  });

  client.addSlashCommand({
    name: "spacedock",
    description: "Open the Spacedock workflow panel",
    argumentHint: "",
    context: "workspace",
    onSubmit({ openPanel }) {
      openPanel("spacedock");
    },
  });

  client.addTimelineRenderer({
    kind: "spacedock-gates",
    version: 1,
    schema: gatesTimelineData,
    Component: GatesCard,
  });

  client.addSettingsScreen({
    id: "spacedock",
    title: "Spacedock",
    icon: "Anchor",
    Component: SpacedockSettings,
  });

  return () => {};
}
