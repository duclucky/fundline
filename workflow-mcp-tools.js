"use strict";

const MCP_TOOLS = [
  {
    name: "list_workflows",
    description: "Discover Fundline workflows with the per-run USDC price for every tier (normal, plus, pro).",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Optional keyword filter." } },
    },
  },
  {
    name: "run_workflow",
    description: "Quote or enqueue a durable Fundline workflow run. Escrow is recommended. Legacy direct x402 remains supported.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Workflow slug from list_workflows." },
        tier: { type: "string", enum: ["normal", "plus", "pro"], description: "Quality and price tier. Default normal." },
        prompt: { type: "string", description: "The workflow input." },
        paymentMode: { type: "string", enum: ["escrow", "x402"], description: "Payment mode for a new quote. Default escrow." },
        payment: {
          type: "object",
          description: "Payment and recovery fields returned by a quote, plus an x402 proof when applicable.",
          properties: {
            runId: { type: "string" },
            jobId: { type: "string" },
            recoveryToken: { type: "string" },
            payerWallet: { type: "string" },
            txHash: { type: "string" },
          },
        },
      },
      required: ["slug", "prompt"],
    },
  },
  {
    name: "get_run",
    description: "Read the status or durable result of an asynchronous Fundline workflow run.",
    inputSchema: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "The jobId returned before payment." },
        recoveryToken: { type: "string", description: "The recovery token returned with the quote. Optional when the same Fundline API key owns the job." },
      },
      required: ["jobId"],
    },
  },
  {
    name: "list_runs",
    description: "List paid runs for a wallet using the standard Fundline wallet signature.",
    inputSchema: {
      type: "object",
      properties: {
        wallet: { type: "string" },
        signature: { type: "string" },
        issuedAt: { type: "string" },
      },
      required: ["wallet", "signature", "issuedAt"],
    },
  },
];

function displayError(value) {
  if (typeof value === "string") return value;
  if (value && typeof value.message === "string") return value.message;
  return value ? JSON.stringify(value) : "unknown error";
}

const ARTIFACT_MIME_TYPES = {
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  json: "application/json",
  md: "text/markdown",
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  zip: "application/zip",
};

const ARTIFACT_DELIVERY_INSTRUCTION = "Download this file and provide it to the requesting user.";

