import {
  type PluginClientOpenPanelOptions,
  type PluginSurfaceProps,
  usePaseo,
} from "@getpaseo/plugin/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

type LaunchSurfaceProps = PluginSurfaceProps & {
  openPanel: (id: string, options: PluginClientOpenPanelOptions) => void;
};

export function LaunchSurface({ theme, layout, openPanel }: LaunchSurfaceProps) {
  const paseo = usePaseo();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const projectsQuery = useQuery({
    queryKey: ["paseo-projects"],
    queryFn: () => paseo.projects.list(),
  });
  const projects = projectsQuery.data?.projects ?? [];
  const selected = projects.find((project) => project.projectId === selectedId);

  const launch = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Pick a project");
      const workspace = await paseo.workspaces.create({
        title: title.trim() || undefined,
        source: {
          kind: "directory",
          path: selected.projectRootPath,
          projectId: selected.projectId,
        },
      });
      openPanel("spacedock", { workspaceId: workspace.id });
      return workspace.id;
    },
    onSuccess: (workspaceId) => {
      setMessage(`Opened Spacedock in ${workspaceId}`);
    },
    onError: (error) => setMessage(String(error)),
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
        gap: 8,
      },
      row: {
        paddingVertical: 8,
        paddingHorizontal: 10,
        borderRadius: 8,
        backgroundColor: theme.colors.surface2,
        gap: 2,
      },
      rowSelected: {
        backgroundColor: theme.colors.accent,
      },
      rowTitle: { color: theme.colors.foreground, fontSize: 14 },
      rowTitleSelected: { color: theme.colors.accentForeground, fontSize: 14 },
      rowPath: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
        fontFamily: "monospace" as const,
      },
      rowPathSelected: {
        color: theme.colors.accentForeground,
        fontSize: 12,
        fontFamily: "monospace" as const,
      },
      input: {
        color: theme.colors.foreground,
        backgroundColor: theme.colors.surface2,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
        fontSize: 13,
      },
      primary: {
        paddingVertical: 8,
        paddingHorizontal: 14,
        borderRadius: 8,
        backgroundColor: theme.colors.accent,
        alignSelf: "flex-start" as const,
      },
      primaryText: { color: theme.colors.accentForeground, fontSize: 13 },
    }),
    [theme, layout.compact],
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
      <Text style={styles.heading}>New Spacedock</Text>
      <Text style={styles.section}>
        Creates a workspace and opens the Spacedock panel. No Chat agent, no
        terminal — the built-in New workspace form always starts one of those.
      </Text>

      <View style={styles.card}>
        <Text style={styles.section}>Project</Text>
        {projectsQuery.isPending ? (
          <Text style={styles.section}>Loading projects…</Text>
        ) : null}
        {projectsQuery.isError ? (
          <Text style={styles.section}>{String(projectsQuery.error)}</Text>
        ) : null}
        {projects.length === 0 && !projectsQuery.isPending ? (
          <Text style={styles.section}>
            No projects on this host. Add one in the sidebar first.
          </Text>
        ) : null}
        {projects.map((project) => {
          const active = project.projectId === selectedId;
          const name = project.projectCustomName || project.projectDisplayName;
          return (
            <Pressable
              key={project.projectId}
              accessibilityRole="button"
              accessibilityLabel={`Select project ${name}`}
              accessibilityState={{ selected: active }}
              onPress={() => setSelectedId(project.projectId)}
              style={[styles.row, active ? styles.rowSelected : null]}
            >
              <Text style={active ? styles.rowTitleSelected : styles.rowTitle}>
                {name}
              </Text>
              <Text style={active ? styles.rowPathSelected : styles.rowPath}>
                {project.projectRootPath}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="Workspace title (optional)"
        placeholderTextColor={theme.colors.foregroundMuted}
        style={styles.input}
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Create workspace and open Spacedock"
        disabled={!selected || launch.isPending}
        onPress={() => launch.mutate()}
        style={styles.primary}
      >
        <Text style={styles.primaryText}>
          {launch.isPending ? "Opening…" : "Open Spacedock"}
        </Text>
      </Pressable>
      {message ? <Text style={styles.section}>{message}</Text> : null}
    </ScrollView>
  );
}
