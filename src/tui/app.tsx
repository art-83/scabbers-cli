import {
  configureSetting,
  settingsItems,
  settingsSections,
} from "../config/settings-menu.js";
import { checkNativeBrowser } from "../browser/diagnostics.js";
import { Store } from "../storage/store.js";
import { Configuration } from "../config/configuration.js";
import { join } from "node:path";
import { CredentialStore } from "../integrations/credential-store.js";
import { Mascot } from "./mascot.js";
import { Wordmark } from "./wordmark.js";
import { progress } from "../workflows/progress.js";
import type { View } from "./types/view.js";
import React, { useEffect, useState, useRef } from "react";
import {
  Box,
  Text,
  useApp,
  useInput,
  useWindowSize,
  measureElement,
  type DOMElement,
} from "ink";
import { request } from "../runtime/client.js";
const tabLabels = {
  support: "Bug Triage",
  development: "Bug Fix",
  config: "Config",
} as const;

export function App({ directory }: { directory: string }): React.ReactElement {
  const { exit, suspendTerminal } = useApp();
  const { rows, columns } = useWindowSize();
  const [tab, setTab] = useState<"support" | "development" | "config">(
    "support",
  );
  const [view, setView] = useState<View>();
  const [editing, setEditing] = useState(false);
  const [configMessage, setConfigMessage] = useState("");
  const viewportRef = useRef<DOMElement>(null);
  const contentRef = useRef<DOMElement>(null);
  const [scrollOffset, setScrollOffset] = useState(0);
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
  let configItems = settingsSections.map(
    (key) =>
      ({ key, label: key }) as {
        key: (typeof settingsSections)[number];
        label: string;
      },
  );
  if (view?.settingsFile) {
    try {
      configItems = settingsItems(view.settingsFile);
    } catch {
      /* Keep menu reachable while settings are being corrected. */
    }
  }
  const runs = view?.runs.filter((run) => run.kind === tab) ?? [];
  const selected = runs[Math.min(index, runs.length - 1)];
  useInput((input, key) => {
    if (editing) return;
    if (key.pageUp || key.pageDown) {
      if (viewportRef.current && contentRef.current) {
        const height = measureElement(viewportRef.current).height;
        const maximum = Math.max(
          0,
          measureElement(contentRef.current).height - height,
        );
        setScrollOffset(
          Math.max(
            0,
            Math.min(
              maximum,
              scrollOffset + (key.pageDown ? 1 : -1) * Math.max(1, height - 2),
            ),
          ),
        );
      }
      return;
    }
    if (
      tab === "config" &&
      !activation &&
      !actionsOpen &&
      key.return &&
      view?.settingsFile
    ) {
      setEditing(true);
      setError("");
      void suspendTerminal(async () => {
        const saved = await configureSetting(
          view.settingsFile!,
          configItems[index]!.key,
          undefined,
          new CredentialStore(directory),
          async () => {
            const store = new Store(join(directory, "scabbers.db"));
            try {
              const diagnostic = await checkNativeBrowser(
                store,
                new Configuration(store, view.settingsFile!).get(),
              );
              return `${diagnostic.status}: ${diagnostic.origin} · ${diagnostic.summary}`;
            } finally {
              store.close();
            }
          },
        );
        setConfigMessage(
          saved
            ? "Settings saved. Runtime applies changes when active stages finish."
            : "No settings changes saved.",
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
    if (tab === "config" && (key.downArrow || key.upArrow)) {
      setIndex(
        Math.max(
          0,
          Math.min(configItems.length - 1, index + (key.downArrow ? 1 : -1)),
        ),
      );
      return;
    }
    if (key.return && selected) {
      setActionIndex(0);
      setActionsOpen(true);
      return;
    }
    if (input === "e") {
      setScrollOffset(0);
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
      setScrollOffset(0);
      setIndex(0);
    }
    if (key.downArrow) setIndex(Math.min(index + 1, runs.length - 1));
    if (key.upArrow) setIndex(Math.max(index - 1, 0));
  });
  return (
    <Box flexDirection="column" paddingX={1} height={rows} width={columns}>
      <Box
        ref={viewportRef}
        flexDirection="column"
        flexGrow={1}
        flexShrink={1}
        overflowY="hidden"
      >
        <Box
          ref={contentRef}
          flexDirection="column"
          flexShrink={0}
          marginTop={-scrollOffset}
        >
          <Box
            borderStyle="round"
            borderColor="magenta"
            paddingX={2}
            justifyContent="space-between"
            flexShrink={0}
          >
            <Box alignItems="center" gap={1}>
              <Mascot />
              <Wordmark compact={columns < 80} />
            </Box>
            <Box flexDirection="column" flexShrink={0}>
              <Text bold color={view?.remoteEnabled ? "green" : "yellow"}>
                {view?.remoteEnabled ? "AUTOMATION ACTIVE" : "AUTOMATION OFF"}
              </Text>
              {(["Slack", "Jira", "GitLab"] as const).map((name) => {
                const health = view?.integrations?.find(
                  (item) => item.name === name,
                );
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
          </Box>
          <Box marginY={1} justifyContent="space-between" flexShrink={0}>
            <Box gap={4}>
              <Text bold color={tab === "support" ? "#A78BFA" : "gray"}>
                {tab === "support" ? "▸ " : "  "}
                {tabLabels.support}
              </Text>
              <Text bold color={tab === "development" ? "#A78BFA" : "gray"}>
                {tab === "development" ? "▸ " : "  "}
                {tabLabels.development}
              </Text>
            </Box>
            <Text
              dimColor={tab !== "config"}
              color={tab === "config" ? "#A78BFA" : "gray"}
            >
              {tab === "config" ? "▸ " : ""}Config
            </Text>
          </Box>
          {activation && (
            <Box
              flexDirection="column"
              borderStyle="double"
              borderColor="yellow"
              paddingX={1}
            >
              <Text bold>Review automation activation</Text>
              <Text>↑ ↓ select · Enter confirm · Esc return</Text>
              <Text
                color={activationIndex === 0 ? "#A78BFA" : "gray"}
                bold={activationIndex === 0}
              >
                {activationIndex === 0 ? "›" : " "} Return without activation
              </Text>
              <Text
                color={activationIndex === 1 ? "#A78BFA" : "gray"}
                bold={activationIndex === 1}
              >
                {activationIndex === 1 ? "›" : " "} Activate automation with
                these settings
              </Text>

              <Text>
                Support will read reports in the configured windows, backfill
                missed reports, apply objective Jira routing and post
                conclusions. Development may investigate with engines/JEV;
                publication requires its own concrete private review. Decisions
                and reminders go to the configured Slack owner. Totem/SmartPOS
                and production changes remain excluded.
              </Text>
              <Text>{JSON.stringify(view?.activation, null, 2)}</Text>
            </Box>
          )}
          {view?.settingsFile && tab !== "config" && (
            <Text dimColor>
              Settings: {view.settingsFile}
              {view.settingsPending
                ? " · waiting for active stages before reload"
                : ""}
            </Text>
          )}
          {!view?.profile && tab !== "config" && (
            <Text color="yellow">
              First setup pending. Run scabbers --configure to select sources,
              configure your schedule and review SOUL.
            </Text>
          )}
          {tab === "config" ? (
            <Box
              flexDirection="column"
              borderStyle="round"
              borderColor="#A78BFA"
              paddingX={1}
            >
              <Text bold color="magenta">
                Configuration
              </Text>
              {view?.soulFile && <Text dimColor>SOUL: {view.soulFile}</Text>}
              {view?.logging && (
                <Text dimColor>
                  Text logs: {view.logging.directory} ·{" "}
                  {view.logging.retentionDays} days
                </Text>
              )}
              {view?.logging?.error && (
                <Text color="red">{view.logging.error}</Text>
              )}
              <Text dimColor>
                ↑/↓ Select a setting · Enter Edit · save or discard in the menu
              </Text>
              {configItems
                .slice(
                  Math.max(0, index - Math.max(1, rows - 23)),
                  Math.max(Math.max(3, rows - 19), index + 1),
                )
                .map((item) => (
                  <Text
                    key={item.key}
                    color={
                      configItems[index]?.key === item.key ? "#A78BFA" : "gray"
                    }
                    bold={configItems[index]?.key === item.key}
                  >
                    {configItems[index]?.key === item.key ? "›" : " "}{" "}
                    {item.label}
                  </Text>
                ))}
              <Text dimColor>
                Integrations have separate connection settings and hidden token
                entry.
              </Text>
              {configItems[index]?.key === "browser" &&
                view?.browserDiagnostic && (
                  <Text
                    color={
                      view.browserDiagnostic.status === "connected"
                        ? "green"
                        : view.browserDiagnostic.status === "blocked"
                          ? "red"
                          : "yellow"
                    }
                  >
                    Browser: {view.browserDiagnostic.status} ·{" "}
                    {view.browserDiagnostic.origin} ·{" "}
                    {view.browserDiagnostic.summary}
                  </Text>
                )}
              {configMessage && <Text color="green">{configMessage}</Text>}
            </Box>
          ) : runs.length === 0 ? (
            <Box borderStyle="single" borderColor="gray" padding={1}>
              <Text dimColor>
                No executions in {tabLabels[tab]}. Configure connections and
                review settings before enabling intake.
              </Text>
            </Box>
          ) : (
            <Box flexDirection="column">
              {runs
                .slice(Math.max(0, index - 5), Math.max(8, index + 1))
                .map((run) => (
                  <Box key={run.id} gap={2}>
                    <Text color={run.id === selected?.id ? "#A78BFA" : "white"}>
                      {run.id === selected?.id ? "›" : " "}{" "}
                      {run.source.slice(0, 40).padEnd(40)}
                    </Text>
                    <Text
                      color={
                        run.error ? "red" : run.paused ? "yellow" : "green"
                      }
                    >
                      {run.error
                        ? "blocked"
                        : run.paused
                          ? "paused"
                          : run.state}
                    </Text>
                    <Text dimColor>
                      {progress(run)} · {run.engine} · {run.id.slice(0, 8)}
                    </Text>
                  </Box>
                ))}
            </Box>
          )}
          {actionsOpen && (
            <Box
              flexDirection="column"
              borderStyle="round"
              borderColor="#A78BFA"
            >
              <Text>
                Execution actions · ↑ ↓ select · Enter confirm · Esc return
              </Text>
              {actions.map((label, i) => (
                <Text
                  key={label}
                  color={
                    actionIndex === i
                      ? "#A78BFA"
                      : label === "Cancel"
                        ? "red"
                        : "gray"
                  }
                  bold={actionIndex === i}
                >
                  {actionIndex === i ? "›" : " "} {label}
                </Text>
              ))}
            </Box>
          )}
          {selected && (
            <Box
              flexDirection="column"
              borderStyle="round"
              borderColor="#A78BFA"
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
                .filter(
                  (d) => d.runId === selected.id && d.status === "pending",
                )
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
        </Box>
      </Box>
      <Box
        flexShrink={0}
        flexWrap="wrap"
        borderStyle="single"
        borderTop
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
        paddingTop={1}
      >
        {(activation || actionsOpen
          ? ["↑/↓ Select", "Enter Confirm", "Esc Return", "PgUp/PgDn Scroll"]
          : [
              "Tab Next tab",
              "←/→ Switch tab",
              "↑/↓ Select",
              `Enter ${tab === "config" ? "Edit setting" : "Actions"}`,
              "PgUp/PgDn Scroll",
              "e Automation",
              "q Detach",
            ]
        ).map((hint, i, hints) => (
          <Box key={hint} marginRight={1}>
            <Text>
              <Text bold color="#A78BFA">
                {hint.split(" ")[0]}
              </Text>
              <Text dimColor> {hint.slice(hint.indexOf(" ") + 1)}</Text>
              <Text color="gray">{i < hints.length - 1 ? " │" : ""}</Text>
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