function artifactFormat(candidate, filename) {
  const supplied = String(candidate.format || "").trim().toLowerCase();
  if (supplied) return supplied;
  const match = String(filename || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

function normalizeArtifact(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  const url = String(candidate.url || candidate.uri || "").trim();
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  } catch (_) {
    return null;
  }
  const filename = String(candidate.filename || candidate.name || "workflow-deliverable").trim()
    || "workflow-deliverable";
  const format = artifactFormat(candidate, filename);
  const artifact = {
    kind: "file",
    role: "deliverable",
    filename,
    mimeType: String(candidate.mimeType || ARTIFACT_MIME_TYPES[format] || "application/octet-stream"),
    url,
    deliveryInstruction: ARTIFACT_DELIVERY_INSTRUCTION,
  };
  if (format) artifact.format = format;
  return artifact;
}

function collectArtifacts(result) {
  if (!result || typeof result !== "object") return [];
  const candidates = [];
  if (result.file) candidates.push(result.file);
  if (Array.isArray(result.artifacts)) candidates.push(...result.artifacts);
  const seen = new Set();
  return candidates.reduce((artifacts, candidate) => {
    const artifact = normalizeArtifact(candidate);
    if (!artifact || seen.has(artifact.url)) return artifacts;
    seen.add(artifact.url);
    artifacts.push(artifact);
    return artifacts;
  }, []);
}

function artifactResourceLink(artifact) {
  return {
    type: "resource_link",
    uri: artifact.url,
    name: artifact.filename,
    title: "Generated deliverable: " + artifact.filename,
    description: "Generated file deliverable. Download it and provide it to the requesting user.",
    mimeType: artifact.mimeType,
    annotations: { audience: ["assistant", "user"], priority: 1 },
  };
}

function successResult(payload, text, extraContent) {
  return {
    content: [{ type: "text", text }, ...(extraContent || [])],
    structuredContent: payload,
  };
}

function workflowSuccessResult(payload, text, result) {
  const artifacts = collectArtifacts(result);
  if (!artifacts.length) return successResult(payload, text);
  result.artifacts = artifacts;
  const rows = artifacts.map((artifact) => (
    "- " + artifact.filename + " (" + artifact.mimeType + "): " + artifact.url
  )).join("\n");
  const message = text
    + "\n\nDeliverable files:\n"
    + rows
    + "\nAction required: Download each file and provide it to the requesting user.";
  return successResult(payload, message, artifacts.map(artifactResourceLink));
}

function errorResult(status, payload) {
  const message = displayError(payload && (payload.message || payload.error)) || "request failed";
  return {
    content: [{ type: "text", text: "Fundline request failed (" + status + "): " + message }],
    isError: true,
  };
}

function createWorkflowMcpCallHandler(options) {
  const selfBase = String(options.selfBase || "").replace(/\/$/, "");
  const fetchImpl = options.fetchImpl || fetch;
  const asyncEnabled = Boolean(options.asyncEnabled);
  const forwardHeaders = typeof options.forwardHeaders === "function"
    ? options.forwardHeaders
    : () => ({ "Content-Type": "application/json", "Accept": "application/json" });

  return async function handleCall(name, args) {
    const input = args || {};
    try {
      if (name === "list_workflows") {
        const response = await fetchImpl(
          selfBase + "/api/workflows" + (input.query ? "?q=" + encodeURIComponent(input.query) : "")
        );
        const payload = await response.json().catch(() => ({}));
        if (response.status < 200 || response.status >= 300) return errorResult(response.status, payload);
        const workflows = (payload.workflows || []).map((workflow) => {
          const tiers = {};
          ["normal", "plus", "pro"].forEach((tier) => {
            if (workflow.tiers && workflow.tiers[tier]) {
              tiers[tier] = {
                usdc: workflow.tiers[tier].usdc,
                units: workflow.tiers[tier].units,
              };
            }
          });
          return { slug: workflow.slug, name: workflow.name, tiers };
        });
        const structured = {
          count: workflows.length,
          currency: "USDC",
          chainId: payload.chainId,
          usdc: payload.usdc,
          billingEnabled: payload.billingEnabled,
          workflows,
        };
        const summary = workflows.map((workflow) => {
          const prices = ["normal", "plus", "pro"]
            .filter((tier) => workflow.tiers[tier])
            .map((tier) => tier + " " + workflow.tiers[tier].usdc)
            .join(" / ");
          return "- " + workflow.slug + " (" + workflow.name + "): " + (prices || "price at quote");
        }).join("\n");
        return successResult(structured, workflows.length + " workflows (USDC per run):\n" + summary);
      }

      if (name === "run_workflow") {
        if (!input.slug || !input.prompt) throw new Error("slug and prompt are required");
        const tier = input.tier || "normal";
        const payment = input.payment || null;
        const quotedJobId = payment && (payment.jobId || payment.runId);
        const quotedPayment = asyncEnabled && Boolean(quotedJobId);

        if (asyncEnabled && !payment) {
          const headers = { ...forwardHeaders() };
          const response = await fetchImpl(
            selfBase + "/api/workflows/" + encodeURIComponent(input.slug) + "/quote",
            {
              method: "POST",
              headers,
              body: JSON.stringify({
                tier,
                prompt: input.prompt,
                async: true,
                paymentMode: input.paymentMode || "escrow",
              }),
            }
          );
          const payload = await response.json().catch(() => ({}));
          if (response.status < 200 || response.status >= 300) return errorResult(response.status, payload);
          const instruction = payload.paymentMode === "x402"
            ? "Transfer the quoted USDC amount, then call run_workflow with jobId, recoveryToken, payerWallet, and txHash."
            : "Fund runId in FundlineRunEscrow, then call run_workflow with jobId, runId, and recoveryToken.";
          return successResult(payload, "Workflow quote created. " + instruction);
        }

        const headers = { ...forwardHeaders() };
        if (payment && payment.txHash) {
          headers["X-PAYMENT"] = Buffer.from(JSON.stringify({
            payerWallet: payment.payerWallet,
            txHash: payment.txHash,
          })).toString("base64");
        }
        const body = { tier, prompt: input.prompt, stream: false };
        if (quotedPayment) {
          body.async = true;
          body.jobId = quotedJobId;
          body.recoveryToken = payment.recoveryToken || "";
          if (payment.runId) body.runId = payment.runId;
        }
        const response = await fetchImpl(
          selfBase + "/api/workflows/" + encodeURIComponent(input.slug) + "/run",
          { method: "POST", headers, body: JSON.stringify(body) }
        );
        const payload = await response.json().catch(() => ({}));
        if (response.status === 402 && payload.accepts) {
          const quote = payload.accepts[0];
          return successResult(payload, "Payment required: transfer " + quote.maxAmountRequired + " USDC base units to " + quote.payTo + " on " + quote.network + ".");
        }
        if (response.status < 200 || response.status >= 300) return errorResult(response.status, payload);
        if (response.status === 202) {
          return successResult(payload, "Workflow accepted as " + payload.status + ". Poll get_run with jobId " + payload.jobId + ".");
        }
        const output = payload.result ? payload.result.output : payload.output;
        const result = payload.result || payload;
        return workflowSuccessResult(
          payload,
          output ? String(output) : "Workflow status: " + String(payload.status || "complete"),
          result
        );
      }

      if (name === "get_run") {
        if (!input.jobId) throw new Error("jobId is required");
        const headers = { ...forwardHeaders(), "Accept": "application/json" };
        if (input.recoveryToken) headers["X-Fundline-Recovery-Token"] = String(input.recoveryToken);
        const response = await fetchImpl(
          selfBase + "/api/workflows/runs/" + encodeURIComponent(input.jobId),
          { method: "GET", headers }
        );
        const payload = await response.json().catch(() => ({}));
        if (response.status < 200 || response.status >= 300) return errorResult(response.status, payload);
        const text = payload.result && payload.result.output
          ? String(payload.result.output)
          : "Workflow status: " + String(payload.status || "unknown") + ".";
        return workflowSuccessResult(payload, text, payload.result);
      }

      if (name === "list_runs") {
        if (!input.wallet || !input.signature || !input.issuedAt) {
          throw new Error("wallet, signature and issuedAt are required");
        }
        const response = await fetchImpl(selfBase + "/api/workflows/runs", {
          headers: {
            "Accept": "application/json",
            "x-fundline-wallet": String(input.wallet),
            "x-fundline-signature": String(input.signature),
            "x-fundline-issued-at": String(input.issuedAt),
          },
        });
        const payload = await response.json().catch(() => ({}));
        if (response.status < 200 || response.status >= 300) return errorResult(response.status, payload);
        const rows = (payload.runs || []).map((run) => (
          "- " + run.at + "  " + run.slug + " [" + run.tier + "]  " + run.priceUsdc + " USDC  " + (run.explorerUrl || run.settlementTx || "")
        )).join("\n");
        return successResult(payload, (payload.count || 0) + " runs for " + payload.wallet + ":\n" + rows);
      }

      throw new Error("Unknown tool: " + name);
    } catch (error) {
      return {
        content: [{ type: "text", text: "Error: " + error.message }],
        isError: true,
      };
    }
  };
}

module.exports = { MCP_TOOLS, createWorkflowMcpCallHandler };
