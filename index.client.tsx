// Public domain under CC0 1.0. See LICENSE and PATENTS.md.
// SPDX-FileCopyrightText: NONE
// SPDX-License-Identifier: CC0-1.0

import type { PluginClientContext } from "@getpaseo/plugin/client";
import { LaunchSurface } from "./client/launch";
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
    locations: ["workspace", "explorer"],
    Component: SpacedockPanel,
  });

  client.addSurface("new-spacedock", (props) => (
    <LaunchSurface {...props} openPanel={client.openPanel.bind(client)} />
  ));
  client.addSidebarItem({
    id: "new-spacedock",
    title: "New Spacedock",
    icon: "Anchor",
    surface: "new-spacedock",
  });
  client.addCommandCenterItem({
    id: "spacedock-new",
    title: "New Spacedock",
    icon: "Anchor",
    keywords: ["gate", "workflow", "first officer", "launch", "new workspace"],
    context: "global",
    onSelect({ openSurface }) {
      openSurface("new-spacedock");
    },
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
