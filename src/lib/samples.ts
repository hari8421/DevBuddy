/** Bundled sample logs, served from `public/samples` so they work offline. */
export interface SampleFile {
  name: string;
  path: string;
  description: string;
  badge: string;
}

export const SAMPLE_FILES: SampleFile[] = [
  {
    name: "orders-service.log",
    path: "samples/orders-service.log",
    description: "Java / Logback service log with repeated NullPointerExceptions, payment timeouts and SQL timeouts.",
    badge: "Delimited text",
  },
  {
    name: "checkout-api.jsonl",
    path: "samples/checkout-api.jsonl",
    description: "Node.js API emitting JSON Lines with nested error stacks, rate limits and a heap exhaustion.",
    badge: "JSON lines",
  },
  {
    name: "nginx-access.log",
    path: "samples/nginx-access.log",
    description: "Combined access log with 5xx spikes, rate limits and a gateway timeout on reports.",
    badge: "Access log",
  },
  {
    name: "system.log",
    path: "samples/system.log",
    description: "Syslog with an OOM kill, SSH brute force, database errors and filesystem trouble.",
    badge: "Syslog",
  },
];

export async function fetchSample(sample: SampleFile): Promise<{ name: string; text: string }> {
  const response = await fetch(`${import.meta.env.BASE_URL}${sample.path}`);
  if (!response.ok) {
    throw new Error(`Could not load sample ${sample.name} (${response.status})`);
  }
  const text = await response.text();
  return { name: sample.name, text };
}