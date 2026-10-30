import { editSettings } from "../config/edit-settings.js";
import { Mascot } from "./mascot.js";
import { progress } from "../workflows/progress.js";
import type { View } from "./types/view.js";
import React, { useEffect, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { request } from "../runtime/client.js";
export function App({ directory }: { directory: string }): React.ReactElement {
  const { exit, suspendTerminal } = useApp();
  const [tab, setTab] = useState<"support" | "development" | "config">(
    "support",
  );
  const [view, setView] = useState<View>();
  const [editing, setEditing] = useState(false);
  const [configMessage, setConfigMessage] = useState("");
  const [index, setIndex] = useState(0);
  const [error, setError] = useState("");
  const [activation, setActivation] = useState(false);
  const [activationIndex, setActivationIndex] = useState(0);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [actionIndex, setActionIndex] = useState(0);
  const actions = ["Return", "Pause", "Resume", "Cancel"] as const;
  const refresh = () =>
    request(directory, { action: "status" })
      .then(setView)
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 1000);
    return () => clearInterval(timer);
  }, []);
  const runs = view?.runs.filter((run) => run.kind === tab) ?? [];
  const selected = runs[Math.min(index, runs.length - 1)];
  useInput((input, key) => {
    if (editing) return;
    if (tab === "config" && key.return && view?.settingsFile) {
      setEditing(true);
      setError("");
      void suspendTerminal(async () => {
        const saved = await editSettings(view.settingsFile!);
        setConfigMessage(
          saved
            ? "Settings saved. Runtime applies changes when active stages finish."
            : "Changes discarded. Settings unchanged.",
        );
      })
        .catch((e: Error) => setError(e.message))
        .finally(() => {
          setEditing(false);
          void refresh();
        });
      return;
    }
    if (activation) {
      if (key.upArrow || key.downArrow) setActivationIndex(1 - activationIndex);
      if (key.return && activationIndex === 0) setActivation(false);
      if (key.return && activationIndex === 1 && view)
        void request(directory, {
          action: "activate",
          digest: view.activation.digest,
        })
          .then(() => {
            setActivation(false);
            void refresh();
          })
          .catch((e: Error) => setError(e.message));
      if (key.escape) setActivation(false);
      return;
    }
    if (actionsOpen) {
      if (key.escape) setActionsOpen(false);
      if (key.downArrow) setActionIndex((actionIndex + 1) % actions.length);
      if (key.upArrow)
        setActionIndex((actionIndex + actions.length - 1) % actions.length);
      if (key.return) {
        setActionsOpen(false);
        const action = [undefined, "pause", "resume", "cancel"][actionIndex] as
          "pause" | "resume" | "cancel" | undefined;
        if (action && selected)
          void request(directory, { action, id: selected.id })
            .then(() => {
              setError("");
              void refresh();
            })
            .catch((e: Error) => setError(e.message));
      }
      return;
    }
    if (key.return && selected) {
      setActionIndex(0);
      setActionsOpen(true);
      return;
    }
    if (input === "e") {
      setActivationIndex(0);
      setActivation(true);
      return;
    }
    if (input === "q" || (key.ctrl && input === "c")) {
      exit();
      return;
    }
    if (key.tab || key.leftArrow || key.rightArrow) {
      const tabs = ["support", "development", "config"] as const;
      const offset = key.leftArrow || key.shift ? -1 : 1;
      setTab(tabs[(tabs.indexOf(tab) + offset + tabs.length) % tabs.length]!);
      setIndex(0);
    }
    if (key.downArrow) setIndex(Math.min(index + 1, runs.length - 1));
    if (key.upArrow) setIndex(Math.max(index - 1, 0));
  });
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box
        borderStyle="round"
        borderColor="magenta"
        paddingX={2}
        justifyContent="space-between"
      >
        <Box alignItems="center" gap={2}>
          <Mascot />
          <Text bold color="magenta">
            SCABBERS · NOLA
          </Text>
        </Box>
        <Text color={view?.remoteEnabled ? "green" : "yellow"}>
          {view?.remoteEnabled ? "AUTOMATION ACTIVE" : "AUTOMATION OFF"}
        </Text>
      </Box>
      <Box gap={4} marginY={1}>
        <Text bold color={tab === "support" ? "cyan" : "gray"}>
          Support
        </Text>
        <Text bold color={tab === "development" ? "cyan" : "gray"}>
          Development
        </Text>
        <Text bold color={tab === "config" ? "cyan" : "gray"}>
          Config
        </Text>
        <Text dimColor>
          engine {view?.engine ?? "…"} · workers {view?.workers ?? "…"} · daemon{" "}
          {view?.pid ?? "…"}
        </Text>
      </Box>
      <Box gap={3} marginBottom={1}>
        {(["Slack", "Jira", "GitLab"] as const).map((name) => {
          const health = view?.integrations?.find((item) => item.name === name);
          const status = health?.status ?? "checking";
          return (
            <Text
              key={name}
              color={
                status === "connected"
                  ? "green"
                  : status === "disconnected"
                    ? "red"
                    : "yellow"
              }
            >
              {status === "connected"
                ? "✓"
                : status === "disconnected"
                  ? "✗"
                  : "…"}{" "}
              {name}:{" "}
              {status === "connected"
                ? "Connected"
                : status === "disconnected"
                  ? "Not connected"
                  : "Checking"}
            </Text>
          );
        })}
      </Box>
      {activation && (
        <Box
          flexDirection="column"
          borderStyle="double"
          borderColor="yellow"
          paddingX={1}
        >
          <Text bold>Review automation activation</Text>
          <Text>
            Support will read reports in the configured windows, backfill missed
            reports, apply objective Jira routing and post conclusions.
            Development may investigate with engines/JEV; publication requires
            its own concrete private review. Decisions and reminders go to the
            configured Slack owner. Totem/SmartPOS and production changes remain
            excluded.
          </Text>
          <Text>{JSON.stringify(view?.activation, null, 2)}</Text>
          <Text>↑ ↓ select · Enter confirm · Esc return</Text>
          <Text color={activationIndex === 0 ? "cyan" : "white"}>
            {activationIndex === 0 ? "›" : " "} Return without activation
          </Text>
          <Text color={activationIndex === 1 ? "cyan" : "white"}>
            {activationIndex === 1 ? "›" : " "} Activate automation with these
            settings
          </Text>
        </Box>
      )}
      {view?.settingsFile && (
        <Text dimColor>
          Settings: {view.settingsFile}
          {view.settingsPending
            ? " · waiting for active stages before reload"
            : ""}
        </Text>
      )}
      {!view?.profile && (
        <Text color="yellow">
          First setup pending. Run scabbers --configure to select sources,
          configure your schedule and review SOUL.
        </Text>
      )}
      {tab === "config" ? (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="cyan"
          paddingX={1}
        >
          <Text bold>Edit settings.json</Text>
          <Text dimColor>
            Read-only connection checks refresh every minute, independently of
            automation.
          </Text>
          {view?.integrations?.map((health) => (
            <Text
              key={health.name}
              color={
                health.status === "connected"
                  ? "green"
                  : health.status === "disconnected"
                    ? "red"
                    : "yellow"
              }
            >
              {health.name}: {health.detail}
              {health.checkedAt
                ? ` · checked ${new Date(health.checkedAt).toLocaleTimeString()}`
                : ""}
            </Text>
          ))}
          <Text>
            Enter opens the JSON in your terminal editor (EDITOR/VISUAL, default
            nano).
          </Text>
          <Text>
            Close the editor to validate, then select Save, Edit or Discard with
            arrows and Enter.
          </Text>
          <Text>
            Invalid JSON is kept in the draft for correction. Saved settings
            apply after active stages finish.
          </Text>
          <Text dimColor>{view?.settingsFile ?? "Loading settings path…"}</Text>
          {configMessage && <Text color="green">{configMessage}</Text>}
        </Box>
      ) : runs.length === 0 ? (
        <Box borderStyle="single" borderColor="gray" padding={1}>
          <Text dimColor>
            No executions in {tab}. Configure connections and review settings
            before enabling intake.
          </Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {runs
            .slice(Math.max(0, index - 5), Math.max(8, index + 1))
            .map((run) => (
              <Box key={run.id} gap={2}>
                <Text color={run.id === selected?.id ? "cyan" : "white"}>
                  {run.id === selected?.id ? "›" : " "}{" "}
                  {run.source.slice(0, 40).padEnd(40)}
                </Text>
                <Text
                  color={run.error ? "red" : run.paused ? "yellow" : "green"}
                >
                  {run.error ? "blocked" : run.paused ? "paused" : run.state}
                </Text>
                <Text dimColor>
                  {progress(run)} · {run.engine} · {run.id.slice(0, 8)}
                </Text>
              </Box>
            ))}
        </Box>
      )}
      {actionsOpen && (
        <Box flexDirection="column" borderStyle="round" borderColor="cyan">
          <Text>
            Execution actions · ↑ ↓ select · Enter confirm · Esc return
          </Text>
          {actions.map((label, i) => (
            <Text key={label} color={actionIndex === i ? "cyan" : "white"}>
              {actionIndex === i ? "›" : " "} {label}
            </Text>
          ))}
        </Box>
      )}
      {selected && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="cyan"
          paddingX={1}
          marginTop={1}
        >
          <Text bold>
            {selected.source} · stage {selected.state}
          </Text>
          <Text dimColor>
            Profile {selected.profileVersion.slice(0, 12)} · native session{" "}
            {selected.sessionId ?? "not started"}
          </Text>
          {selected.error && <Text color="red">{selected.error}</Text>}
          {view?.decisions
            .filter((d) => d.runId === selected.id && d.status === "pending")
            .map((d, i) => (
              <Text key={i} color="yellow">
                Private decision: {d.question}
              </Text>
            ))}
          {selected.logs.map((line, i) => (
            <Text key={i} dimColor>
              {line}
            </Text>
          ))}
        </Box>
      )}
      {(error || view?.settingsError || view?.runtimeError) && (
        <Text color="red">
          {error || view?.settingsError || view?.runtimeError}
        </Text>
      )}
      <Box marginTop={1}>
        <Text dimColor>
          Tab ← → switch · ↑ ↓ select · Enter{" "}
          {tab === "config" ? "edit JSON" : "actions"} · e review
          settings/activation · q detach (work continues)
        </Text>
      </Box>
    </Box>
  );
}
