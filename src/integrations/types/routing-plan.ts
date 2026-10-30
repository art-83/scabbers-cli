export type RoutingPlan = {
  type:
    | "Bug"
    | "Bug Crítico"
    | "Ticket"
    | "duplicate"
    | "cancel"
    | "product"
    | "insufficient";
  summary: string;
  description: string;
  destinationKey?: string | undefined;
  cancellationReason?: string | undefined;
};
