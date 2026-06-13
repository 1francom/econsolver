function timestampOf(event) {
  const numeric = Number(event?.timestamp);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(event?.timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

function orderedEvents(timeline) {
  return (Array.isArray(timeline) ? timeline : [])
    .map((event, index) => ({ event, index, timestamp: timestampOf(event) }))
    .sort((left, right) => left.timestamp - right.timestamp || left.index - right.index)
    .map(item => item.event);
}

function datasetNames(events) {
  const names = new Map();
  events.forEach(event => {
    if (!event?.datasetId || !["dataset_load", "dataset_derive"].includes(event.opType)) return;
    const name = event.params?.filename || event.params?.name || event.datasetId;
    names.set(event.datasetId, String(name));
  });
  return names;
}

function displayDataset(datasetId, names) {
  return names.get(datasetId) || datasetId || "dataset";
}

function makeBlock(kind, events, { datasetId = null, filename = null, label } = {}) {
  return {
    kind,
    datasetId,
    filename,
    events,
    firstTs: timestampOf(events[0]),
    lastTs: timestampOf(events[events.length - 1]),
    label,
  };
}

function loadLabel(event) {
  const target = event.params?.filename || event.params?.name || event.datasetId || "dataset";
  return `${event.opType === "dataset_derive" ? "Derive" : "Load"} ${target}`;
}

function cleanLabel(events, names) {
  const dataset = displayDataset(events[0]?.datasetId, names);
  const count = events.length;
  return `Clean ${dataset} (${count} ${count === 1 ? "step" : "steps"})`;
}

function estimateLabel(event) {
  const type = event.params?.type ? String(event.params.type).toUpperCase() : "model";
  const filename = event.params?.filename;
  return filename ? `Estimate ${type} on ${filename}` : `Estimate ${type}`;
}

function exploreLabel(event) {
  const kind = event.params?.kind || "statistic";
  const dataset = event.params?.dataset;
  return dataset ? `Explore ${kind} on ${dataset}` : `Explore ${kind}`;
}

function spatialLabel(events) {
  if (events.length === 1) {
    const operation = String(events[0]?.opType || "operation").replace(/_/g, " ");
    return `Spatial ${operation}`;
  }
  return `Spatial operations (${events.length})`;
}

function buildBlocks(timeline) {
  const events = orderedEvents(timeline);
  const names = datasetNames(events);
  const blocks = [];

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];

    if (["dataset_load", "dataset_derive"].includes(event?.opType)) {
      blocks.push(makeBlock("load", [event], {
        datasetId: event.datasetId ?? null,
        filename: event.params?.filename ?? null,
        label: loadLabel(event),
      }));
      continue;
    }

    if (event?.opType === "pipeline_step") {
      const grouped = [event];
      while (
        index + 1 < events.length
        && events[index + 1]?.opType === "pipeline_step"
        && (events[index + 1]?.datasetId ?? null) === (event.datasetId ?? null)
      ) {
        grouped.push(events[index + 1]);
        index += 1;
      }
      blocks.push(makeBlock("clean", grouped, {
        datasetId: event.datasetId ?? null,
        label: cleanLabel(grouped, names),
      }));
      continue;
    }

    if (event?.opType === "estimate") {
      blocks.push(makeBlock("estimate", [event], {
        filename: event.params?.filename ?? null,
        label: estimateLabel(event),
      }));
      continue;
    }

    if (event?.opType === "explore_stat") {
      blocks.push(makeBlock("explore", [event], {
        datasetId: event.datasetId ?? null,
        label: exploreLabel(event),
      }));
      continue;
    }

    if (event?.module === "spatial") {
      const grouped = [event];
      while (index + 1 < events.length && events[index + 1]?.module === "spatial") {
        grouped.push(events[index + 1]);
        index += 1;
      }
      const datasetIds = [...new Set(grouped.map(item => item?.datasetId).filter(Boolean))];
      blocks.push(makeBlock("spatial", grouped, {
        datasetId: datasetIds.length === 1 ? datasetIds[0] : null,
        label: spatialLabel(grouped),
      }));
    }
  }

  return blocks;
}

export function detectInterleaving(timeline) {
  const events = orderedEvents(timeline);
  const blocks = buildBlocks(events);
  const cleanCounts = new Map();
  blocks.forEach(block => {
    if (block.kind !== "clean" || !block.datasetId) return;
    cleanCounts.set(block.datasetId, (cleanCounts.get(block.datasetId) || 0) + 1);
  });

  const repeatedCleanDatasets = [...cleanCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([datasetId]) => datasetId);
  const modeledDatasets = new Set(events
    .filter(event => event?.opType === "estimate" && event.params?.filename)
    .map(event => String(event.params.filename)));
  const firstEstimateIndex = events.findIndex(event => event?.opType === "estimate");
  const loadAfterEstimate = firstEstimateIndex >= 0
    && events.slice(firstEstimateIndex + 1).some(event => event?.opType === "dataset_load");

  const reasons = [];
  if (repeatedCleanDatasets.length === 1) {
    reasons.push(`${repeatedCleanDatasets[0]} has non-contiguous cleaning blocks`);
  } else if (repeatedCleanDatasets.length > 1) {
    reasons.push(`${repeatedCleanDatasets.length} datasets have non-contiguous cleaning blocks`);
  }
  if (modeledDatasets.size >= 2) reasons.push(`${modeledDatasets.size} datasets modeled`);
  if (loadAfterEstimate) reasons.push("loads interleaved with estimation");

  const interleaved = reasons.length > 0;
  return {
    interleaved,
    reason: interleaved ? reasons.join("; ") : "Single linear execution flow",
    recommendedMode: interleaved ? "execution" : "module",
  };
}

export function planExecutionOrder(timeline) {
  return {
    blocks: buildBlocks(timeline),
    interleaving: detectInterleaving(timeline),
  };
}

export function summarizePlan(plan) {
  const blocks = Array.isArray(plan?.blocks) ? plan.blocks : [];
  if (blocks.length === 0) return "No execution blocks.";
  return blocks
    .map((block, index) => `${index + 1}. [${block.kind}] ${block.label}`)
    .join("\n");
}
