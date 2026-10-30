import React from "react";
import { Text } from "ink";

const letters: Record<string, string[]> = {
  S: ["111", "100", "111", "001", "111"],
  C: ["111", "100", "100", "100", "111"],
  A: ["010", "101", "111", "101", "101"],
  B: ["110", "101", "110", "101", "110"],
  E: ["111", "100", "110", "100", "111"],
  R: ["110", "101", "110", "101", "101"],
};
const pixels = Array.from({ length: 5 }, (_, row) =>
  Array.from("SCABBERS", (letter) => letters[letter]![row]!)
    .join("0")
    .replace(/1/g, "█")
    .replace(/0/g, " "),
).join("\n");

export function Wordmark({
  compact,
}: {
  compact: boolean;
}): React.ReactElement {
  return (
    <Text bold color="#A78BFA">
      {compact || process.env.TERM === "dumb" ? "SCABBERS" : pixels}
    </Text>
  );
}
