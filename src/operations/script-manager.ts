import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  lstatSync,
  mkdtempSync,
  realpathSync,
} from "node:fs";
import { join, dirname, resolve } from "node:path";
import { ProcessRunner } from "../runtime/process-runner.js";
import { redactLog, LogRedactor } from "../logging/log-redactor.js";
import type { Run } from "../workflows/types/run.js";
import type { OperationalScripts } from "./abstractions/interface/scripts.js";
import type {
  OperationalArtifacts,
  OperationalPlan,
  OperationalImplementation,
  OperationalCommandResult,
} from "./types/operation.js";
import { OperationalIdentity } from "./plan-identity.js";
import {
  operationalImplementationSchema,
  operationalChecksSchema,
} from "./implementation-schema.js";
import type { OperationalApprovals } from "./approvals.js";

export class OperationalScriptManager implements OperationalScripts {
  constructor(
    private readonly directory: string,
    private readonly approvals: OperationalApprovals,
    private readonly runner = new ProcessRunner(),
  ) {}
  prepare(
    run: Run,
    plan: OperationalPlan,
    input: OperationalImplementation,
  ): OperationalArtifacts {
    const bundle = operationalImplementationSchema.parse(input);
    if (this.approvals.answer(run, "plan") !== this.approvals.option("plan"))
      throw new Error(
        "Explicit plan approval required before artifact creation",
      );
    new OperationalIdentity().assertCredentialFree(bundle);
    if (
      plan.mode === "script" &&
      ["preflight.sh", "execute.sh", "verify.sh", "tests.sh"].some(
        (p) => !bundle.files.some((f) => f.path === p),
      )
    )
      throw new Error(
        "Script implementation requires reviewed preflight.sh, execute.sh, verify.sh and tests.sh",
      );
    const digest = new OperationalIdentity().implementation(plan, bundle);
    if (!/^[a-f0-9-]{36}$/.test(run.id))
      throw new Error("Invalid operational run identity");
    const directory = join(this.directory, "operations", run.id, digest);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    for (const file of bundle.files) {
      const path = join(directory, file.path);
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      try {
        writeFileSync(path, file.content, { flag: "wx", mode: 0o600 });
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== "EEXIST" ||
          lstatSync(path).isSymbolicLink() ||
          readFileSync(path, "utf8") !== file.content
        )
          throw new Error(
            "Operational artifacts changed; prepare a new reviewed revision",
          );
      }
    }
    return { directory, digest, files: bundle.files.map((file) => file.path) };
  }
  inspect(
    plan: OperationalPlan,
    bundle: OperationalImplementation,
    artifacts: OperationalArtifacts,
  ): void {
    if (
      artifacts.digest !==
      new OperationalIdentity().implementation(plan, bundle)
    )
      throw new Error("Operational implementation digest changed");
    const base = resolve(this.directory, "operations");
    if (!resolve(artifacts.directory).startsWith(base + "/"))
      throw new Error("Operational artifacts escaped private storage");
    const realDirectory = realpathSync(artifacts.directory);
    if (
      !realDirectory.startsWith(realpathSync(base) + "/") ||
      artifacts.files.join("\n") !== bundle.files.map((f) => f.path).join("\n")
    )
      throw new Error("Operational artifact manifest or storage changed");
    for (const file of operationalImplementationSchema.parse(bundle).files) {
      const path = join(artifacts.directory, file.path);
      const info = lstatSync(path);
      if (
        realpathSync(path) !== join(realDirectory, file.path) ||
        !info.isFile() ||
        info.isSymbolicLink() ||
        readFileSync(path, "utf8") !== file.content
      )
        throw new Error("Operational artifact changed after review");
    }
  }
  async test(
    artifacts: OperationalArtifacts,
    signal: AbortSignal,
  ): Promise<OperationalCommandResult> {
    const testDirectory = mkdtempSync(
      join(dirname(artifacts.directory), "unit-"),
    );
    for (const relative of artifacts.files) {
      const target = join(testDirectory, relative);
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      writeFileSync(target, readFileSync(join(artifacts.directory, relative)), {
        mode: 0o600,
      });
    }
    // Unreviewed test code has no network, host HOME, credentials, state database or writable host root.
    return this.run(
      "bwrap",
      [
        "--die-with-parent",
        "--unshare-all",
        "--new-session",
        "--ro-bind",
        "/usr",
        "/usr",
        "--symlink",
        "usr/bin",
        "/bin",
        "--symlink",
        "usr/lib",
        "/lib",
        "--symlink",
        "usr/lib",
        "/lib64",
        "--proc",
        "/proc",
        "--dev",
        "/dev",
        "--tmpfs",
        "/tmp",
        "--dir",
        "/home",
        "--dir",
        "/home/scabbers",
        "--bind",
        testDirectory,
        "/work",
        "--chdir",
        "/work",
        "--clearenv",
        "--setenv",
        "HOME",
        "/home/scabbers",
        "--setenv",
        "PATH",
        "/usr/bin:/bin",
        "--setenv",
        "PYTHONDONTWRITEBYTECODE",
        "1",
        "/bin/bash",
        "--noprofile",
        "--norc",
        "./tests.sh",
      ],
      testDirectory,
      signal,
      {},
    );
  }
  async execute(
    run: Run,
    signal: AbortSignal,
  ): Promise<OperationalCommandResult> {
    this.approvals.assertExecution(run);
    signal.throwIfAborted();
    const plan = run.data.operationalPlan as OperationalPlan,
      bundle = run.data.operationalImplementation as OperationalImplementation,
      artifacts = run.data.operationalArtifacts as OperationalArtifacts;
    const receipt = run.data.operationalExecution as
      { status?: string; digest?: string } | undefined;
    if (
      run.state !== "executing" ||
      receipt?.status !== "started" ||
      receipt.digest !== this.approvals.digest(run, "execute") ||
      resolve(artifacts.directory) !==
        resolve(this.directory, "operations", run.id, artifacts.digest)
    )
      throw new Error(
        "Operational execution is not at its single approved launch checkpoint",
      );
    this.inspect(plan, bundle, artifacts);
    signal.throwIfAborted();
    const env = this.environment(plan);
    if (plan.aws) {
      const identity = await this.runner.run(
        "aws",
        [
          "sts",
          "get-caller-identity",
          "--query",
          "Account",
          "--output",
          "text",
          "--profile=" + plan.aws.profile,
          "--region",
          plan.aws.region,
          "--no-cli-pager",
        ],
        artifacts.directory,
        "",
        () => {},
        signal,
        30000,
        undefined,
        env,
      );
      if (identity.code !== 0 || identity.stdout.trim() !== plan.aws.accountId)
        throw new Error(
          "AWS account differs from the explicitly approved operational target",
        );
    }
    const before = await this.script(
      plan,
      "preflight.sh",
      artifacts.directory,
      signal,
      env,
    );
    this.checks(before, plan.preconditions);
    this.approvals.assertExecution(run);
    this.inspect(plan, bundle, artifacts);
    return this.script(plan, "execute.sh", artifacts.directory, signal, env);
  }
  async verify(
    run: Run,
    signal: AbortSignal,
  ): Promise<OperationalCommandResult> {
    this.approvals.assertExecution(run);
    signal.throwIfAborted();
    const receipt = run.data.operationalExecution as
      { status?: string; code?: number; digest?: string } | undefined;
    if (
      receipt?.status !== "completed" ||
      receipt.code !== 0 ||
      receipt.digest !== this.approvals.digest(run, "execute")
    )
      throw new Error(
        "Verification requires the exact observed successful execution receipt",
      );
    const plan = run.data.operationalPlan as OperationalPlan;
    this.inspect(
      plan,
      run.data.operationalImplementation as OperationalImplementation,
      run.data.operationalArtifacts as OperationalArtifacts,
    );
    const result = await this.script(
      plan,
      "verify.sh",
      (run.data.operationalArtifacts as OperationalArtifacts).directory,
      signal,
      this.environment(plan),
    );
    this.checks(result, plan.successCriteria);
    return result;
  }
  private checks(result: OperationalCommandResult, criteria: string[]): void {
    if (result.code !== 0 || result.truncated)
      throw new Error(
        "Operational precondition or verification script failed; no automatic retry/rollback",
      );
    const observed = operationalChecksSchema.parse(JSON.parse(result.stdout));
    if (
      observed.checks.length !== criteria.length ||
      new Set(observed.checks.map((c) => c.criterion)).size !==
        criteria.length ||
      criteria.some(
        (c) => !observed.checks.some((o) => o.criterion === c && o.passed),
      )
    )
      throw new Error(
        "Operational checks did not confirm every approved criterion",
      );
  }
  private environment(plan: OperationalPlan): NodeJS.ProcessEnv {
    return {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      LANG: process.env.LANG ?? "C.UTF-8",
      AWS_PAGER: "",
      AWS_CLI_AUTO_PROMPT: "off",
      ...(plan.aws
        ? {
            AWS_PROFILE: plan.aws.profile,
            AWS_REGION: plan.aws.region,
            AWS_DEFAULT_REGION: plan.aws.region,
          }
        : {}),
    };
  }
  private async run(
    command: string,
    args: string[],
    cwd: string,
    signal: AbortSignal,
    environment: NodeJS.ProcessEnv,
  ): Promise<OperationalCommandResult> {
    signal.throwIfAborted();
    let stderr = "";
    const redactor = new LogRedactor();
    const result = await this.runner.run(
      command,
      args,
      cwd,
      "",
      () => {},
      signal,
      120000,
      undefined,
      environment,
      (line) => {
        if (stderr.length < 20000)
          stderr += redactor.redact(line, "stderr") + "\n";
      },
    );
    const output = redactLog(result.stdout);
    return {
      code: result.code,
      stdout: output.slice(0, 20000),
      truncated: output.length > 20000,
      stderr: stderr.slice(0, 20000),
    };
  }
  private script(
    plan: OperationalPlan,
    file: string,
    cwd: string,
    signal: AbortSignal,
    env: NodeJS.ProcessEnv,
  ): Promise<OperationalCommandResult> {
    return plan.environment === "local"
      ? this.run(
          "bwrap",
          [
            "--die-with-parent",
            "--unshare-net",
            "--dev-bind",
            "/",
            "/",
            "--chdir",
            cwd,
            "/bin/bash",
            "--noprofile",
            "--norc",
            "./" + file,
          ],
          cwd,
          signal,
          env,
        )
      : this.run(
          "bash",
          ["--noprofile", "--norc", "./" + file],
          cwd,
          signal,
          env,
        );
  }
}
