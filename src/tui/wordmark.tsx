import React from "react";
import { Text } from "ink";

const letters: Record<string, string[]> = {
  S: ["1111", "1000", "1111", "0001", "1111"],
  C: ["1111", "1000", "1000", "1000", "1111"],
  A: ["0110", "1001", "1111", "1001", "1001"],
  B: ["1110", "1001", "1110", "1001", "1110"],
  E: ["1111", "1000", "1110", "1000", "1111"],
  R: ["1110", "1001", "1110", "1010", "1001"],
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
