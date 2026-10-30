export function browserOrigins(endpoints: string[]): string[] {
  return [
    ...new Set(
      endpoints.map((endpoint) => {
        const url = new URL(endpoint);
        if (url.protocol !== "https:" || url.username || url.password)
          throw new Error(
            "Browser staging endpoints must use HTTPS without URL credentials",
          );
        return url.origin;
      }),
    ),
  ];
}

export function originsCovered(origins: string[], approved: string[]): boolean {
  return (
    origins.length > 0 && origins.every((origin) => approved.includes(origin))
  );
}
