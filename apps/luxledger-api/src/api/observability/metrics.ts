const REQUEST_DURATION_BUCKETS_SECONDS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
] as const;

type Labels = Record<string, string>;

interface CounterSeries {
  labels: Labels;
  value: number;
}

interface HistogramSeries {
  labels: Labels;
  bucketCounts: number[];
  count: number;
  sum: number;
}

const canonicalKey = (labels: Labels): string =>
  Object.entries(labels)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${value}`)
    .join('\u0000');

const escapeLabelValue = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');

const formatLabels = (labels: Labels): string => {
  const entries = Object.entries(labels).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    return '';
  }

  return `{${entries.map(([name, value]) => `${name}="${escapeLabelValue(value)}"`).join(',')}}`;
};

const upsertCounter = (store: Map<string, CounterSeries>, labels: Labels, increment = 1): void => {
  const key = canonicalKey(labels);
  const series = store.get(key);

  if (series) {
    series.value += increment;
    return;
  }

  store.set(key, {
    labels,
    value: increment,
  });
};

const getSortedCounterSeries = (store: Map<string, CounterSeries>): CounterSeries[] =>
  [...store.values()].sort((left, right) =>
    canonicalKey(left.labels).localeCompare(canonicalKey(right.labels)),
  );

const getSortedHistogramSeries = (store: Map<string, HistogramSeries>): HistogramSeries[] =>
  [...store.values()].sort((left, right) =>
    canonicalKey(left.labels).localeCompare(canonicalKey(right.labels)),
  );

export class ApiMetrics {
  private readonly requestTotal = new Map<string, CounterSeries>();
  private readonly authFailuresTotal = new Map<string, CounterSeries>();
  private readonly tokenIssuanceFailuresTotal = new Map<string, CounterSeries>();
  private readonly requestDurationSeconds = new Map<string, HistogramSeries>();

  public observeRequest(route: string, status: number, durationSeconds: number): void {
    const labels = {
      route,
      status: String(status),
    };
    upsertCounter(this.requestTotal, labels);

    const key = canonicalKey(labels);
    const clampedDuration = Math.max(0, durationSeconds);
    const series = this.requestDurationSeconds.get(key) ?? {
      labels,
      bucketCounts: Array<number>(REQUEST_DURATION_BUCKETS_SECONDS.length).fill(0),
      count: 0,
      sum: 0,
    };

    for (let index = 0; index < REQUEST_DURATION_BUCKETS_SECONDS.length; index += 1) {
      if (clampedDuration <= REQUEST_DURATION_BUCKETS_SECONDS[index]) {
        series.bucketCounts[index] += 1;
      }
    }

    series.count += 1;
    series.sum += clampedDuration;
    this.requestDurationSeconds.set(key, series);
  }

  public incrementAuthFailure(route: string, status: number): void {
    upsertCounter(this.authFailuresTotal, {
      route,
      status: String(status),
    });
  }

  public incrementTokenIssuanceFailure(status: number): void {
    upsertCounter(this.tokenIssuanceFailuresTotal, {
      status: String(status),
    });
  }

  public renderPrometheus(): string {
    const lines: string[] = [];

    lines.push('# HELP luxledger_http_requests_total Total HTTP requests by route and status.');
    lines.push('# TYPE luxledger_http_requests_total counter');
    for (const series of getSortedCounterSeries(this.requestTotal)) {
      lines.push(`luxledger_http_requests_total${formatLabels(series.labels)} ${series.value}`);
    }

    lines.push(
      '# HELP luxledger_http_request_duration_seconds HTTP request latency in seconds by route and status.',
    );
    lines.push('# TYPE luxledger_http_request_duration_seconds histogram');
    for (const series of getSortedHistogramSeries(this.requestDurationSeconds)) {
      for (let index = 0; index < REQUEST_DURATION_BUCKETS_SECONDS.length; index += 1) {
        lines.push(
          `luxledger_http_request_duration_seconds${formatLabels({
            ...series.labels,
            le: String(REQUEST_DURATION_BUCKETS_SECONDS[index]),
          })} ${series.bucketCounts[index]}`,
        );
      }
      lines.push(
        `luxledger_http_request_duration_seconds${formatLabels({ ...series.labels, le: '+Inf' })} ${series.count}`,
      );
      lines.push(
        `luxledger_http_request_duration_seconds_sum${formatLabels(series.labels)} ${series.sum}`,
      );
      lines.push(
        `luxledger_http_request_duration_seconds_count${formatLabels(series.labels)} ${series.count}`,
      );
    }

    lines.push('# HELP luxledger_auth_failures_total Auth failures by route and status.');
    lines.push('# TYPE luxledger_auth_failures_total counter');
    for (const series of getSortedCounterSeries(this.authFailuresTotal)) {
      lines.push(`luxledger_auth_failures_total${formatLabels(series.labels)} ${series.value}`);
    }

    lines.push(
      '# HELP luxledger_token_issuance_failures_total Failed access token issuance attempts by status.',
    );
    lines.push('# TYPE luxledger_token_issuance_failures_total counter');
    for (const series of getSortedCounterSeries(this.tokenIssuanceFailuresTotal)) {
      lines.push(
        `luxledger_token_issuance_failures_total${formatLabels(series.labels)} ${series.value}`,
      );
    }

    return `${lines.join('\n')}\n`;
  }
}
