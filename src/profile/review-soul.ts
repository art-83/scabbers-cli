import { choose } from "../tui/prompts.js";
import { stdin, stdout } from "node:process";
import type { Soul } from "./soul.js";
export async function reviewSoul(
  soul: Soul,
  question?: (prompt: string) => Promise<string>,
  write: (text: string) => void = (text) => stdout.write(text),
): Promise<boolean> {
  const sourceVersion = soul.prepareSource();
  const proposal = sourceVersion
    ? soul.latestProposal(sourceVersion)
    : soul.latestProposal();
  if (!proposal) {
    write("No pending SOUL proposal. Generate one with $scabbers-soul.\n");
    return false;
  }
  write(
    `\nSOUL proposal ${proposal.version}\nFile: ${proposal.path}\nEvidence sources: ${proposal.evidenceCount}\n\n${proposal.content}\n`,
  );
  if (!question && !stdin.isTTY) {
    write(
      "Review shown only. Run scabbers --review-soul in an interactive terminal to approve this exact version.\n",
    );
    return false;
  }
  {
    const prompt = "Approve this exact SOUL version?";
    const answer = question
      ? await question(prompt)
      : await choose(prompt, [
          { label: "Keep proposal pending", value: "pending" },
          { label: "Approve this exact version", value: "approve" },
        ]);
    if (answer !== "approve") {
      write("Proposal remains pending; active profile unchanged.\n");
      return false;
    }
    soul.approve(proposal.version);
    write(
      "SOUL version approved for new runs. Remote processing settings unchanged.\n",
    );
    return true;
  }
}
